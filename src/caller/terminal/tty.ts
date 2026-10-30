import type { RexecCaller } from "@/caller"

export async function run_tty(caller: RexecCaller, file: string, args: string[], cwd?: string): Promise<number> {
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
    const pending_input: Buffer[] = []
    const on_stdin = (chunk: Buffer) => {
        if (session) session.send(chunk)
        else pending_input.push(chunk)
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
        session = await caller.open_pty({
            file,
            args,
            cwd,
            cols,
            rows,
            term: process.env.TERM || "xterm-256color"
        })
        if (resized) session.resize(cols, rows)
        for (const chunk of pending_input.splice(0)) {
            session.send(chunk)
        }
        session.on_data((data) => {
            stdout.write(data)
        })
        const status = await session.exited
        if (status.signal > 0) return 128 + status.signal
        return status.code
    } finally {
        stdin.off("data", on_stdin)
        if (is_tty) {
            stdout.off("resize", on_resize)
            stdin.setRawMode(false)
        }
        stdin.pause()
        session?.close()
    }
}
