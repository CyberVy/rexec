import crypto from "node:crypto"
import os from "node:os"
import {
    AGENT_REPLACED_REASON,
    HUB_ROUTES,
    type AgentChannelName,
    type AgentToHubMessage,
    type HubToAgentMessage
} from "@/protocol"
import {
    WsClient,
    build_ws_url,
    decode_forward_frame,
    decode_pty_frame,
    unwrap_client_binary,
    unwrap_client_text,
    wrap_client_binary,
    wrap_client_text
} from "@/transport"
import { parse_args } from "./args"
import { ForwardManager } from "./forward_manager"
import { PtyManager } from "./pty_manager"
import { TaskManager } from "./task"
import { TransferManager } from "./transfer_manager"
import type { AgentOptions } from "./types"

const DEFAULT_PING_INTERVAL_MS = 20000
const DEFAULT_IDLE_TIMEOUT_MS = 60000

const AGENT_CHANNEL_PATHS: Record<AgentChannelName, string> = {
    pty: HUB_ROUTES.WS_AGENT_PTY.path,
    forward: HUB_ROUTES.WS_AGENT_FORWARD.path,
    exec: HUB_ROUTES.WS_AGENT_EXEC.path,
    file: HUB_ROUTES.WS_AGENT_FILE.path
}

function env_ms(name: string, fallback: number): number {
    const raw = process.env[name]
    if (raw === undefined || raw.trim() === "") return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return fallback
    return value
}

export class RexecAgent {
    private options: AgentOptions
    private readonly instance_id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    private readonly clients: Partial<Record<AgentChannelName, WsClient>> = {}
    private tasks = new TaskManager()
    private transfers = new TransferManager()
    private forwards = new ForwardManager()
    private ptys: PtyManager
    private has_logged_banner = false
    private is_shutting_down = false

    public constructor(options: AgentOptions) {
        this.options = options
        this.ptys = new PtyManager(options.hub_url)
    }

    public start(): void {
        console.log(`[rexec-agent] Connecting to hub at ${this.options.hub_url}...`)

        const ping_interval_ms = env_ms("REXEC_HEARTBEAT_INTERVAL_MS", DEFAULT_PING_INTERVAL_MS)
        const idle_timeout_ms = env_ms(
            "REXEC_HEARTBEAT_TIMEOUT_MS",
            ping_interval_ms > 0 ? (ping_interval_ms * DEFAULT_IDLE_TIMEOUT_MS) / DEFAULT_PING_INTERVAL_MS : 0
        )
        const reconnect_delay_ms = env_ms("REXEC_RECONNECT_DELAY_MS", 3000)
        const connect_timeout_ms = env_ms("REXEC_CONNECT_TIMEOUT_MS", 10000)

        for (const channel of Object.keys(AGENT_CHANNEL_PATHS) as AgentChannelName[]) {
            const client = new WsClient({
                url: build_ws_url(this.options.hub_url, AGENT_CHANNEL_PATHS[channel], this.options.token, {
                    node_id: this.options.node_id,
                    instance_id: this.instance_id
                }),
                reconnect: true,
                reconnect_delay_ms,
                ping_interval_ms,
                idle_timeout_ms,
                connect_timeout_ms,
                on_open: () => this.on_channel_open(channel),
                on_message: (data) => this.handle_channel_message(channel, data),
                on_binary: (bytes) => this.handle_channel_binary(channel, bytes),
                on_error: (event) => {
                    console.error(`[rexec-agent] [${channel}] Connection error:`, event)
                },
                on_dead: (reason) => {
                    console.log(`[rexec-agent] [${channel}] Session dead (${reason}). Reconnecting.`)
                },
                on_close: (event) => {
                    if (event.code === 1000 && event.reason === AGENT_REPLACED_REASON) {
                        console.log(`[rexec-agent] Connection closed (${AGENT_REPLACED_REASON}).`)
                        this.shutdown(AGENT_REPLACED_REASON)
                    }
                }
            })

            this.clients[channel] = client
            void client.connect().catch((err) => {
                console.error(`[rexec-agent] [${channel}] Initial connection attempt failed:`, (err as Error).message)
            })
        }

        process.on("SIGINT", () => this.shutdown("SIGINT"))
        process.on("SIGTERM", () => this.shutdown("SIGTERM"))
        process.on("SIGHUP", () => this.shutdown("SIGHUP"))
    }

    private on_channel_open(channel: AgentChannelName): void {
        if (!this.has_logged_banner) {
            this.has_logged_banner = true
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
        }

        console.log(`[rexec-agent] [${channel}] Channel connected`)
        this.send_channel_json(channel, {
            type: "register",
            node_id: this.options.node_id,
            hostname: os.hostname()
        })
    }

    private send_channel_json(channel: AgentChannelName, msg: AgentToHubMessage): void {
        this.clients[channel]?.send_json(msg)
    }

    private send_channel_text(channel: AgentChannelName, text: string): void {
        this.clients[channel]?.send_text(text)
    }

    private send_channel_binary(channel: AgentChannelName, packet: Uint8Array): void {
        this.clients[channel]?.send_binary(packet)
    }

