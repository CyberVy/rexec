import { BaseController } from "@/infra/base_controller"
import { create_logger } from "@/infra/logger"
import {
    PtySessionError,
    pty_session_missing,
    pty_taken_by_another_caller,
    type PtyClient,
    type PtySessionInfo
} from "@rexec/caller/core"
import { fetch_workspace_entries, parse_osc7_path, resolve_parent_path, type WorkspaceEntry } from "@/core/workspace"
import { session_controller } from "./session_controller"

const logger = create_logger("PtyController")

export type PtyStatus = "disconnected" | "connecting" | "connected" | "exited" | "error"

export interface PtyState {
    status: PtyStatus
    session_id: string | null
    cwd: string | null
    exit_code: number | null
    error: string | null
    cols: number
    rows: number
    sessions: PtySessionInfo[]
    is_listing: boolean
    dir_path: string | null
    dir_entries: WorkspaceEntry[]
    is_loading_dir: boolean
    dir_error: string | null
}

interface ConnectOptions {
    session_id?: string
    file?: string
    args?: string[]
    cwd?: string
    cols?: number
    rows?: number
    term?: string
}

export class PtyController extends BaseController<PtyState> {
    private client: PtyClient | null = null
    private abort_controller: AbortController | null = null
    private dir_abort_controller: AbortController | null = null
    private data_listeners: Set<(data: Uint8Array, replay_bytes: number) => void> = new Set()
    private replay_remaining = 0
    private is_intentional_disconnect = false
    private last_options: ConnectOptions | null = null
    private reconnect_timer: ReturnType<typeof setTimeout> | null = null
    private reconnect_attempts = 0
    private connection_attempt = 0

    constructor() {
        super()
        this._state = {
            status: "disconnected",
            session_id: null,
            cwd: null,
            exit_code: null,
            error: null,
            cols: 80,
            rows: 24,
            sessions: [],
            is_listing: false,
            dir_path: null,
            dir_entries: [],
            is_loading_dir: false,
            dir_error: null
        }
        session_controller.addEventListener("status_change", () => {
            void this.refresh_sessions()
            if (session_controller.state.agent_online && !this.state.cwd) {
                void this.load_directory()
            }
        })
        session_controller.addEventListener("change", () => {
            void this.refresh_sessions()
        })
    }

    public on_data(cb: (data: Uint8Array, replay_bytes: number) => void): () => void {
        this.data_listeners.add(cb)
        return () => this.data_listeners.delete(cb)
    }

    public async refresh_sessions(): Promise<PtySessionInfo[]> {
        if (!session_controller.state.hub_url) {
            this.update_state({ sessions: [], is_listing: false })
            return []
        }

        const caller = session_controller.get_caller()
        this.update_state({ is_listing: true })
        try {
            const sessions = await caller.list_ptys()
            const active_session = sessions.find((s) => s.session_id === this.state.session_id)
            const next_cwd = active_session?.cwd ?? this.state.cwd
            this.update_state({
                sessions,
                is_listing: false,
                cwd: next_cwd
            })
            return sessions
        } catch (err) {
            logger.warn("Failed to list PTY sessions", err)
            this.update_state({ is_listing: false })
            return []
        }
    }

    public update_cwd_from_osc7(osc_data: string): void {
        const parsed = parse_osc7_path(osc_data)
        if (!parsed || parsed === this.state.cwd) return
        this.update_state({ cwd: parsed })
    }

    public async load_directory(target_path?: string): Promise<void> {
        if (!session_controller.state.hub_url) {
            this.update_state({
                is_loading_dir: false,
                dir_error: "Hub URL is required"
            })
            return
        }

        if (this.dir_abort_controller) {
            this.dir_abort_controller.abort()
        }
        this.dir_abort_controller = new AbortController()
        const signal = this.dir_abort_controller.signal

        const requested_path = target_path ?? this.state.dir_path ?? this.state.cwd ?? undefined
        this.update_state({
            is_loading_dir: true,
            dir_error: null,
            ...(target_path ? { dir_path: target_path } : {})
        })

        try {
            const caller = session_controller.get_caller()
            const snapshot = await fetch_workspace_entries(caller, requested_path, signal)
            this.update_state({
                dir_path: snapshot.resolved_cwd,
                dir_entries: snapshot.entries,
                is_loading_dir: false,
                dir_error: null,
                cwd: this.state.cwd ?? snapshot.resolved_cwd
            })
        } catch (err) {
            if (signal.aborted) return
            const message = err instanceof Error ? err.message : String(err)
            logger.warn("Failed to load workspace directory", message)
            this.update_state({
                is_loading_dir: false,
                dir_error: message
            })
        } finally {
            if (this.dir_abort_controller?.signal === signal) {
                this.dir_abort_controller = null
            }
        }
    }

