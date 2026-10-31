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

export class PtyController extends BaseController<PtyState> {
    private client: PtyClient | null = null
    private abort_controller: AbortController | null = null
    private data_listeners: Set<(data: Uint8Array) => void> = new Set()

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

    public async connect(options?: {
        file?: string
        args?: string[]
        cwd?: string
        cols?: number
        rows?: number
        term?: string
    }): Promise<void> {
        if (this.state.status === "connecting" || this.state.status === "connected") {
            this.disconnect()
        }

        const caller = session_controller.get_caller()
        this.abort_controller = new AbortController()
        const cols = options?.cols ?? this.state.cols
        const rows = options?.rows ?? this.state.rows

        this.update_state({
            status: "connecting",
            session_id: null,
            exit_code: null,
            error: null,
            cols,
            rows
        })
        this.dispatchEvent(new Event("change"))

        try {
            const pty_client = await caller.open_pty({
                file: options?.file || "/bin/bash",
                args: options?.args ?? [],
                cwd: options?.cwd,
                cols,
                rows,
                term: options?.term || "xterm-256color",
                signal: this.abort_controller.signal
            })

            this.client = pty_client

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
                    this.update_state({
                        status: "exited",
                        exit_code: status.code
                    })
                    this.client = null
                    this.dispatchEvent(new Event("change"))
                    this.dispatchEvent(new Event("exit"))
                })
                .catch((err) => {
                    const message = err instanceof Error ? err.message : String(err)
                    logger.warn("PTY session failed", message)
                    this.update_state({
                        status: "error",
                        error: message
                    })
                    this.client = null
                    this.dispatchEvent(new Event("change"))
                    this.dispatchEvent(new Event("exit"))
                })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.error("Failed to open PTY session", message)
            this.update_state({
                status: "error",
                error: message
            })
            this.client = null
            this.dispatchEvent(new Event("change"))
        }
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