    private handle_channel_binary(channel: AgentChannelName, bytes: Uint8Array): void {
        if (bytes.length === 0) return

        if (channel === "pty") {
            const outer = unwrap_client_binary(bytes)
            if (!outer) return
            const decoded = decode_pty_frame(outer.payload)
            if (decoded) {
                this.ptys.write(decoded.session_id, decoded.payload, outer.client_id)
            }
            return
        }

        if (channel === "forward") {
            const outer = unwrap_client_binary(bytes)
            if (!outer) return
            const decoded = decode_forward_frame(outer.payload)
            if (decoded) {
                this.forwards.handle_data(decoded.session_id, decoded.conn_id, decoded.payload, outer.client_id)
            }
            return
        }

        if (channel === "file") {
            void this.transfers.handle_binary_data(bytes)
        }
    }

    private handle_channel_message(channel: AgentChannelName, raw_data: string): void {
        try {
            if (channel === "pty") {
                this.handle_pty_text(raw_data)
                return
            }
            if (channel === "forward") {
                this.handle_forward_text(raw_data)
                return
            }

            const msg = JSON.parse(raw_data) as HubToAgentMessage
            if (channel === "exec") {
                if (msg.type === "task:exec") {
                    this.tasks.execute(msg, this.options.workspace, (m) => this.send_channel_json("exec", m))
                } else if (msg.type === "task:kill") {
                    this.tasks.kill(msg)
                }
                return
            }

            if (channel === "file") {
                if (msg.type === "file:pull_start") {
                    this.transfers.handle_pull_start(
                        msg,
                        this.options.workspace,
                        (m) => this.send_channel_json("file", m),
                        (bin) => this.send_channel_binary("file", bin)
                    )
                } else if (msg.type === "file:push_start") {
                    this.transfers.handle_push_start(msg, this.options.workspace, (m) =>
                        this.send_channel_json("file", m)
                    )
                } else if (msg.type === "file:push_end") {
                    void this.transfers.handle_push_end(msg.transfer_id, (m) => this.send_channel_json("file", m))
                } else if (msg.type === "transfer:error") {
                    this.transfers.handle_transfer_error(msg)
                }
            }
        } catch (err) {
            console.error(`[rexec-agent] [${channel}] Failed to handle incoming message:`, err)
        }
    }

    private handle_pty_text(raw_data: string): void {
        const unwrapped = unwrap_client_text(raw_data)
        if (!unwrapped) return
        const { client_id, payload } = unwrapped
        const msg = JSON.parse(payload) as HubToAgentMessage

        const send_json = (m: AgentToHubMessage) =>
            this.send_channel_text("pty", wrap_client_text(client_id, JSON.stringify(m)))
        const send_binary = (packet: Uint8Array) =>
            this.send_channel_binary("pty", wrap_client_binary(client_id, packet))

        if (msg.type === "client:close") {
            this.ptys.detach_client(client_id)
        } else if (msg.type === "pty:open") {
            this.ptys.open(msg, this.options.workspace, send_json, send_binary, client_id)
        } else if (msg.type === "pty:attach") {
            this.ptys.attach(msg, send_json, send_binary, client_id)
        } else if (msg.type === "pty:detach") {
            this.ptys.detach(msg.session_id, client_id)
        } else if (msg.type === "pty:resize") {
            this.ptys.resize(msg, client_id)
        } else if (msg.type === "pty:close") {
            this.ptys.close(msg)
        } else if (msg.type === "pty:kill") {
            const killed = this.ptys.close({ type: "pty:close", session_id: msg.session_id }, true)
            if (msg.req_id) {
                send_json({ type: "pty:kill_res", req_id: msg.req_id, session_id: msg.session_id, killed })
            }
        } else if (msg.type === "pty:update") {
            const updated = this.ptys.update(msg)
            if (msg.req_id) {
                send_json({ type: "pty:update_res", req_id: msg.req_id, session_id: msg.session_id, updated })
            }
        } else if (msg.type === "pty:list_req") {
            send_json({ type: "pty:list_res", req_id: msg.req_id, sessions: this.ptys.list() })
        }
    }

    private handle_forward_text(raw_data: string): void {
        const unwrapped = unwrap_client_text(raw_data)
        if (!unwrapped) return
        const { client_id, payload } = unwrapped
        const msg = JSON.parse(payload) as HubToAgentMessage

        const send_json = (m: AgentToHubMessage) =>
            this.send_channel_text("forward", wrap_client_text(client_id, JSON.stringify(m)))
        const send_binary = (packet: Uint8Array) =>
            this.send_channel_binary("forward", wrap_client_binary(client_id, packet))

        if (msg.type === "client:close") {
            this.forwards.cleanup_client(client_id)
        } else if (msg.type === "forward:open") {
            this.forwards.handle_open(msg, send_json, send_binary, client_id)
        } else if (msg.type === "forward:close") {
            this.forwards.handle_close(msg, client_id)
        } else if (msg.type === "forward:session_end") {
            this.forwards.handle_session_end(msg, client_id)
        }
    }

    private shutdown(signal: string): void {
        if (this.is_shutting_down) return
        console.log(`\n[rexec-agent] Shutting down on ${signal}...`)
        this.is_shutting_down = true

        this.release_remote_work()

        for (const client of Object.values(this.clients)) {
            client?.close(1000, "Agent shutting down")
        }
        process.exit(0)
    }

    private release_remote_work(): void {
        this.tasks.abort_all()
        this.transfers.abort_all()
        this.forwards.abort_all()
        this.ptys.abort_all()
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
