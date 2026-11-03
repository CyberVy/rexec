import path from "node:path"
import type {
    AgentToHubMessage,
    PtyAttachMessage,
    PtyCloseMessage,
    PtyOpenMessage,
    PtyResizeMessage,
    PtySessionInfo,
    PtyUpdateMessage
} from "@/protocol"
import { encode_pty_frame } from "@/transport"
import { load_pty_binding, type PtyBinding } from "./pty_binding"
import { PtyProcess, type PtyExitStatus, type PtyHandle, type PtySpawnOptions } from "./pty_session"
import { PtyRingBuffer } from "./ring_buffer"
import { WindowsPtyProcess } from "./windows_pty"

interface PtySlot {
    status: "attached" | "detached" | "closed"
    cols: number
    rows: number
    pending: Uint8Array[]
    process: PtyHandle | null
    ring_buffer: PtyRingBuffer
    orphan_ttl_ms: number
    orphan_timer?: NodeJS.Timeout
    command: string
    cwd?: string
    started_at: number
    detached_at?: number
    persistent: boolean
}

const STRIPPED_ENV = ["TMUX", "TMUX_PANE", "STY", "WINDOW", "WINDOWID", "TERMCAP", "COLUMNS", "LINES"]
const DEFAULT_ORPHAN_TTL_MS = 10 * 60 * 1000 // 10 minutes

export class PtyManager {
    private sessions: Map<string, PtySlot> = new Map()
    private binding: PtyBinding | null = null
    private hub_url: string

    public constructor(hub_url: string) {
        this.hub_url = hub_url
    }

    public open(
        msg: PtyOpenMessage,
        base_workspace: string,
        send: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void
    ): void {
        const session_id = msg.session_id
        const existing = this.sessions.get(session_id)
        if (existing?.status === "closed") return
        if (existing?.process) {
            existing.process.kill()
        }

        const orphan_ttl_ms =
            msg.orphan_ttl_ms ??
            (process.env.REXEC_PTY_ORPHAN_TTL_MS ? Number(process.env.REXEC_PTY_ORPHAN_TTL_MS) : DEFAULT_ORPHAN_TTL_MS)
        const persistent = Boolean(msg.persistent)

        const slot: PtySlot = existing ?? {
            status: "attached",
            cols: dimension(msg.cols, 80),
            rows: dimension(msg.rows, 24),
            pending: [],
            process: null,
            ring_buffer: new PtyRingBuffer(),
            orphan_ttl_ms,
            command: msg.file || "sh",
            cwd: msg.cwd,
            started_at: Date.now(),
            persistent
        }
        slot.status = "attached"
        slot.cols = dimension(msg.cols, slot.cols)
        slot.rows = dimension(msg.rows, slot.rows)
        slot.orphan_ttl_ms = orphan_ttl_ms
        slot.cwd = msg.cwd
        slot.detached_at = undefined
        if (msg.persistent !== undefined) {
            slot.persistent = persistent
        }
        if (slot.orphan_timer) {
            clearTimeout(slot.orphan_timer)
            slot.orphan_timer = undefined
        }
        this.sessions.set(session_id, slot)

        let file = msg.file?.trim() ?? ""
        if (process.platform === "win32" && (file === "/bin/bash" || file === "/bin/sh" || file.length === 0)) {
            file = process.env.COMSPEC || "cmd.exe"
        }
        if (!file) {
            this.fail(session_id, "Missing command", send)
            return
        }

        const cwd = msg.cwd ? path.resolve(base_workspace, msg.cwd) : base_workspace
        slot.cwd = cwd
        const args = Array.isArray(msg.args) ? msg.args.map((arg) => String(arg)) : []
        slot.command = [file, ...args].filter(Boolean).join(" ") || file
        void this.spawn(session_id, slot, file, args, cwd, msg.term?.trim() || "xterm-256color", send, send_binary)
    }

