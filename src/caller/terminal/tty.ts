import type { PtySessionInfo, RexecCaller } from "@/caller"
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

    let cols = stdout.columns || 80
    let rows = stdout.rows || 24
    let session: Awaited<ReturnType<RexecCaller["open_pty"]>> | null = null
    let resized = false
    let detached_locally = false
    const pending_input: Buffer[] = []
    const abort = new AbortController()

    const on_stdin = (chunk: Buffer) => {
        const detach_at = chunk.indexOf(TTY_DETACH_BYTE)
        const payload = detach_at === -1 ? chunk : chunk.subarray(0, detach_at)
        if (payload.length > 0) {
            if (session) session.send(payload)
            else pending_input.push(Buffer.from(payload))
        }
        if (detach_at === -1 || detached_locally) return
        detached_locally = true
        if (session) session.detach()
        else abort.abort()
    }
    const on_resize = () => {
        cols = stdout.columns || cols
        rows = stdout.rows || rows
        resized = true
        session?.resize(cols, rows)
    }

    stdin.resume()
    stdin.on("data", on_stdin)
    if (is_tty) {
        stdout.on("resize", on_resize)
    }

    try {
        try {
            session = await caller.open_pty({
                session_id: options.session_id,
                file: options.session_id ? undefined : options.file,
                args: options.session_id ? undefined : options.args,
                cwd: options.session_id ? undefined : options.cwd,
                cols,
                rows,
                term: process.env.TERM || "xterm-256color",
                persistent: options.persistent,
                signal: abort.signal
            })
        } catch (err) {
            if (detached_locally) return 0
            throw err
        }
        if (detached_locally) {
            session.detach()
            return 0
        }

        process.stderr.write(`[rexec] session ${session.session_id.slice(0, 8)}  detach: Ctrl-]\n`)
        if (resized) session.resize(cols, rows)
        for (const chunk of pending_input.splice(0)) {
            session.send(chunk)
        }
        session.on_data((data) => {
            stdout.write(data)
        })
        const status = await Promise.race([session.exited, session.detached.then(() => null)])
        if (!status) return 0
        if (status.signal > 0) return 128 + status.signal
        return status.code
    } finally {
        stdin.off("data", on_stdin)
        if (is_tty) {
            stdout.off("resize", on_resize)
            stdin.setRawMode(false)
            if (detached_locally) stdout.write("\r\n")
        }
        stdin.pause()
        session?.detach()
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
