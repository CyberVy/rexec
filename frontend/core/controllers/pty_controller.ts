import { BaseController } from "@/infra/base_controller"
import { create_logger } from "@/infra/logger"
import type { PtyClient, PtySessionInfo } from "@rexec/caller/core"
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
    private data_listeners: Set<(data: Uint8Array) => void> = new Set()
    private is_intentional_disconnect = false
    private last_options: ConnectOptions | null = null
    private reconnect_timer: ReturnType<typeof setTimeout> | null = null
    private reconnect_attempts = 0

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
    }

    public on_data(cb: (data: Uint8Array) => void): () => void {
        this.data_listeners.add(cb)
        return () => this.data_listeners.delete(cb)
    }

    public async refresh_sessions(): Promise<PtySessionInfo[]> {
        if (!session_controller.state.hub_url) {
            this.update_state({ sessions: [], is_listing: false })
            this.dispatchEvent(new Event("change"))
            return []
        }

        const caller = session_controller.get_caller()
        this.update_state({ is_listing: true })
        this.dispatchEvent(new Event("change"))
        try {
            const sessions = await caller.list_ptys()
            const active_session = sessions.find((s) => s.session_id === this.state.session_id)
            const next_cwd = active_session?.cwd ?? this.state.cwd
            this.update_state({
                sessions,
                is_listing: false,
                cwd: next_cwd
            })
            this.dispatchEvent(new Event("change"))
            return sessions
        } catch (err) {
            logger.warn("Failed to list PTY sessions", err)
            this.update_state({ is_listing: false })
            this.dispatchEvent(new Event("change"))
            return []
        }
    }

    public update_cwd_from_osc7(osc_data: string): void {
        const parsed = parse_osc7_path(osc_data)
        if (!parsed || parsed === this.state.cwd) return
        this.update_state({ cwd: parsed })
        this.dispatchEvent(new Event("change"))
    }

    public async load_directory(target_path?: string): Promise<void> {
        if (!session_controller.state.hub_url) {
            this.update_state({
                is_loading_dir: false,
                dir_error: "Hub URL is required"
            })
            this.dispatchEvent(new Event("change"))
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
        this.dispatchEvent(new Event("change"))

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
            this.dispatchEvent(new Event("change"))
        } catch (err) {
            if (signal.aborted) return
            const message = err instanceof Error ? err.message : String(err)
            logger.warn("Failed to load workspace directory", message)
            this.update_state({
                is_loading_dir: false,
                dir_error: message
            })
            this.dispatchEvent(new Event("change"))
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
        this.dispatchEvent(new Event("change"))
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
        if (this.client) {
            this.client.detach()
            this.client = null
        }
        await this.connect({ ...this.last_options, session_id })
    }

    public async new_session(): Promise<void> {
        if (this.client) {
            this.client.detach()
            this.client = null
        }
        this.update_state({ session_id: null })
        await this.connect({ ...this.last_options, session_id: undefined })
    }

    public async connect(options?: ConnectOptions): Promise<void> {
        this.is_intentional_disconnect = false
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer)
            this.reconnect_timer = null
        }
        if (this.client) {
            this.client.detach()
            this.client = null
        }
        this.last_options = options ?? this.last_options

        const caller = session_controller.get_caller()
        this.abort_controller = new AbortController()
        const cols = options?.cols ?? this.state.cols
        const rows = options?.rows ?? this.state.rows

        this.update_state({
            status: "connecting",
            session_id: options?.session_id ?? this.state.session_id,
            exit_code: null,
            error: null,
            cols,
            rows
        })
        this.dispatchEvent(new Event("change"))

        try {
            const pty_client = await caller.open_pty({
                session_id: options?.session_id ?? this.state.session_id ?? undefined,
                file: options?.file || this.last_options?.file || "/bin/bash",
                args: options?.args ?? this.last_options?.args ?? [],
                cwd: options?.cwd ?? this.last_options?.cwd,
                cols,
                rows,
                term: options?.term || this.last_options?.term || "xterm-256color",
                signal: this.abort_controller.signal
            })

            this.client = pty_client
            this.reconnect_attempts = 0

            this.update_state({
                status: "connected",
                session_id: pty_client.session_id,
                error: null
            })
            this.dispatchEvent(new Event("change"))
            this.dispatchEvent(new Event("ready"))

            // Refresh sessions in background
            void this.refresh_sessions()

            pty_client.on_data((bytes) => {
                for (const listener of this.data_listeners) {
                    listener(bytes)
                }
            })

            pty_client.exited
                .then((status) => {
                    logger.info("PTY session exited", status)
                    this.client = null
                    this.update_state({
                        status: "exited",
                        exit_code: status.code
                    })
                    this.dispatchEvent(new Event("change"))
                    this.dispatchEvent(new Event("exit"))
                    void this.refresh_sessions()
                })
                .catch((err) => {
                    const message = err instanceof Error ? err.message : String(err)
                    logger.warn("PTY session disconnected", message)
                    this.client = null

                    if (!this.is_intentional_disconnect && this.state.session_id) {
                        this.schedule_reconnect()
                    } else {
                        this.update_state({
                            status: "error",
                            error: message
                        })
                        this.dispatchEvent(new Event("change"))
                        this.dispatchEvent(new Event("exit"))
                    }
                    void this.refresh_sessions()
                })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.error("Failed to connect PTY session", message)
            this.client = null

            if (!this.is_intentional_disconnect && this.state.session_id) {
                this.schedule_reconnect()
            } else {
                this.update_state({
                    status: "error",
                    error: message
                })
                this.dispatchEvent(new Event("change"))
            }
            void this.refresh_sessions()
        }
    }

    private schedule_reconnect(): void {
        if (this.is_intentional_disconnect || !this.state.session_id) return
        this.reconnect_attempts++
        const backoff = Math.min(1000 * 1.5 ** (this.reconnect_attempts - 1), 10000)
        logger.info(`Scheduling PTY reconnect in ${backoff}ms (attempt ${this.reconnect_attempts})`)

        this.update_state({ status: "connecting" })
        this.dispatchEvent(new Event("change"))

        if (this.reconnect_timer) clearTimeout(this.reconnect_timer)
        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null
            void this.connect({ ...this.last_options, session_id: this.state.session_id ?? undefined })
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
        this.dispatchEvent(new Event("change"))
        void this.refresh_sessions()
    }
}

export const pty_controller = new PtyController()

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
        pty_controller.disconnect()
    })
}
