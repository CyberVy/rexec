import fs from "node:fs"
import net from "node:net"
import { Worker } from "node:worker_threads"
import type { ConptyNative } from "./pty_binding"
import type { PtyExitStatus, PtyHandle, PtySpawnOptions } from "./pty_session"

const USE_CONPTY_DLL = true
const CONNECT_TIMEOUT_MS = 5000
const FLUSH_MS = 1000

let pipe_serial = 0

/**
 * ConPTY's output pipe is synchronous. Connecting it on the agent thread blocks
 * the event loop inside ConnectNamedPipe, so a worker thread connects first and
 * relays bytes back over a second pipe.
 */
const CONOUT_WORKER_SOURCE = [
    `"use strict"`,
    `const { workerData, parentPort } = require("node:worker_threads")`,
    `const net = require("node:net")`,
    `if (!parentPort) throw new Error("ConPTY worker has no parent port")`,
    `const conout = workerData.conout`,
    `const socket = net.connect(conout)`,
    `socket.on("error", (err) => { throw err })`,
    `socket.on("connect", () => {`,
    `  const server = net.createServer((client) => { socket.pipe(client) })`,
    `  server.on("error", (err) => { throw err })`,
    `  server.listen(conout + "-worker", () => { parentPort.postMessage("ready") })`,
    `})`
].join("\n")

export class WindowsPtyProcess implements PtyHandle {
    private pid_value = 0
    private readonly conpty: ConptyNative
    private readonly pty_id: number
    private readonly conout: string
    private readonly command_line: string
    private readonly options: PtySpawnOptions
    private readonly on_data: (data: Uint8Array) => void
    private readonly on_exit: (status: PtyExitStatus) => void
    private in_socket: net.Socket | null = null
    private out_socket: net.Socket | null = null
    private worker: Worker | null = null
    private pending: Buffer[] = []
    private exit_status: PtyExitStatus | null = null
    private output_closed = false
    private connected = false
    private closing = false
    private finished = false
    private connect_timer: NodeJS.Timeout | null = null
    private destroy_timer: NodeJS.Timeout | null = null

    public constructor(
        conpty: ConptyNative,
        options: PtySpawnOptions,
        on_data: (data: Uint8Array) => void,
        on_exit: (status: PtyExitStatus) => void
    ) {
        this.conpty = conpty
        this.options = options
        this.on_data = on_data
        this.on_exit = on_exit
        this.command_line = win32_command_line(options.file, options.args)

        pipe_serial += 1
        const started = conpty.startProcess(
            options.file,
            options.cols,
            options.rows,
            false,
            `rexec-${process.pid}-${pipe_serial}`,
            false,
            USE_CONPTY_DLL
        )
        this.pty_id = started.pty
        this.conout = started.conout
        try {
            this.attach_input(started.conin)
            this.start_worker()
        } catch (err) {
            try {
                conpty.kill(started.pty, USE_CONPTY_DLL)
            } catch {
                // The pseudoconsole is already gone.
            }
            throw err
        }
    }

    public get pid(): number {
        return this.pid_value
    }

    public write(data: Uint8Array): void {
        if (data.byteLength === 0 || this.finished || this.closing) return
        const chunk = Buffer.from(data)
        if (!this.in_socket) {
            this.pending.push(chunk)
            return
        }
        this.in_socket.write(chunk)
    }

    public resize(cols: number, rows: number): void {
        if (this.finished || this.closing) return
        this.conpty.resize(this.pty_id, cols, rows, USE_CONPTY_DLL)
    }

    public kill(): void {
        if (this.finished || this.closing) return
        this.closing = true
        this.clear_connect_timer()
        this.in_socket?.destroy()
        try {
            this.conpty.kill(this.pty_id, USE_CONPTY_DLL)
        } catch {
            // The pseudoconsole is already gone.
        }
        if (!this.connected) {
            this.exit_status = { code: 1, signal: 0 }
            this.output_closed = true
            this.finish()
            return
        }
        this.arm_destroy()
    }

    private attach_input(conin: string): void {
        const fd = fs.openSync(conin, "w")
        const socket = new net.Socket({ fd, readable: false, writable: true })
        socket.on("error", (err: NodeJS.ErrnoException) => {
            const code = err.code || ""
            if (code === "EPIPE" || code === "EOF" || code === "ECONNRESET") return
            console.error(`[rexec-agent] PTY write error: ${err.message}`)
        })
        this.in_socket = socket
        const pending = this.pending.splice(0)
        for (const chunk of pending) socket.write(chunk)
    }