    public async navigate_parent_directory(): Promise<void> {
        const current = this.state.dir_path || this.state.cwd || "/"
        const parent = resolve_parent_path(current)
        await this.load_directory(parent)
    }

    public cd_to_directory(target_path: string): void {
        if (!target_path) return
        const escaped = target_path.replace(/'/g, "'\\''")
        this.send(`cd -- '${escaped}'\r`)
        this.update_state({
            cwd: target_path,
            dir_path: target_path
        })
    }

    public async kill_session(session_id: string): Promise<void> {
        const caller = session_controller.get_caller()
        try {
            await caller.kill_pty(session_id)
        } catch (err) {
            logger.error("Failed to kill PTY session", err)
        }
        if (session_id === this.state.session_id) {
            this.disconnect()
        }
        await this.refresh_sessions()
    }

    public async set_session_persistent(session_id: string, persistent: boolean): Promise<void> {
        const caller = session_controller.get_caller()
        try {
            await caller.set_pty_persistent(session_id, persistent)
        } catch (err) {
            logger.error("Failed to update PTY session persistent state", err)
        }
        await this.refresh_sessions()
    }

    public async switch_session(session_id: string): Promise<void> {
        await this.open_connection({ ...this.last_options, session_id })
    }

    public async new_session(): Promise<void> {
        await this.open_connection({ ...this.last_options, session_id: undefined }, { force_new: true })
    }

    public async connect(options?: ConnectOptions): Promise<void> {
        await this.open_connection(options)
    }

    private async open_connection(
        options?: ConnectOptions,
        config?: { is_reconnect?: boolean; force_new?: boolean }
    ): Promise<void> {
        const is_reconnect = Boolean(config?.is_reconnect)
        const force_new = Boolean(config?.force_new)
        this.is_intentional_disconnect = false
        const attempt = this.begin_attempt()
        this.last_options = options ?? this.last_options

        const caller = session_controller.get_caller()
        const cols = options?.cols ?? this.state.cols
        const rows = options?.rows ?? this.state.rows
        const session_id = force_new ? undefined : (options?.session_id ?? this.state.session_id ?? undefined)
        const next_cwd = session_id
            ? (this.state.sessions.find((s) => s.session_id === session_id)?.cwd ?? null)
            : (options?.cwd ?? null)

        if (!is_reconnect && this.dir_abort_controller) {
            this.dir_abort_controller.abort()
            this.dir_abort_controller = null
        }

        this.update_state({
            status: "connecting",
            session_id: session_id ?? null,
            ...(is_reconnect
                ? {}
                : {
                      cwd: next_cwd,
                      dir_path: null,
                      dir_entries: [],
                      is_loading_dir: false,
                      dir_error: null
                  }),
            exit_code: null,
            error: null,
            cols,
            rows
        })

        // Clear immediately on user-initiated switch/connect so stale output does not linger while connecting.
        if (!is_reconnect) {
            this.dispatchEvent(new Event("reset"))
        }

        try {
            const pty_client = await caller.open_pty({
                session_id,
                file: options?.file || this.last_options?.file,
                args: options?.args ?? this.last_options?.args,
                cwd: options?.cwd ?? this.last_options?.cwd,
                cols,
                rows,
                term: options?.term || this.last_options?.term || "xterm-256color",
                signal: this.abort_controller?.signal
            })
            if (!this.is_current(attempt)) {
                pty_client.detach()
                return
            }

            this.client = pty_client
            this.reconnect_attempts = 0

            // Auto-reconnect keeps prior output visible during backoff, then resets right before full replay.
            if (is_reconnect) {
                this.dispatchEvent(new Event("reset"))
            }

            this.update_state({
                status: "connected",
                session_id: pty_client.session_id,
                error: null
            })
            this.dispatchEvent(new Event("ready"))

            // Refresh sessions in background
            void this.refresh_sessions()

            pty_client.on_replay((count) => {
                if (!this.is_current(attempt)) return
                this.replay_remaining = count > 0 ? count : 0
            })

            pty_client.on_data((bytes) => {
                if (!this.is_current(attempt)) return
                let replay_bytes = 0
                if (this.replay_remaining > 0) {
                    replay_bytes = Math.min(this.replay_remaining, bytes.byteLength)
                    this.replay_remaining -= replay_bytes
                }
                for (const listener of this.data_listeners) {
                    listener(bytes, replay_bytes)
                }
            })

            pty_client.exited
                .then((status) => {
                    if (!this.is_current(attempt)) return
                    logger.info("PTY session exited", status)
                    this.client = null
                    this.update_state({
                        status: "exited",
                        exit_code: status.code
                    })
                    this.dispatchEvent(new Event("exit"))
                    void this.refresh_sessions()
                })
                .catch((err) => {
                    this.fail_attempt(attempt, err, true)
                })
        } catch (err) {
            this.fail_attempt(attempt, err, false)
        }
    }

    private begin_attempt(): number {
        this.connection_attempt += 1
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer)
            this.reconnect_timer = null
        }
        this.abort_controller?.abort()
        this.abort_controller = new AbortController()
        this.replay_remaining = 0
        if (this.client) {
            this.client.detach()
            this.client = null
        }
        return this.connection_attempt
    }

    private is_current(attempt: number): boolean {
        return attempt === this.connection_attempt
    }

    private fail_attempt(attempt: number, err: unknown, from_open_session: boolean): void {
        if (!this.is_current(attempt)) return
        const message = err instanceof Error ? err.message : String(err)
        if (from_open_session) logger.warn("PTY session disconnected", message)
        else logger.error("Failed to connect PTY session", message)
        this.client = null
        const keep_trying =
            !this.is_intentional_disconnect &&
            Boolean(this.state.session_id) &&
            !pty_taken_by_another_caller(err) &&
            !pty_session_missing(err) &&
            !(err instanceof PtySessionError)
        if (keep_trying) {
            this.schedule_reconnect()
            void this.refresh_sessions()
            return
        }
        this.update_state({
            status: "error",
            error: pty_taken_by_another_caller(err) ? "Session is open in another client" : message
        })
        if (from_open_session) this.dispatchEvent(new Event("exit"))
        void this.refresh_sessions()
    }

    private schedule_reconnect(): void {
        if (this.is_intentional_disconnect || !this.state.session_id) return
        this.reconnect_attempts++
        const backoff = Math.min(1000 * 1.5 ** (this.reconnect_attempts - 1), 10000)
        logger.info(`Scheduling PTY reconnect in ${backoff}ms (attempt ${this.reconnect_attempts})`)

        this.update_state({ status: "connecting" })

        if (this.reconnect_timer) clearTimeout(this.reconnect_timer)
        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null
            void this.open_connection(
                { ...this.last_options, session_id: this.state.session_id ?? undefined },
                { is_reconnect: true }
            )
        }, backoff)
    }

    public send(data: Uint8Array | string): void {
        if (!this.client) return
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
        this.client.send(bytes)
    }

    public resize(cols: number, rows: number): void {
        if (cols <= 0 || rows <= 0) return
        this.update_state({ cols, rows })
        this.client?.resize(cols, rows)
    }

    public disconnect(): void {
        this.is_intentional_disconnect = true
        this.connection_attempt += 1
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer)
            this.reconnect_timer = null
        }
        if (this.abort_controller) {
            this.abort_controller.abort()
            this.abort_controller = null
        }
        if (this.client) {
            try {
                this.client.close()
            } catch {
                // Ignore close error
            }
            this.client = null
        }
        this.update_state({
            status: "disconnected",
            session_id: null
        })
        void this.refresh_sessions()
    }
}

export const pty_controller = new PtyController()
