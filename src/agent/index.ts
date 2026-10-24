import { spawn, type ChildProcess } from "node:child_process"
import os from "node:os"
import path from "node:path"
import type { AgentToHubMessage, HubToAgentMessage, TaskExecMessage, TaskKillMessage } from "@/protocol"

interface AgentOptions {
    hub_url: string
    token: string
    workspace: string
    node_id: string
}

function parse_args(): AgentOptions {
    const args = process.argv.slice(2)
    let hub_url = ""
    let token = ""
    let workspace = process.cwd()
    let node_id = os.hostname()

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "--hub" && i + 1 < args.length) {
            hub_url = args[++i]
        } else if (arg === "--token" && i + 1 < args.length) {
            token = args[++i]
        } else if (arg === "--workspace" && i + 1 < args.length) {
            workspace = path.resolve(args[++i])
        } else if (arg === "--node-id" && i + 1 < args.length) {
            node_id = args[++i]
        }
    }

    if (!hub_url) {
        console.error("Error: Missing required argument --hub <url>")
        process.exit(1)
    }

    if (!token) {
        console.error("Error: Missing required argument --token <secret>")
        process.exit(1)
    }

    return { hub_url, token, workspace, node_id }
}

class RexecAgent {
    private options: AgentOptions
    private ws: WebSocket | null = null
    private running_tasks: Map<string, ChildProcess> = new Map()
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
        } catch (err) {
            console.error(`[rexec-agent] WebSocket creation failed:`, err)
            this.schedule_reconnect()
            return
        }

        this.ws.addEventListener("open", () => {
            console.log(`[rexec-agent] Connected to hub. Node ID: ${this.options.node_id}`)
            console.log(`[rexec-agent] Workspace: ${this.options.workspace}`)
            this.send({
                type: "register",
                node_id: this.options.node_id,
                hostname: os.hostname()
            })
            this.start_heartbeat()
        })

        this.ws.addEventListener("message", (event) => {
            this.handle_message(event.data)
        })

        this.ws.addEventListener("close", (event) => {
            this.stop_heartbeat()
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

    private handle_message(raw_data: unknown): void {
        if (typeof raw_data !== "string") return
        try {
            const msg = JSON.parse(raw_data) as HubToAgentMessage
            if (msg.type === "exec") {
                this.execute_task(msg)
            } else if (msg.type === "kill") {
                this.kill_task(msg)
            } else if (msg.type === "registered") {
                console.log(`[rexec-agent] Registration confirmed by hub. Ready for commands.`)
            }
        } catch (err) {
            console.error(`[rexec-agent] Failed to parse incoming message:`, err)
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

const options = parse_args()
const agent = new RexecAgent(options)
agent.start()
