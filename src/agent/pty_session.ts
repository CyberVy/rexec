import fs from "node:fs"
import tty from "node:tty"
import type { PtyNative } from "./pty_binding"
import { signal_process_tree_until_dead } from "./process_tree"

const DESTROY_TIMEOUT_MS = 200

interface WriteTask {
    buffer: Buffer
    offset: number
}

export interface PtyExitStatus {
    code: number
    signal: number
}

export interface PtySpawnOptions {
    file: string
    args: string[]
    cwd: string
    env: string[]
    cols: number
    rows: number
    helper_path: string
}

export class PtyProcess {
    public readonly pid: number
    private readonly native: PtyNative
    private readonly fd: number
    private readonly socket: tty.ReadStream
    private readonly queue: WriteTask[] = []
    private write_scheduled = false
    private finished = false
    private exit_status: PtyExitStatus | null = null
    private readonly on_data: (data: Uint8Array) => void
    private readonly on_exit: (status: PtyExitStatus) => void

    public constructor(
        native: PtyNative,
        options: PtySpawnOptions,
        on_data: (data: Uint8Array) => void,
        on_exit: (status: PtyExitStatus) => void
    ) {
        this.native = native
        this.on_data = on_data
        this.on_exit = on_exit

        const term = native.fork(
            options.file,
            options.args,
            options.env,
            options.cwd,
            options.cols,
            options.rows,
            -1,
            -1,
            true,
            options.helper_path,
            (code, signal) => this.handle_native_exit(code, signal)
        )
        this.pid = term.pid
        this.fd = term.fd
        this.socket = new tty.ReadStream(term.fd)
        this.socket.resume()

        this.socket.on("data", (chunk: Buffer | string) => {
            const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
            this.on_data(bytes)
        })
        this.socket.on("error", (err: NodeJS.ErrnoException) => {
            const code = err.code || ""
            if (code === "EIO" || code === "EAGAIN" || code === "EPIPE" || code === "EBADF") {
                return
            }
            console.error(`[rexec-agent] PTY read error: ${err.message}`)
        })
        this.socket.on("close", () => this.finish())
    }

    public write(data: Uint8Array): void {
        if (data.byteLength === 0 || this.finished) return
        this.queue.push({ buffer: Buffer.from(data), offset: 0 })
        if (!this.write_scheduled) {
            this.write_scheduled = true
            this.flush()
        }
    }

    public resize(cols: number, rows: number): void {
        if (this.finished) return
        this.native.resize(this.fd, cols, rows, 0, 0)
    }

    public kill(): void {
        if (this.finished) return
        signal_process_tree_until_dead(this.pid, "SIGHUP", () => this.exit_status !== null || this.finished)
        this.arm_destroy()
    }

    private handle_native_exit(code: number, signal: number): void {
        this.exit_status = { code, signal }
        if (this.socket.destroyed) {
            this.finish()
            return
        }
        this.arm_destroy()
    }

    private arm_destroy(): void {
        const timer = setTimeout(() => {
            if (!this.socket.destroyed) this.socket.destroy()
        }, DESTROY_TIMEOUT_MS)
        this.socket.once("close", () => clearTimeout(timer))
    }

    private finish(): void {
        if (this.finished || !this.exit_status) return
        this.finished = true
        this.queue.length = 0
        this.on_exit(this.exit_status)
    }

    private flush(): void {
        this.write_scheduled = false
        const task = this.queue[0]
        if (!task || this.finished) return

        fs.write(this.fd, task.buffer, task.offset, task.buffer.length - task.offset, (err, written) => {
            if (err) {
                const code = (err as NodeJS.ErrnoException).code
                if (code === "EAGAIN") {
                    this.write_scheduled = true
                    setImmediate(() => this.flush())
                    return
                }
                this.queue.length = 0
                return
            }
            task.offset += written
            if (task.offset >= task.buffer.length) {
                this.queue.shift()
            }
            if (this.queue.length > 0) {
                this.flush()
            }
        })
    }
}