    private start_worker(): void {
        this.connect_timer = setTimeout(() => {
            this.fail_start(new Error("Timed out waiting for the ConPTY output worker"))
        }, CONNECT_TIMEOUT_MS)
        const worker = new Worker(CONOUT_WORKER_SOURCE, {
            eval: true,
            workerData: { conout: this.conout }
        })
        this.worker = worker
        worker.once("message", (message: unknown) => {
            if (message === "ready") this.on_worker_ready()
        })
        worker.once("error", (err: Error) => {
            this.fail_start(err)
        })
    }

    private on_worker_ready(): void {
        if (this.closing || this.finished) return
        this.clear_connect_timer()
        this.attach_output()
        try {
            const started = this.conpty.connect(
                this.pty_id,
                this.command_line,
                this.options.cwd,
                this.options.env,
                USE_CONPTY_DLL,
                (code) => this.handle_native_exit(code)
            )
            this.pid_value = started.pid
            this.connected = true
        } catch (err) {
            this.fail_start(err as Error)
        }
    }

    private attach_output(): void {
        const socket = net.createConnection(`${this.conout}-worker`)
        this.out_socket = socket
        socket.on("data", (chunk: Buffer | string) => {
            if (this.finished) return
            this.on_data(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
        })
        socket.on("error", (err: NodeJS.ErrnoException) => {
            if (this.finished || this.closing) return
            if (!this.connected) {
                this.fail_start(err)
                return
            }
            const code = err.code || ""
            if (code === "ECONNRESET" || code === "EPIPE" || code === "EOF") return
            console.error(`[rexec-agent] PTY read error: ${err.message}`)
        })
        socket.on("close", () => {
            this.output_closed = true
            if (this.exit_status) this.finish()
        })
    }

    private handle_native_exit(code: number): void {
        if (this.exit_status) return
        this.exit_status = { code, signal: 0 }
        if (this.output_closed) {
            this.finish()
            return
        }
        this.arm_destroy()
    }

    private fail_start(err: Error): void {
        if (this.finished || this.closing) return
        this.closing = true
        this.clear_connect_timer()
        console.error(`[rexec-agent] ConPTY start failed: ${err.message}`)
        try {
            this.conpty.kill(this.pty_id, USE_CONPTY_DLL)
        } catch {
            // The pseudoconsole is already gone.
        }
        this.exit_status = { code: 1, signal: 0 }
        this.output_closed = true
        this.finish()
    }

    private arm_destroy(): void {
        if (this.destroy_timer || this.finished) return
        this.destroy_timer = setTimeout(() => {
            if (!this.exit_status) this.exit_status = { code: 1, signal: 0 }
            this.output_closed = true
            this.finish()
        }, FLUSH_MS)
    }

    private finish(): void {
        if (this.finished || !this.exit_status) return
        this.finished = true
        this.clear_connect_timer()
        if (this.destroy_timer) {
            clearTimeout(this.destroy_timer)
            this.destroy_timer = null
        }
        this.release()
        this.on_exit(this.exit_status)
    }

    private release(): void {
        this.in_socket?.destroy()
        this.in_socket = null
        this.out_socket?.destroy()
        this.out_socket = null
        const worker = this.worker
        this.worker = null
        void worker?.terminate()
    }

    private clear_connect_timer(): void {
        if (!this.connect_timer) return
        clearTimeout(this.connect_timer)
        this.connect_timer = null
    }
}

function win32_command_line(file: string, args: string[]): string {
    return [file, ...args].map(quote_win32_arg).join(" ")
}

function quote_win32_arg(arg: string): string {
    if (arg.length === 0) return '""'
    if (!/[\t "]/.test(arg)) return arg
    let quoted = '"'
    let slashes = 0
    for (const char of arg) {
        if (char === "\\") {
            slashes += 1
            continue
        }
        if (char === '"') {
            quoted += "\\".repeat(slashes * 2 + 1) + '"'
            slashes = 0
            continue
        }
        if (slashes > 0) {
            quoted += "\\".repeat(slashes)
            slashes = 0
        }
        quoted += char
    }
    quoted += "\\".repeat(slashes * 2) + '"'
    return quoted
}
