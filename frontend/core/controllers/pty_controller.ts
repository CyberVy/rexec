import { BaseController } from "@/infra/base_controller"
import { create_logger } from "@/infra/logger"
import type { PtyClient } from "@rexec/caller/core"
import { session_controller } from "./session_controller"

const logger = create_logger("PtyController")

export type PtyStatus = "disconnected" | "connecting" | "connected" | "exited" | "error"

export interface PtyState {
    status: PtyStatus
    session_id: string | null
    exit_code: number | null
    error: string | null
    cols: number
    rows: number
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
            exit_code: null,
            error: null,
            cols: 80,
            rows: 24
        }
    }

    public on_data(cb: (data: Uint8Array) => void): () => void {
        this.data_listeners.add(cb)
        return () => this.data_listeners.delete(cb)
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
    }
}

export const pty_controller = new PtyController()

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
        pty_controller.disconnect()
    })
}
