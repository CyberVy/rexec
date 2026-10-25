import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    TRANSFER_ID_BYTES,
    type AgentToHubMessage,
    type FilePullStartMessage,
    type FilePushStartMessage,
    type HubToAgentMessage,
    type TaskExecMessage,
    type TaskKillMessage,
    type TransferErrorMessage
} from "@/protocol"

interface AgentOptions {
    hub_url: string
    token: string
    workspace: string
    node_id: string
    is_auto_generated: boolean
}

function print_usage(): void {
    console.log(`rexec-agent - Remote worker node daemon for rexec

Usage:
  rexec-agent [options]

Options:
  --hub <url>          Hub WebSocket/HTTP URL (or via REXEC_HUB env var)
  --token <secret>     Auth Token (auto-generated if omitted, or via REXEC_TOKEN env var)
  --workspace <dir>    Base workspace directory (default: current working directory)
  --node-id <id>       Worker node identifier (default: hostname)
  -h, --help           Show this help message

Examples:
  rexec-agent --hub wss://hub.example.com
  rexec-agent --hub http://127.0.0.1:8787 --token my-custom-secret --workspace ./workspace
`)
}

function parse_args(): AgentOptions {
    const args = process.argv.slice(2)
    if (args.includes("-h") || args.includes("--help")) {
        print_usage()
        process.exit(0)
    }

    let hub_url = ""
    let token = ""
    let workspace = process.cwd()
    let node_id = os.hostname()

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "--hub" && i + 1 < args.length) {
            hub_url = args[++i]
        } else if (arg.startsWith("--hub=")) {
            hub_url = arg.slice("--hub=".length)
        } else if (arg === "--token" && i + 1 < args.length) {
            token = args[++i]
        } else if (arg.startsWith("--token=")) {
            token = arg.slice("--token=".length)
        } else if (arg === "--workspace" && i + 1 < args.length) {
            workspace = path.resolve(args[++i])
        } else if (arg.startsWith("--workspace=")) {
            workspace = path.resolve(arg.slice("--workspace=".length))
        } else if (arg === "--node-id" && i + 1 < args.length) {
            node_id = args[++i]
        } else if (arg.startsWith("--node-id=")) {
            node_id = arg.slice("--node-id=".length)
        }
    }

    hub_url = hub_url || process.env.REXEC_HUB || ""
    token = token || process.env.REXEC_TOKEN || ""

    if (!hub_url) {
        console.error("Error: Missing Hub URL. Provide --hub <url> or set REXEC_HUB env var.")
        process.exit(1)
    }

    let is_auto_generated = false
    if (!token) {
        token = `rexec_sec_${crypto.randomBytes(16).toString("hex")}`
        is_auto_generated = true
    }

    return { hub_url, token, workspace, node_id, is_auto_generated }
}

class RexecAgent {
    private options: AgentOptions
    private ws: WebSocket | null = null
    private running_tasks: Map<string, ChildProcess> = new Map()
    private active_pulls: Map<string, { stream?: fs.ReadStream; tar_proc?: ChildProcess }> = new Map()
    private active_pushes: Map<
        string,
        {
            write_stream?: fs.WriteStream
            tar_proc?: ChildProcess
            hash: crypto.Hash
            target_path: string
            target_size: number
            is_directory?: boolean
        }
    > = new Map()
    private is_shutting_down = false
    private heartbeat_timer: ReturnType<typeof setInterval> | null = null

    constructor(options: AgentOptions) {
        this.options = options
    }

    start(): void {
        this.connect()

        process.on("SIGINT", () => this.shutdown("SIGINT"))
        process.on("SIGTERM", () => this.shutdown("SIGTERM"))
    }

    private format_ws_url(): string {
        let base = this.options.hub_url.trim()
        if (base.startsWith("https://")) {
            base = "wss://" + base.slice(8)
        } else if (base.startsWith("http://")) {
            base = "ws://" + base.slice(7)
        } else if (!base.startsWith("wss://") && !base.startsWith("ws://")) {
            base = "wss://" + base
        }

        const url = new URL(base)
        if (url.pathname === "/" || url.pathname === "") {
            url.pathname = "/ws"
        }
        url.searchParams.set("token", this.options.token)
        url.searchParams.set("node_id", this.options.node_id)
        return url.toString()
    }

