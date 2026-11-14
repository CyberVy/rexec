import { BaseController } from "@/infra/base_controller"
import { create_logger } from "@/infra/logger"
import { type PtyConnection, type PtySessionInfo } from "@rexec/caller/core"
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
    private connection: PtyConnection | null = null
    private unsubscribes: Array<() => void> = []
    private dir_abort_controller: AbortController | null = null
    private data_listeners: Set<(data: Uint8Array, replay_bytes: number) => void> = new Set()
    private last_options: ConnectOptions | null = null

    private last_session_sync_key: string

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
        this.last_session_sync_key = this.get_session_sync_key()

        const sync_from_session_controller = () => {
            const next_key = this.get_session_sync_key()
            if (next_key === this.last_session_sync_key) return
            this.last_session_sync_key = next_key

            if (!session_controller.state.hub_url || !session_controller.state.agent_online) {
                if (this.state.sessions.length > 0 || this.state.is_listing) {
                    this.update_state({ sessions: [], is_listing: false })
                }
                return
            }

            void this.refresh_sessions()
            if (!this.state.cwd) {
                void this.load_directory()
            }
        }

        session_controller.addEventListener("status_change", sync_from_session_controller)
        session_controller.addEventListener("change", sync_from_session_controller)
    }

    private get_session_sync_key(): string {
        const { active_agent_id, hub_url, agent_online } = session_controller.state
        return `${active_agent_id}:${hub_url}:${agent_online}`
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

    private async open_connection(options?: ConnectOptions, config?: { force_new?: boolean }): Promise<void> {
        const force_new = Boolean(config?.force_new)
        this.teardown_connection("detach")
        this.last_options = options ?? this.last_options

        const caller = session_controller.get_caller()
        const cols = options?.cols ?? this.state.cols
        const rows = options?.rows ?? this.state.rows
        const session_id = force_new ? undefined : (options?.session_id ?? this.state.session_id ?? undefined)
        const next_cwd = session_id
            ? (this.state.sessions.find((s) => s.session_id === session_id)?.cwd ?? null)
            : (options?.cwd ?? null)

        if (this.dir_abort_controller) {
            this.dir_abort_controller.abort()
            this.dir_abort_controller = null
        }

        this.update_state({
            status: "connecting",
            session_id: session_id ?? null,
            cwd: next_cwd,
            dir_path: null,
            dir_entries: [],
            is_loading_dir: false,
            dir_error: null,
            exit_code: null,
            error: null,
            cols,
            rows
        })

        // Clear immediately on user-initiated switch/connect so stale output does not linger while connecting.
        this.dispatchEvent(new Event("reset"))

        const connection = caller.connect_pty({
            session_id,
            file: options?.file || this.last_options?.file,
            args: options?.args ?? this.last_options?.args,
            cwd: options?.cwd ?? this.last_options?.cwd,
            cols,
            rows,
            term: options?.term || this.last_options?.term || "xterm-256color"
        })
        this.connection = connection

        let had_connected = false
        const unsub_data = connection.on_data((bytes, replay_bytes) => {
            if (this.connection !== connection) return
            for (const listener of this.data_listeners) {
                listener(bytes, replay_bytes)
            }
        })
        const unsub_reset = connection.on_reset(() => {
            if (this.connection !== connection) return
            this.dispatchEvent(new Event("reset"))
        })
        const unsub_status = connection.on_status((event) => {
            if (this.connection !== connection) return
            if (event.status === "connecting") {
                logger.info(`Scheduling PTY reconnect (attempt ${event.attempt ?? 1})`)
                this.update_state({ status: "connecting" })
                void this.refresh_sessions()
                return
            }
            if (event.status === "connected") {
                had_connected = true
                this.update_state({
                    status: "connected",
                    session_id: event.session_id,
                    error: null
                })
                this.dispatchEvent(new Event("ready"))
                void this.refresh_sessions()
                return
            }
            if (event.status === "exited") {
                logger.info("PTY session exited", { code: event.exit_code })
                this.teardown_connection("detach")
                this.update_state({
                    status: "exited",
                    exit_code: event.exit_code ?? null
                })
                this.dispatchEvent(new Event("exit"))
                void this.refresh_sessions()
                return
            }
            if (event.status === "error") {
                const message = event.error ?? "PTY session failed"
                if (had_connected) logger.warn("PTY session disconnected", message)
                else logger.error("Failed to connect PTY session", message)
                this.teardown_connection("detach")
                this.update_state({
                    status: "error",
                    error: message
                })
                if (had_connected) this.dispatchEvent(new Event("exit"))
                void this.refresh_sessions()
            }
        })

        this.unsubscribes = [unsub_data, unsub_reset, unsub_status]
        await connection.ready.catch(() => {})
    }

    private teardown_connection(action: "detach" | "close"): void {
        for (const unsub of this.unsubscribes.splice(0)) {
            unsub()
        }
        const current = this.connection
        this.connection = null
        if (!current) return
        try {
            if (action === "close") current.close()
            else current.detach()
        } catch {
            // Ignore teardown error
        }
    }

    public send(data: Uint8Array | string): void {
        if (!this.connection) return
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
        this.connection.send(bytes)
    }

    public resize(cols: number, rows: number): void {
        if (cols <= 0 || rows <= 0) return
        this.update_state({ cols, rows })
        this.connection?.resize(cols, rows)
    }

    public disconnect(): void {
        this.teardown_connection("close")
        this.update_state({
            status: "disconnected",
            session_id: null
        })
        void this.refresh_sessions()
    }

    public handle_visibility_resume(): void {
        this.connection?.resume()
    }
}

export const pty_controller = new PtyController()

if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            pty_controller.handle_visibility_resume()
        }
    })
}