    public attach(
        msg: PtyAttachMessage,
        send: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void
    ): void {
        const session_id = msg.session_id
        const slot = this.sessions.get(session_id)
        if (!slot || slot.status === "closed") {
            this.fail(session_id, "PTY session not found or expired", send)
            return
        }
        if (slot.orphan_timer) {
            clearTimeout(slot.orphan_timer)
            slot.orphan_timer = undefined
        }
        slot.status = "attached"
        slot.detached_at = undefined
        console.log(
            `[rexec-agent] [pty:${session_id.slice(0, 8)}] Attached. Replaying ${slot.ring_buffer.byte_length} bytes.`
        )

        if (msg.cols && msg.rows) {
            this.resize({ type: "pty:resize", session_id, cols: msg.cols, rows: msg.rows })
        }

        // Replay restores the screen. Queries in that history ask the terminal to
        // answer; a new xterm would type the reply into the shell's unsent line.
        const replay = omit_terminal_queries(slot.ring_buffer.get_chunks())
        if (replay.byteLength > 0) {
            send_binary(encode_pty_frame(session_id, replay))
        }

        // Flush any pending input
        if (slot.pending.length > 0 && slot.process) {
            const pending = slot.pending.splice(0)
            for (const chunk of pending) {
                slot.process.write(chunk)
            }
        }

        // Trigger SIGWINCH to redraw application state
        slot.process?.resize(slot.cols, slot.rows)
    }

    public detach(session_id: string): void {
        const slot = this.sessions.get(session_id)
        if (!slot || slot.status === "closed" || slot.status === "detached") return
        slot.status = "detached"
        slot.detached_at = Date.now()
        if (slot.persistent) {
            console.log(`[rexec-agent] [pty:${session_id.slice(0, 8)}] Detached. Persistent session (no orphan timer).`)
            if (slot.orphan_timer) {
                clearTimeout(slot.orphan_timer)
                slot.orphan_timer = undefined
            }
            return
        }
        console.log(
            `[rexec-agent] [pty:${session_id.slice(0, 8)}] Detached. Starting orphan timer (${slot.orphan_ttl_ms}ms).`
        )
        if (slot.orphan_timer) clearTimeout(slot.orphan_timer)
        slot.orphan_timer = setTimeout(() => {
            console.log(`[rexec-agent] [pty:${session_id.slice(0, 8)}] Orphan TTL expired. Reaping process.`)
            this.close({ type: "pty:close", session_id })
        }, slot.orphan_ttl_ms)
        slot.orphan_timer.unref?.()
    }

    public update(msg: PtyUpdateMessage): void {
        const slot = this.sessions.get(msg.session_id)
        if (!slot || slot.status === "closed") return
        slot.persistent = Boolean(msg.persistent)
        console.log(`[rexec-agent] [pty:${msg.session_id.slice(0, 8)}] Updated persistent status: ${slot.persistent}`)
        if (slot.persistent) {
            if (slot.orphan_timer) {
                clearTimeout(slot.orphan_timer)
                slot.orphan_timer = undefined
            }
        } else if (slot.status === "detached") {
            if (slot.orphan_timer) clearTimeout(slot.orphan_timer)
            slot.orphan_timer = setTimeout(() => {
                console.log(`[rexec-agent] [pty:${msg.session_id.slice(0, 8)}] Orphan TTL expired. Reaping process.`)
                this.close({ type: "pty:close", session_id: msg.session_id })
            }, slot.orphan_ttl_ms)
            slot.orphan_timer.unref?.()
        }
    }

    public list(): PtySessionInfo[] {
        const now = Date.now()
        const result: PtySessionInfo[] = []
        for (const [session_id, slot] of this.sessions) {
            if (slot.status === "closed") continue
            const remaining_ttl_ms =
                slot.status === "detached" && slot.detached_at
                    ? Math.max(0, slot.orphan_ttl_ms - (now - slot.detached_at))
                    : slot.orphan_ttl_ms
            result.push({
                session_id,
                status: slot.status,
                command: slot.command,
                cwd: slot.cwd,
                started_at: slot.started_at,
                detached_at: slot.detached_at,
                orphan_ttl_ms: slot.orphan_ttl_ms,
                remaining_ttl_ms: slot.persistent ? undefined : remaining_ttl_ms,
                buffered_bytes: slot.ring_buffer.byte_length,
                persistent: slot.persistent
            })
        }
        return result
    }

    public write(session_id: string, payload: Uint8Array): void {
        const slot = this.sessions.get(session_id)
        if (!slot || slot.status === "closed" || payload.byteLength === 0) return
        if (slot.process) {
            slot.process.write(payload)
            return
        }
        slot.pending.push(payload)
    }

