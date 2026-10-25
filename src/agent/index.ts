import os from "node:os"
import type { AgentToHubMessage, HubToAgentMessage } from "@/protocol"
import { parse_args } from "./args"
import { TaskManager } from "./task"
import { TransferManager } from "./transfer_manager"
import type { AgentOptions } from "./types"

export class RexecAgent {
    private options: AgentOptions
    private ws: WebSocket | null = null
    private tasks = new TaskManager()
    private transfers = new TransferManager()
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
        url.pathname = "/ws"
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
                void this.transfers.handle_binary_data(event.data)
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

    private send_binary(packet: Uint8Array): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(packet)
        }
    }

    private handle_message(raw_data: string): void {
        try {
            const msg = JSON.parse(raw_data) as HubToAgentMessage
            if (msg.type === "task:exec" || msg.type === "exec") {
                this.tasks.execute(msg, this.options.workspace, (m) => this.send(m))
            } else if (msg.type === "task:kill" || msg.type === "kill") {
                this.tasks.kill(msg)
            } else if (msg.type === "file:pull_start") {
                this.transfers.handle_pull_start(
                    msg,
                    this.options.workspace,
                    (m) => this.send(m),
                    (bin) => this.send_binary(bin)
                )
            } else if (msg.type === "file:push_start") {
                this.transfers.handle_push_start(msg, this.options.workspace, (m) => this.send(m))
            } else if (msg.type === "file:push_end") {
                void this.transfers.handle_push_end(msg.transfer_id, (m) => this.send(m))
            } else if (msg.type === "transfer:error") {
                this.transfers.handle_transfer_error(msg)
            } else if (msg.type === "registered") {
                console.log(`[rexec-agent] Registration confirmed by hub. Ready for commands.`)
            }
        } catch (err) {
            console.error(`[rexec-agent] Failed to parse incoming message:`, err)
        }
    }

    private shutdown(signal: string): void {
        console.log(`\n[rexec-agent] Shutting down on ${signal}...`)
        this.is_shutting_down = true
        this.stop_heartbeat()

        this.tasks.abort_all()
        this.transfers.abort_all()

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