    private connect(): void {
        if (this.is_shutting_down) return

        const ws_url = this.format_ws_url()
        console.log(`[rexec-agent] Connecting to ${ws_url}...`)

        try {
            this.ws = new WebSocket(ws_url)
            this.ws.binaryType = "arraybuffer"
        } catch (err) {
            console.error(`[rexec-agent] WebSocket creation failed:`, err)
            this.schedule_reconnect()
            return
        }

        this.ws.addEventListener("open", () => {
            console.log(`[rexec-agent] Connected to hub. Node ID: ${this.options.node_id}`)
            console.log(`[rexec-agent] Workspace: ${this.options.workspace}`)
            console.log(`[rexec-agent] Session Token: ${this.options.token}`)

            if (this.options.is_auto_generated) {
                console.log(`
======================================================
Session Token generated!
To run commands from your local machine, use:
  rexec --hub ${this.options.hub_url} --token ${this.options.token} <command...>

Or set environment variables:
  export REXEC_HUB=${this.options.hub_url}
  export REXEC_TOKEN=${this.options.token}
======================================================
`)
            }

            this.send({
                type: "register",
                node_id: this.options.node_id,
                hostname: os.hostname()
            })
            this.start_heartbeat()
        })

        this.ws.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
                this.handle_message(event.data)
            } else {
                this.handle_binary_data(event.data)
            }
        })

        this.ws.addEventListener("close", (event) => {
            this.stop_heartbeat()
            if (event.code === 4409) {
                console.error(
                    `\n[rexec-agent] Fatal: ${event.reason || "Token is already in use by another active node."}`
                )
                process.exit(1)
            }
            console.warn(`[rexec-agent] Connection closed (code: ${event.code}, reason: ${event.reason || "none"})`)
            this.schedule_reconnect()
        })

        this.ws.addEventListener("error", (event) => {
            console.error(`[rexec-agent] Connection error:`, event)
        })
    }

    private schedule_reconnect(): void {
        if (this.is_shutting_down) return
        const delay_ms = 3000
        console.log(`[rexec-agent] Reconnecting in ${delay_ms / 1000}s...`)
        setTimeout(() => this.connect(), delay_ms)
    }

    private start_heartbeat(): void {
        this.stop_heartbeat()
        this.heartbeat_timer = setInterval(() => {
            this.send({ type: "ping" })
        }, 20000)
    }

    private stop_heartbeat(): void {
        if (this.heartbeat_timer) {
            clearInterval(this.heartbeat_timer)
            this.heartbeat_timer = null
        }
    }

    private send(msg: AgentToHubMessage): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg))
        }
    }

    private handle_message(raw_data: string): void {
        try {
            const msg = JSON.parse(raw_data) as HubToAgentMessage
            if (msg.type === "task:exec" || msg.type === "exec") {
                this.execute_task(msg)
            } else if (msg.type === "task:kill" || msg.type === "kill") {
                this.kill_task(msg)
            } else if (msg.type === "file:pull_start") {
                this.handle_pull_start(msg)
            } else if (msg.type === "file:push_start") {
                this.handle_push_start(msg)
            } else if (msg.type === "file:push_end") {
                this.handle_push_end(msg.transfer_id)
            } else if (msg.type === "transfer:error") {
                this.handle_transfer_error(msg)
            } else if (msg.type === "registered") {
                console.log(`[rexec-agent] Registration confirmed by hub. Ready for commands.`)
            }
        } catch (err) {
            console.error(`[rexec-agent] Failed to parse incoming message:`, err)
        }
    }

    private async handle_binary_data(data: unknown): Promise<void> {
        let buf: Buffer
        if (Buffer.isBuffer(data)) {
            buf = data
        } else if (data instanceof ArrayBuffer) {
            buf = Buffer.from(data)
        } else if (ArrayBuffer.isView(data)) {
            buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        } else if (data && typeof (data as Blob).arrayBuffer === "function") {
            const ab = await (data as Blob).arrayBuffer()
            buf = Buffer.from(ab)
        } else {
            return
        }

        if (buf.length < TRANSFER_ID_BYTES) return
        const transfer_id = buf.subarray(0, TRANSFER_ID_BYTES).toString("utf-8")
        const chunk = buf.subarray(TRANSFER_ID_BYTES)

        const push = this.active_pushes.get(transfer_id)
        if (push) {
            push.hash.update(chunk)
            if (push.is_directory && push.tar_proc?.stdin) {
                push.tar_proc.stdin.write(chunk)
            } else if (push.write_stream) {
                push.write_stream.write(chunk)
            }
        }
    }

    private execute_task(msg: TaskExecMessage): void {
        const { task_id, cmd, cwd, env } = msg
        const task_cwd = cwd ? path.resolve(this.options.workspace, cwd) : this.options.workspace
        const task_env = { ...process.env, ...env }

        console.log(`[rexec-agent] [task:${task_id.slice(0, 8)}] Spawning: ${cmd} (cwd: ${task_cwd})`)

        const child = spawn(cmd, {
            shell: true,
            cwd: task_cwd,
            env: task_env
        })

        this.running_tasks.set(task_id, child)

        child.stdout?.on("data", (chunk: Buffer) => {
            this.send({
                type: "chunk",
                task_id,
                stream: "stdout",
                data: chunk.toString("utf-8")
            })
        })

        child.stderr?.on("data", (chunk: Buffer) => {
            this.send({
                type: "chunk",
                task_id,
                stream: "stderr",
                data: chunk.toString("utf-8")
            })
        })

        child.on("close", (code, signal) => {
            console.log(
                `[rexec-agent] [task:${task_id.slice(0, 8)}] Exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`
            )
            this.running_tasks.delete(task_id)
            this.send({
                type: "exit",
                task_id,
                code,
                signal
            })
        })

        child.on("error", (err) => {
            console.error(`[rexec-agent] [task:${task_id.slice(0, 8)}] Spawn error:`, err)
            this.send({
                type: "chunk",
                task_id,
                stream: "stderr",
                data: `rexec: failed to spawn process: ${err.message}\n`
            })
            this.send({
                type: "exit",
                task_id,
                code: 1,
                signal: null
            })
            this.running_tasks.delete(task_id)
        })
    }

    private async handle_pull_start(msg: FilePullStartMessage): Promise<void> {
        const target_path = path.isAbsolute(msg.path)
            ? path.resolve(msg.path)
            : path.resolve(this.options.workspace, msg.path)

        console.log(`[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Preparing to send: ${target_path}`)

        try {
            const stat = await fs.promises.stat(target_path)
            if (stat.isDirectory()) {
                if (!msg.recursive) {
                    this.send({
                        type: "transfer:error",
                        transfer_id: msg.transfer_id,
                        error: `Path '${msg.path}' is a directory. Use -r or --recursive to transfer directories.`
                    })
                    return
                }

                this.send({
                    type: "file:pull_meta",
                    transfer_id: msg.transfer_id,
                    meta: {
                        path: target_path,
                        size: 0,
                        is_directory: true
                    }
                })

                const id_header = Buffer.from(msg.transfer_id, "utf-8")
                const hash = crypto.createHash("sha256")
                const tar_env = { ...process.env, COPYFILE_DISABLE: "1" }
                const tar_proc = spawn("tar", ["-cf", "-", "--exclude=.DS_Store", "-C", target_path, "."], {
                    env: tar_env,
                    stdio: ["ignore", "pipe", "pipe"]
                })

                tar_proc.stdout.on("data", (chunk: Buffer | string) => {
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                    hash.update(buf)
                    const packet = Buffer.concat([id_header, buf])
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(new Uint8Array(packet.buffer, packet.byteOffset, packet.byteLength))
                    }
                })

                let stderr_output = ""
                tar_proc.stderr?.on("data", (chunk: Buffer) => {
                    stderr_output += chunk.toString("utf-8")
                })

                tar_proc.on("close", (code) => {
                    if (code === 0) {
                        const sha256 = hash.digest("hex")
                        console.log(
                            `[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Directory archive completed (sha256: ${sha256.slice(0, 8)})`
                        )
                        this.send({
                            type: "file:pull_end",
                            transfer_id: msg.transfer_id,
                            sha256
                        })
                    } else {
                        console.error(`[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] tar failed:`, stderr_output)
                        this.send({
                            type: "transfer:error",
                            transfer_id: msg.transfer_id,
                            error: `Failed to archive directory: ${stderr_output || `exit code ${code}`}`
                        })
                    }
                    this.active_pulls.delete(msg.transfer_id)
                })

                tar_proc.on("error", (err) => {
                    this.send({
                        type: "transfer:error",
                        transfer_id: msg.transfer_id,
                        error: `Failed to start tar: ${err.message}`
                    })
                    this.active_pulls.delete(msg.transfer_id)
                })

                this.active_pulls.set(msg.transfer_id, { tar_proc })
                return
            }

            this.send({
                type: "file:pull_meta",
                transfer_id: msg.transfer_id,
                meta: {
                    path: target_path,
                    size: stat.size,
                    mtime: stat.mtimeMs,
                    mode: stat.mode
                }
            })

            const id_header = Buffer.from(msg.transfer_id, "utf-8")
            const hash = crypto.createHash("sha256")
            const stream = fs.createReadStream(target_path, { highWaterMark: 64 * 1024 })

            stream.on("data", (chunk: Buffer | string) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                hash.update(buf)
                const packet = Buffer.concat([id_header, buf])
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(packet)
                }
            })

            stream.on("end", () => {
                const sha256 = hash.digest("hex")
                console.log(
                    `[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Completed (${stat.size} bytes, sha256: ${sha256.slice(0, 8)})`
                )
                this.send({
                    type: "file:pull_end",
                    transfer_id: msg.transfer_id,
                    sha256
                })
                this.active_pulls.delete(msg.transfer_id)
            })

            stream.on("error", (err) => {
                console.error(`[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Read error:`, err)
                this.send({
                    type: "transfer:error",
                    transfer_id: msg.transfer_id,
                    error: `Failed to read file: ${err.message}`
                })
                this.active_pulls.delete(msg.transfer_id)
            })

            this.active_pulls.set(msg.transfer_id, { stream })
        } catch {
            this.send({
                type: "transfer:error",
                transfer_id: msg.transfer_id,
                error: `File not found: ${msg.path}`
            })
        }
    }

    private handle_push_start(msg: FilePushStartMessage): void {
        const target_path = path.isAbsolute(msg.path)
            ? path.resolve(msg.path)
            : path.resolve(this.options.workspace, msg.path)

        console.log(
            `[rexec-agent] [push:${msg.transfer_id.slice(0, 8)}] Preparing to receive: ${target_path} (${msg.recursive ? "directory" : `${msg.size} bytes`})`
        )

        try {
            if (msg.recursive) {
                fs.mkdirSync(target_path, { recursive: true })
                const hash = crypto.createHash("sha256")
                const tar_proc = spawn("tar", ["-xf", "-", "-C", target_path], {
                    stdio: ["pipe", "ignore", "pipe"]
                })

                let stderr_output = ""
                tar_proc.stderr?.on("data", (chunk: Buffer) => {
                    stderr_output += chunk.toString("utf-8")
                })

                tar_proc.on("error", (err) => {
                    console.error(`[rexec-agent] [push:${msg.transfer_id.slice(0, 8)}] tar spawn error:`, err)
                    this.send({
                        type: "transfer:error",
                        transfer_id: msg.transfer_id,
                        error: `Failed to spawn tar: ${err.message}`
                    })
                    this.active_pushes.delete(msg.transfer_id)
                })

                this.active_pushes.set(msg.transfer_id, {
                    tar_proc,
                    hash,
                    target_path,
                    target_size: msg.size,
                    is_directory: true
                })
                return
            }

            fs.mkdirSync(path.dirname(target_path), { recursive: true })
            const write_stream = fs.createWriteStream(target_path)
            const hash = crypto.createHash("sha256")

            write_stream.on("error", (err) => {
                console.error(`[rexec-agent] [push:${msg.transfer_id.slice(0, 8)}] Write error:`, err)
                this.send({
                    type: "transfer:error",
                    transfer_id: msg.transfer_id,
                    error: `Failed to write file: ${err.message}`
                })
                this.active_pushes.delete(msg.transfer_id)
            })

            this.active_pushes.set(msg.transfer_id, {
                write_stream,
                hash,
                target_path,
                target_size: msg.size
            })
        } catch (err) {
            this.send({
                type: "transfer:error",
                transfer_id: msg.transfer_id,
                error: `Failed to initialize destination: ${(err as Error).message}`
            })
        }
    }

    private handle_push_end(transfer_id: string): void {
        const push = this.active_pushes.get(transfer_id)
        if (!push) return

        if (push.is_directory && push.tar_proc) {
            push.tar_proc.stdin?.end(() => {})
            push.tar_proc.on("close", (code) => {
                if (code === 0) {
                    const sha256 = push.hash.digest("hex")
                    console.log(
                        `[rexec-agent] [push:${transfer_id.slice(0, 8)}] Directory unpack completed (sha256: ${sha256.slice(0, 8)})`
                    )
                    this.send({
                        type: "file:push_end",
                        transfer_id,
                        sha256
                    })
                } else {
                    this.send({
                        type: "transfer:error",
                        transfer_id,
                        error: `tar extraction failed with exit code ${code}`
                    })
                }
                this.active_pushes.delete(transfer_id)
            })
            return
        }

        push.write_stream?.end(() => {
            const sha256 = push.hash.digest("hex")
            console.log(
                `[rexec-agent] [push:${transfer_id.slice(0, 8)}] Completed (${push.target_size} bytes, sha256: ${sha256.slice(0, 8)})`
            )
            this.send({
                type: "file:push_end",
                transfer_id,
                sha256
            })
            this.active_pushes.delete(transfer_id)
        })
    }

    private handle_transfer_error(msg: TransferErrorMessage): void {
        const pull = this.active_pulls.get(msg.transfer_id)
        if (pull) {
            pull.stream?.destroy()
            pull.tar_proc?.kill("SIGTERM")
            this.active_pulls.delete(msg.transfer_id)
        }
        const push = this.active_pushes.get(msg.transfer_id)
        if (push) {
            push.write_stream?.destroy()
            push.tar_proc?.kill("SIGTERM")
            this.active_pushes.delete(msg.transfer_id)
        }
    }

    private kill_task(msg: TaskKillMessage): void {
        const child = this.running_tasks.get(msg.task_id)
        if (child) {
            console.log(`[rexec-agent] Killing task ${msg.task_id.slice(0, 8)} with signal ${msg.signal || "SIGINT"}`)
            child.kill((msg.signal as NodeJS.Signals) || "SIGINT")
        }
    }

    private shutdown(signal: string): void {
        console.log(`\n[rexec-agent] Shutting down on ${signal}...`)
        this.is_shutting_down = true
        this.stop_heartbeat()

        for (const [task_id, child] of this.running_tasks) {
            console.log(`[rexec-agent] Terminating running task ${task_id.slice(0, 8)}`)
            child.kill("SIGTERM")
        }
        this.running_tasks.clear()

        for (const [, pull] of this.active_pulls) {
            pull.stream?.destroy()
            pull.tar_proc?.kill("SIGTERM")
        }
        this.active_pulls.clear()

        for (const [, push] of this.active_pushes) {
            push.write_stream?.destroy()
            push.tar_proc?.kill("SIGTERM")
        }
        this.active_pushes.clear()

        if (this.ws) {
            try {
                this.ws.close(1000, "Agent shutting down")
            } catch {
                // Ignore
            }
        }

        process.exit(0)
    }
}

function check_websocket_support(): void {
    if (typeof WebSocket === "undefined") {
        console.error(
            `[rexec-agent] Error: Global WebSocket is not available in Node.js ${process.version}.\n` +
                `Please run with Node.js 22+ or provide the experimental flag:\n` +
                `  NODE_OPTIONS="--experimental-websocket" rexec-agent ...\n` +
                `or:\n` +
                `  node --experimental-websocket <path-to-rexec-agent> ...`
        )
        process.exit(1)
    }
}

const options = parse_args()
check_websocket_support()
const agent = new RexecAgent(options)
agent.start()