    public resize(msg: PtyResizeMessage): void {
        const slot = this.sessions.get(msg.session_id)
        if (!slot || slot.status === "closed") return
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
                status: "closed",
                cols: 80,
                rows: 24,
                pending: [],
                process: null,
                ring_buffer: new PtyRingBuffer(),
                orphan_ttl_ms: 0,
                command: "closed",
                started_at: 0,
                persistent: false
            })
            return
        }
        slot.status = "closed"
        if (slot.orphan_timer) {
            clearTimeout(slot.orphan_timer)
            slot.orphan_timer = undefined
        }
        slot.pending.length = 0
        slot.ring_buffer.clear()
        slot.process?.kill()
        this.sessions.delete(msg.session_id)
    }

    public abort_all(): void {
        for (const slot of this.sessions.values()) {
            slot.status = "closed"
            if (slot.orphan_timer) clearTimeout(slot.orphan_timer)
            slot.pending.length = 0
            slot.ring_buffer.clear()
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
            this.binding ??= await load_pty_binding(this.hub_url)
            if (slot.status === "closed") {
                this.sessions.delete(session_id)
                return
            }

            const rendered_args = args.length > 0 ? ` ${args.join(" ")}` : ""
            console.log(`[rexec-agent] [pty:${session_id.slice(0, 8)}] Spawning: ${file}${rendered_args} (cwd: ${cwd})`)

            const initial_osc7 = new TextEncoder().encode(`\x1b]7;file://localhost${cwd}\x07`)
            slot.ring_buffer.write(initial_osc7)
            if (slot.status === "attached") {
                send_binary(encode_pty_frame(session_id, initial_osc7))
            }

            const proc = open_pty_process(
                this.binding,
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
                    if (slot.status === "closed") return
                    const detected_cwd = extract_osc7_cwd(data)
                    if (detected_cwd) {
                        slot.cwd = detected_cwd
                    }
                    slot.ring_buffer.write(data)
                    if (slot.status === "attached") {
                        send_binary(encode_pty_frame(session_id, data))
                    }
                },
                (status) => {
                    console.log(
                        `[rexec-agent] [pty:${session_id.slice(0, 8)}] Exited with code ${status.code}${status.signal ? ` (signal: ${status.signal})` : ""}`
                    )
                    if (slot.orphan_timer) clearTimeout(slot.orphan_timer)
                    this.sessions.delete(session_id)
                    if (slot.status !== "closed") {
                        send({
                            type: "pty:exit",
                            session_id,
                            code: status.code,
                            signal: status.signal
                        })
                    }
                }
            )
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

function open_pty_process(
    binding: PtyBinding,
    options: PtySpawnOptions,
    on_data: (data: Uint8Array) => void,
    on_exit: (status: PtyExitStatus) => void
): PtyHandle {
    if (process.platform === "win32") {
        if (!binding.conpty) throw new Error("Missing Windows ConPTY binding")
        return new WindowsPtyProcess(binding.conpty, options, on_data, on_exit)
    }
    if (!binding.native) throw new Error("Missing Unix PTY binding")
    return new PtyProcess(binding.native, options, on_data, on_exit)
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
    const osc7_hook = 'printf "\\033]7;file://localhost%s\\007" "$PWD"'
    env.PROMPT_COMMAND = env.PROMPT_COMMAND ? `${env.PROMPT_COMMAND}; ${osc7_hook}` : osc7_hook
    return Object.entries(env).map(([key, value]) => `${key}=${value}`)
}

const MAX_QUERY_BYTES = 64

// Remove terminal queries from a replay snapshot. Color and mode changes stay.
function omit_terminal_queries(chunks: Uint8Array[]): Uint8Array {
    let total = 0
    for (const chunk of chunks) total += chunk.byteLength
    if (total === 0) return new Uint8Array()

    const input = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        input.set(chunk, offset)
        offset += chunk.byteLength
    }

    const output = new Uint8Array(total)
    let written = 0
    for (let i = 0; i < input.length; i++) {
        const skip = input[i] === 0x1b ? terminal_query_length(input, i) : 0
        if (skip > 0) {
            i += skip - 1
            continue
        }
        output[written++] = input[i]
    }
    return written === total ? input : output.subarray(0, written)
}

function terminal_query_length(input: Uint8Array, start: number): number {
    const kind = input[start + 1]
    if (kind === 0x5d) return osc_color_query_length(input, start)
    if (kind === 0x5b) return csi_report_query_length(input, start)
    if (kind === 0x50) return dcs_status_query_length(input, start)
    return 0
}

function osc_color_query_length(input: Uint8Array, start: number): number {
    const limit = Math.min(input.length, start + MAX_QUERY_BYTES)
    for (let i = start + 2; i < limit; i++) {
        const bel = input[i] === 0x07
        const st = input[i] === 0x1b && input[i + 1] === 0x5c
        if (!bel && !st) continue
        const body = new TextDecoder().decode(input.subarray(start + 2, i))
        if (!is_osc_color_query(body)) return 0
        return (bel ? i + 1 : i + 2) - start
    }
    return 0
}

