import { type PtySessionInfo, type RexecCaller } from "@/caller"
import { ReplayQueryFilter, ReplayReplyFence, TTY_MODE_RESET, TTY_SCREEN_RESET } from "./tty_replay"
import { format_bytes } from "./ui"

const TTY_DETACH_BYTE = 0x1d

export interface RunTtyOptions {
    file?: string
    args?: string[]
    cwd?: string
    session_id?: string
    persistent?: boolean
}

export async function run_tty(caller: RexecCaller, options: RunTtyOptions): Promise<number> {
    const stdin = process.stdin
    const stdout = process.stdout
    const is_tty = Boolean(stdin.isTTY && stdout.isTTY)
    if (is_tty) {
        stdin.setRawMode(true)
    }

    let is_ready = false
    let in_replay = false
    let has_written_output = false
    let detached_locally = false
    let had_error = false
    let signal_exit_code: number | null = null
    // Buffers piped stdin or early keystrokes until the initial handshake finishes.
    const pending_input: Buffer[] = []

    const replay_filter = new ReplayQueryFilter()
    const replay_fence = new ReplayReplyFence(!is_tty || process.env.TERM === "dumb")

    const connection = caller.connect_pty({
        session_id: options.session_id,
        file: options.session_id ? undefined : options.file,
        args: options.session_id ? undefined : options.args,
        cwd: options.session_id ? undefined : options.cwd,
        cols: stdout.columns || 80,
        rows: stdout.rows || 24,
        term: process.env.TERM || "xterm-256color",
        persistent: options.session_id ? undefined : options.persistent
    })

    const forward_input = (data: Uint8Array) => {
        if (is_ready) connection.send(data)
        else pending_input.push(Buffer.from(data))
    }

    connection.on_reset(() => {
        if (!is_tty) return
        has_written_output = true
        stdout.write(TTY_SCREEN_RESET)
    })

    connection.on_status((event) => {
        if (event.status !== "connected" && in_replay) {
            in_replay = false
            replay_filter.reset()
            replay_fence.reset()
        }
    })

    connection.on_data((data, replay_bytes) => {
        if (replay_bytes <= 0) {
            if (data.byteLength > 0) {
                has_written_output = true
                stdout.write(data)
            }
            return
        }

        if (is_tty && !in_replay) {
            in_replay = true
            replay_filter.reset()
            replay_fence.begin_replay(forward_input)
        }

        const replay_slice = replay_bytes === data.byteLength ? data : data.subarray(0, replay_bytes)
        const live_slice = replay_bytes === data.byteLength ? null : data.subarray(replay_bytes)

        if (is_tty) {
            const filtered = replay_filter.push(replay_slice)
            if (filtered.byteLength > 0) {
                has_written_output = true
                stdout.write(filtered)
            }
            if (connection.replay_remaining === 0) {
                in_replay = false
                const tail = replay_filter.flush()
                if (tail.byteLength > 0) {
                    has_written_output = true
                    stdout.write(tail)
                }
                replay_fence.end_replay((seq) => stdout.write(seq), forward_input)
            }
        } else if (replay_slice.byteLength > 0) {
            has_written_output = true
            stdout.write(replay_slice)
        }

        if (live_slice && live_slice.byteLength > 0) {
            has_written_output = true
            stdout.write(live_slice)
        }
    })

    const on_stdin = (chunk: Buffer) => {
        const detach_at = chunk.indexOf(TTY_DETACH_BYTE)
        const payload = detach_at === -1 ? chunk : chunk.subarray(0, detach_at)
        if (payload.length > 0) {
            replay_fence.push_input(payload, forward_input)
        }
        if (detach_at === -1 || detached_locally) return
        detached_locally = true
        connection.detach()
    }

    const on_resize = () => {
        if (stdout.columns && stdout.rows) {
            connection.resize(stdout.columns, stdout.rows)
        }
    }

    const on_signal = (exit_code: number) => {
        if (detached_locally) return
        signal_exit_code = exit_code
        detached_locally = true
        connection.detach()
    }
    const on_sigint = () => on_signal(130)
    const on_sigterm = () => on_signal(143)
    const on_sighup = () => on_signal(129)

    stdin.resume()
    stdin.on("data", on_stdin)
    if (is_tty) {
        stdout.on("resize", on_resize)
    }
    process.on("SIGINT", on_sigint)
    process.on("SIGTERM", on_sigterm)
    process.on("SIGHUP", on_sighup)

    try {
        const session_id = await connection.ready
        if (detached_locally) return signal_exit_code ?? 0
        is_ready = true
        process.stderr.write(`[rexec] session ${session_id.slice(0, 8)}  detach: Ctrl-]\n`)
        for (const chunk of pending_input.splice(0)) {
            connection.send(chunk)
        }

        const status = await Promise.race([connection.exited, connection.detached.then(() => null)])
        if (detached_locally || !status) return signal_exit_code ?? 0
        if (status.signal > 0) return 128 + status.signal
        return status.code
    } catch (err) {
        if (detached_locally) return signal_exit_code ?? 0
        had_error = true
        throw err
    } finally {
        replay_fence.dispose()
        stdin.off("data", on_stdin)
        process.off("SIGINT", on_sigint)
        process.off("SIGTERM", on_sigterm)
        process.off("SIGHUP", on_sighup)
        if (is_tty) {
            stdout.off("resize", on_resize)
            stdin.setRawMode(false)
            if (has_written_output) {
                stdout.write(TTY_MODE_RESET)
            }
            if (detached_locally || (had_error && has_written_output)) {
                stdout.write("\r\n")
            }
        }
        stdin.pause()
        connection.detach()
    }
}

export async function list_tty_sessions(caller: RexecCaller): Promise<void> {
    const sessions = await caller.list_ptys()
    if (sessions.length === 0) {
        console.log("No PTY sessions.")
        return
    }

    const headers = ["ID", "STATUS", "PERSIST", "TTL", "BUF", "CMD", "CWD"]
    const rows = sessions.map((session) => [
        session.session_id.slice(0, 8),
        session.status,
        session.persistent ? "yes" : "no",
        format_ttl(session),
        format_bytes(session.buffered_bytes),
        session.command || "shell",
        session.cwd || ""
    ])
    const widths = headers.map((header, index) =>
        Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0))
    )
    const format_row = (cells: string[]) =>
        cells.map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join("  ")

    console.log(format_row(headers))
    for (const row of rows) console.log(format_row(row))
}

export async function resolve_tty_session(caller: RexecCaller, prefix: string): Promise<PtySessionInfo> {
    const sessions = await caller.list_ptys()
    const exact = sessions.find((session) => session.session_id === prefix)
    if (exact) return exact
    const matches = sessions.filter((session) => session.session_id.startsWith(prefix))
    if (matches.length === 1) return matches[0]
    if (matches.length === 0) {
        throw new Error(`No PTY session matches '${prefix}'`)
    }
    const lines = matches.map((session) => `${session.session_id}  ${session.status}  ${session.command}`).join("\n")
    throw new Error(`Session '${prefix}' matches multiple sessions:\n${lines}`)
}

function format_ttl(session: PtySessionInfo): string {
    if (session.persistent) return "-"
    const ms = session.remaining_ttl_ms ?? session.orphan_ttl_ms
    const total_s = Math.max(0, Math.ceil(ms / 1000))
    const hours = Math.floor(total_s / 3600)
    const minutes = Math.floor((total_s % 3600) / 60)
    const seconds = total_s % 60
    if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
    if (minutes > 0) return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`
    return `${seconds}s`
}
