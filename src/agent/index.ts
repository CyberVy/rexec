import os from "node:os"
import type { AgentToHubMessage, HubToAgentMessage } from "@/protocol"
import { ChannelDomain, decode_forward_frame, HubWsClient } from "@/transport"
import { parse_args } from "./args"
import { ForwardManager } from "./forward_manager"
import { TaskManager } from "./task"
import { TransferManager } from "./transfer_manager"
import type { AgentOptions } from "./types"

export class RexecAgent {
    private options: AgentOptions
    private client: HubWsClient | null = null
    private tasks = new TaskManager()
    private transfers = new TransferManager()
    private forwards = new ForwardManager()
    private is_shutting_down = false

    constructor(options: AgentOptions) {
        this.options = options
    }

    start(): void {
        console.log(`[rexec-agent] Connecting to hub at ${this.options.hub_url}...`)

        this.client = new HubWsClient({
            hub_url: this.options.hub_url,
            path: "/ws",
            token: this.options.token,
            query_params: { node_id: this.options.node_id },
            reconnect: true,
            reconnect_delay_ms: 3000,
            heartbeat_interval_ms: 20000,
            on_open: () => {
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
            },
            on_message: (data) => this.handle_message(data),
            on_binary: (bytes) => this.handle_binary(bytes),
            on_close: (event) => {
                if (event.code === 4409) {
                    console.error(
                        `\n[rexec-agent] Fatal: ${event.reason || "Token is already in use by another active node."}`
                    )
                    process.exit(1)
                }
                console.warn(
                    `[rexec-agent] Connection closed (code: ${event.code}, reason: ${event.reason || "none"}). Reconnecting...`
                )
            },
            on_error: (event) => {
                console.error(`[rexec-agent] Connection error:`, event)
            }
        })

        void this.client.connect().catch((err) => {
            console.error(`[rexec-agent] Initial connection attempt failed:`, (err as Error).message)
        })

        process.on("SIGINT", () => this.shutdown("SIGINT"))
        process.on("SIGTERM", () => this.shutdown("SIGTERM"))
    }

    private send(msg: AgentToHubMessage): void {
        this.client?.send_json(msg)
    }

    private send_binary(packet: Uint8Array): void {
        this.client?.send_binary(packet)
    }

    private handle_binary(bytes: Uint8Array): void {
        if (bytes.length === 0) return

        if (bytes[0] === ChannelDomain.FORWARD) {
            const decoded = decode_forward_frame(bytes)
            if (decoded) {
                this.forwards.handle_data(decoded.conn_id, decoded.payload)
            }
        } else {
            void this.transfers.handle_binary_data(bytes)
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
            } else if (msg.type === "forward:open") {
                this.forwards.handle_open(
                    msg,
                    (m) => this.send(m),
                    (bin) => this.send_binary(bin)
                )
            } else if (msg.type === "forward:close") {
                this.forwards.handle_close(msg)
            } else if (msg.type === "forward:session_end") {
                this.forwards.handle_session_end(msg)
            } else if (msg.type === "registered") {
                console.log(`[rexec-agent] Registration confirmed by hub. Ready for commands.`)
            }
        } catch (err) {
            console.error(`[rexec-agent] Failed to parse incoming message:`, err)
        }
    }

    private shutdown(signal: string): void {
        if (this.is_shutting_down) return
        console.log(`\n[rexec-agent] Shutting down on ${signal}...`)
        this.is_shutting_down = true

        this.tasks.abort_all()
        this.transfers.abort_all()
        this.forwards.abort_all()

        this.client?.close(1000, "Agent shutting down")
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