function is_osc_color_query(body: string): boolean {
    const parts = body.split(";")
    if (parts.length < 2) return false
    const first = Number(parts[0])
    if (first === 4) {
        if (parts.length < 3 || parts.length % 2 === 0) return false
        for (let i = 1; i < parts.length; i += 2) {
            const index = parts[i]
            if (index === "" || !/^\d+$/.test(index) || parts[i + 1] !== "?") return false
        }
        return true
    }
    if (first !== 10 && first !== 11 && first !== 12) return false
    // `11;?`, stacked `10;?;?`, or repeated `10;?;11;?`. A real color spec stays.
    let saw_query = false
    for (let i = 1; i < parts.length; i++) {
        const token = parts[i]
        if (token === "?") {
            saw_query = true
            continue
        }
        const command = Number(token)
        if (command === 4 || command === 10 || command === 11 || command === 12) continue
        return false
    }
    return saw_query
}

function csi_report_query_length(input: Uint8Array, start: number): number {
    const limit = Math.min(input.length, start + MAX_QUERY_BYTES)
    let cursor = start + 2
    const param_start = cursor
    while (cursor < limit && input[cursor] >= 0x30 && input[cursor] <= 0x3f) cursor++
    const intermediate_start = cursor
    while (cursor < limit && input[cursor] >= 0x20 && input[cursor] <= 0x2f) cursor++
    if (cursor >= limit) return 0
    const final_byte = input[cursor]
    if (final_byte < 0x40 || final_byte > 0x7e) return 0
    const params = new TextDecoder().decode(input.subarray(param_start, intermediate_start))
    const intermediates = new TextDecoder().decode(input.subarray(intermediate_start, cursor))
    return is_csi_report_query(params, intermediates, final_byte) ? cursor + 1 - start : 0
}

function is_csi_report_query(params: string, intermediates: string, final_byte: number): boolean {
    // DECRQM: CSI Ps $ p and CSI ? Ps $ p. xterm answers with CSI Ps ; Pm $ y.
    if (intermediates === "$" && final_byte === 0x70) return true
    if (intermediates !== "") return false
    if (final_byte === 0x63) {
        return params === "" || params === "0" || params === ">" || params === ">0"
    }
    if (final_byte === 0x6e) return params === "5" || params === "6" || params === "?6"
    if (final_byte === 0x74) {
        return params === "14" || params === "16" || params === "18" || params === "20" || params === "21"
    }
    return false
}

function dcs_status_query_length(input: Uint8Array, start: number): number {
    if (input[start + 2] !== 0x24 || input[start + 3] !== 0x71) return 0
    const limit = Math.min(input.length, start + MAX_QUERY_BYTES)
    for (let i = start + 4; i < limit; i++) {
        if (input[i] === 0x1b && input[i + 1] === 0x5c) return i + 2 - start
    }
    return 0
}

const OSC7_PREFIX = "\x1b]7;file://"

function extract_osc7_cwd(data: Uint8Array): string | null {
    // Fast check for ESC (0x1b) followed by ']' (0x5d) and '7' (0x37)
    let has_osc7 = false
    for (let i = 0; i + 2 < data.length; i++) {
        if (data[i] === 0x1b && data[i + 1] === 0x5d && data[i + 2] === 0x37) {
            has_osc7 = true
            break
        }
    }
    if (!has_osc7) return null
    const text = new TextDecoder().decode(data)
    const start_idx = text.lastIndexOf(OSC7_PREFIX)
    if (start_idx === -1) return null
    const after_prefix = text.slice(start_idx + OSC7_PREFIX.length)
    const slash_idx = after_prefix.indexOf("/")
    if (slash_idx === -1) return null
    const from_slash = after_prefix.slice(slash_idx)
    const bel_idx = from_slash.indexOf("\x07")
    const st_idx = from_slash.indexOf("\x1b\\")
    const end_idx = bel_idx !== -1 && st_idx !== -1 ? Math.min(bel_idx, st_idx) : bel_idx !== -1 ? bel_idx : st_idx
    if (end_idx <= 0) return null
    const raw_path = from_slash.slice(0, end_idx)
    try {
        return decodeURIComponent(raw_path)
    } catch {
        return raw_path
    }
}
