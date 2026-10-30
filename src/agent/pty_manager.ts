import path from "node:path"
import type { AgentToHubMessage, PtyCloseMessage, PtyOpenMessage, PtyResizeMessage } from "@/protocol"
import { encode_pty_frame } from "@/transport"
import { load_pty_binding, type PtyBinding } from "./pty_binding"
import { PtyProcess } from "./pty_session"

interface PtySlot {
    closed: boolean
    cols: number
    rows: number
    pending: Uint8Array[]
    process: PtyProcess | null
}

const STRIPPED_ENV = ["TMUX", "TMUX_PANE", "STY", "WINDOW", "WINDOWID", "TERMCAP", "COLUMNS", "LINES"]

export class PtyManager {
    private sessions: Map<string, PtySlot> = new Map()
    private binding: PtyBinding | null = null

    public open(
        msg: PtyOpenMessage,
        base_workspace: string,
        send: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void
    ): void {
        const session_id = msg.session_id
        const existing = this.sessions.get(session_id)
        if (existing?.closed) return
        if (existing?.process) {
            existing.process.kill()
        }

        const slot: PtySlot = existing ?? {
            closed: false,
            cols: dimension(msg.cols, 80),
            rows: dimension(msg.rows, 24),
            pending: [],
            process: null
        }
        slot.cols = dimension(msg.cols, slot.cols)
        slot.rows = dimension(msg.rows, slot.rows)
        this.sessions.set(session_id, slot)

        const file = msg.file?.trim()
        if (!file) {
            this.fail(session_id, "Missing command", send)
            return
        }

        const cwd = msg.cwd ? path.resolve(base_workspace, msg.cwd) : base_workspace
        const args = Array.isArray(msg.args) ? msg.args.map((arg) => String(arg)) : []
        void this.spawn(session_id, slot, file, args, cwd, msg.term?.trim() || "xterm-256color", send, send_binary)
    }

    public write(session_id: string, payload: Uint8Array): void {
        const slot = this.sessions.get(session_id)
        if (!slot || slot.closed || payload.byteLength === 0) return
        if (slot.process) {
            slot.process.write(payload)
            return
        }
        slot.pending.push(payload)
    }

    public resize(msg: PtyResizeMessage): void {
        const slot = this.sessions.get(msg.session_id)
        if (!slot || slot.closed) return
        const cols = dimension(msg.cols, 0)
        const rows = dimension(msg.rows, 0)
        if (!cols || !rows) return
        slot.cols = cols
        slot.rows = rows
        slot.process?.resize(cols, rows)
    }

    public close(msg: PtyCloseMessage): void {
        const slot = this.sessions.get(msg.session_id)
        if (!slot) {
            this.sessions.set(msg.session_id, {
                closed: true,
                cols: 80,
                rows: 24,
                pending: [],
                process: null
            })
            return
        }
        slot.closed = true
        slot.pending.length = 0
        slot.process?.kill()
    }

    public abort_all(): void {
        for (const slot of this.sessions.values()) {
            slot.closed = true
            slot.process?.kill()
        }
        this.sessions.clear()
    }

    private async spawn(
        session_id: string,
        slot: PtySlot,
        file: string,
        args: string[],
        cwd: string,
        term: string,
        send: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void
    ): Promise<void> {
        try {
            this.binding ??= await load_pty_binding()
            if (slot.closed) {
                this.sessions.delete(session_id)
                return
            }

            const rendered_args = args.length > 0 ? ` ${args.join(" ")}` : ""
            console.log(`[rexec-agent] [pty:${session_id.slice(0, 8)}] Spawning: ${file}${rendered_args} (cwd: ${cwd})`)

            const proc = new PtyProcess(
                this.binding.native,
                {
                    file,
                    args,
                    cwd,
                    env: build_env(term, cwd),
                    cols: slot.cols,
                    rows: slot.rows,
                    helper_path: this.binding.helper_path
                },
                (data) => {
                    if (!slot.closed) send_binary(encode_pty_frame(session_id, data))
                },
                (status) => {
                    console.log(
                        `[rexec-agent] [pty:${session_id.slice(0, 8)}] Exited with code ${status.code}${status.signal ? ` (signal: ${status.signal})` : ""}`
                    )
                    this.sessions.delete(session_id)
                    if (!slot.closed) {
                        send({
                            type: "pty:exit",
                            session_id,
                            code: status.code,
                            signal: status.signal
                        })
                    }
                }
            )
            if (slot.closed) {
                proc.kill()
                this.sessions.delete(session_id)
                return
            }
            slot.process = proc
            try {
                proc.resize(slot.cols, slot.rows)
            } catch {
                // fork already applied the size captured before this call.
            }
            const pending = slot.pending.splice(0)
            for (const chunk of pending) {
                proc.write(chunk)
            }
        } catch (err) {
            this.fail(session_id, (err as Error).message, send)
        }
    }

    private fail(session_id: string, error: string, send: (msg: AgentToHubMessage) => void): void {
        console.error(`[rexec-agent] [pty:${session_id.slice(0, 8)}] ${error}`)
        this.sessions.delete(session_id)
        send({ type: "pty:error", session_id, error })
    }
}

function dimension(value: number, fallback: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 1000) return fallback
    return value
}

function build_env(term: string, cwd: string): string[] {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value
    }
    for (const key of STRIPPED_ENV) {
        delete env[key]
    }
    env.TERM = term
    env.PWD = cwd
    return Object.entries(env).map(([key, value]) => `${key}=${value}`)
}
