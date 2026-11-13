import { DurableObject } from "cloudflare:workers"
import {
    AGENT_CHANNEL_REPLACED_REASON,
    AGENT_REPLACED_REASON,
    HUB_ROUTES,
    type AgentChannelName,
    type AgentToHubMessage,
    type HubChannelHealth,
    type HubHealthResponse,
    type HubToAgentMessage
} from "@/protocol"
import { LINK_PONG_PAYLOAD, is_link_ping } from "@/transport"
import { TaskRelay } from "./task_relay"
import { TransferRelay } from "./transfer_relay"
import { TunnelRelay } from "./tunnel_relay"
import type { AgentGroup } from "./types"
import { accepted_token, extract_token, get_cors_headers, read_ws_bytes } from "./utils"

const AGENT_CHANNEL_ROUTES: Record<string, AgentChannelName> = {
    [HUB_ROUTES.WS_AGENT_PTY.path]: "pty",
    [HUB_ROUTES.WS_AGENT_FORWARD.path]: "forward",
    [HUB_ROUTES.WS_AGENT_EXEC.path]: "exec",
    [HUB_ROUTES.WS_AGENT_FILE.path]: "file"
}

function is_open_socket(ws?: WebSocket): boolean {
    return ws !== undefined && ws.readyState === WebSocket.OPEN
}

export class RexecHub extends DurableObject {
    private agents: Map<string, AgentGroup> = new Map()
    private tasks: TaskRelay
    private transfers: TransferRelay
    private forwards: TunnelRelay
    private ptys: TunnelRelay

    public constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
        super(ctx, env)
        const send = (ws: WebSocket, msg: HubToAgentMessage) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(msg))
            }
        }
        this.tasks = new TaskRelay(send, (token) => this.get_open_channel(token, "exec"))
        this.transfers = new TransferRelay(send, (token) => this.get_open_channel(token, "file"))
        this.forwards = new TunnelRelay((token) => this.get_open_channel(token, "forward"))
        this.ptys = new TunnelRelay((token) => this.get_open_channel(token, "pty"))
    }

    public override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === HUB_ROUTES.HEALTH.path) {
            return this.handle_health(request, url)
        }

        const agent_channel = AGENT_CHANNEL_ROUTES[url.pathname]
        if (agent_channel) {
            return this.handle_agent_ws(request, url, agent_channel)
        }

        if (url.pathname === HUB_ROUTES.WS_FORWARD.path) {
            return this.forwards.handle_ws(request, url)
        }

        if (url.pathname === HUB_ROUTES.WS_PTY.path) {
            return this.ptys.handle_ws(request, url)
        }

        if (url.pathname === HUB_ROUTES.EXEC.path) {
            if (request.method !== HUB_ROUTES.EXEC.method) {
                return new Response("Method Not Allowed", { status: 405, headers: get_cors_headers(request) })
            }
            return this.tasks.handle_exec_request(request, url)
        }

        if (url.pathname === HUB_ROUTES.EXEC_KILL.path) {
            if (request.method !== HUB_ROUTES.EXEC_KILL.method) {
                return new Response("Method Not Allowed", { status: 405, headers: get_cors_headers(request) })
            }
            return this.tasks.handle_kill_request(request, url)
        }

        if (url.pathname === HUB_ROUTES.FILE_PULL.path) {
            return this.transfers.handle_pull_request(request, url)
        }

        if (url.pathname === HUB_ROUTES.FILE_PUSH.path) {
            if (request.method !== HUB_ROUTES.FILE_PUSH.method) {
                return new Response("Method Not Allowed", { status: 405, headers: get_cors_headers(request) })
            }
            return this.transfers.handle_push_request(request, url)
        }

        return new Response("Not Found", { status: 404, headers: get_cors_headers(request) })
    }

    private handle_health(request: Request, url: URL): Response {
        const token = extract_token(request, url)
        const headers = get_cors_headers(request)
        if (token) {
            const group = this.agents.get(token)
            const channels: HubChannelHealth = {
                pty: is_open_socket(group?.channels.pty),
                forward: is_open_socket(group?.channels.forward),
                exec: is_open_socket(group?.channels.exec),
                file: is_open_socket(group?.channels.file)
            }
            const agent_connected = channels.pty && channels.forward && channels.exec && channels.file
            const response_body: HubHealthResponse = {
                status: "ok",
                agent_connected,
                channels,
                node_id: group?.node_id,
                active_tasks: this.tasks.count_for(token)
            }
            return Response.json(response_body, { headers })
        }

        let connected_agents = 0
        for (const group of this.agents.values()) {
            const { pty, forward, exec, file } = group.channels
            if (is_open_socket(pty) || is_open_socket(forward) || is_open_socket(exec) || is_open_socket(file)) {
                connected_agents++
            }
        }
        const response_body: HubHealthResponse = {
            status: "ok",
            agent_connected: connected_agents > 0,
            connected_agents,
            active_tasks: this.tasks.size
        }
        return Response.json(response_body, { headers })
    }

    private handle_agent_ws(request: Request, url: URL, channel: AgentChannelName): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426, headers: get_cors_headers(request) })
        }

        const token = accepted_token(request, url)
        const node_id = url.searchParams.get("node_id") || "unknown-node"
        const instance_id = url.searchParams.get("instance_id") || crypto.randomUUID()

        let group = this.agents.get(token)
        if (group && group.instance_id !== instance_id) {
            this.replace_agent_group(token, group, "Agent replaced by new connection")
            group = undefined
        }

        if (!group) {
            group = {
                token,
                instance_id,
                node_id,
                connected_at: Date.now(),
                channels: {}
            }
            this.agents.set(token, group)
        } else if (node_id !== "unknown-node") {
            group.node_id = node_id
        }

        const stale_ws = group.channels[channel]
        if (stale_ws) {
            delete group.channels[channel]
            if (stale_ws.readyState === WebSocket.OPEN) {
                if (channel === "exec") this.tasks.stop_on_agent(token, stale_ws)
                else if (channel === "file") this.transfers.stop_on_agent(token, stale_ws)
                try {
                    stale_ws.close(1000, AGENT_CHANNEL_REPLACED_REASON)
                } catch {}
            }
            if (channel === "exec") this.tasks.abort_for_token(token, "Agent exec channel replaced")
            else if (channel === "file") this.transfers.abort_for_token(token, "Agent file channel replaced")
        }

        const web_socket_pair = new WebSocketPair()
        const [client, server] = Object.values(web_socket_pair)
        server.accept()
        group.channels[channel] = server

        if (channel === "pty") this.ptys.on_agent_online(token)
        else if (channel === "forward") this.forwards.on_agent_online(token)

        const active_group = group
        server.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
                if (is_link_ping(event.data)) {
                    try {
                        server.send(LINK_PONG_PAYLOAD)
                    } catch {}
                    return
                }
                this.handle_agent_text(active_group, channel, event.data)
                return
            }
            read_ws_bytes(event.data, (bytes) => this.handle_agent_binary(token, channel, bytes))
        })

        server.addEventListener("close", () => {
            this.cleanup_agent_channel(token, channel, server, "Agent disconnected unexpectedly")
        })

        server.addEventListener("error", () => {
            this.cleanup_agent_channel(token, channel, server, "Agent connection error")
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    private replace_agent_group(token: string, old_group: AgentGroup, reason: string): void {
        this.agents.delete(token)
        const channels = old_group.channels
        old_group.channels = {}

        const had_pty = Boolean(channels.pty)
        const had_forward = Boolean(channels.forward)

        for (const [channel, ws] of Object.entries(channels) as [AgentChannelName, WebSocket][]) {
            if (ws.readyState === WebSocket.OPEN) {
                if (channel === "exec") this.tasks.stop_on_agent(token, ws)
                else if (channel === "file") this.transfers.stop_on_agent(token, ws)
                try {
                    ws.close(1000, AGENT_REPLACED_REASON)
                } catch {}
            }
        }

        this.tasks.abort_for_token(token, reason)
        this.transfers.abort_for_token(token, reason)
        if (had_pty) this.ptys.on_agent_offline(token)
        if (had_forward) this.forwards.on_agent_offline(token)
    }

    private cleanup_agent_channel(token: string, channel: AgentChannelName, ws: WebSocket, reason: string): void {
        const group = this.agents.get(token)
        if (!group || group.channels[channel] !== ws) return

        if (ws.readyState === WebSocket.OPEN) {
            if (channel === "exec") this.tasks.stop_on_agent(token, ws)
            else if (channel === "file") this.transfers.stop_on_agent(token, ws)
        }

        delete group.channels[channel]
        if (Object.keys(group.channels).length === 0) {
            this.agents.delete(token)
        }

        if (channel === "exec") this.tasks.abort_for_token(token, reason)
        else if (channel === "file") this.transfers.abort_for_token(token, reason)
        else if (channel === "pty") this.ptys.on_agent_offline(token)
        else if (channel === "forward") this.forwards.on_agent_offline(token)
    }

    private handle_agent_text(group: AgentGroup, channel: AgentChannelName, data: string): void {
        if ((channel === "pty" || channel === "forward") && data[0] !== "{") {
            if (channel === "pty") this.ptys.on_agent_text(group.token, data)
            else this.forwards.on_agent_text(group.token, data)
            return
        }

        try {
            const msg = JSON.parse(data) as AgentToHubMessage
            if (msg.type === "register") {
                if (msg.hostname) group.hostname = msg.hostname
                if (msg.node_id) group.node_id = msg.node_id
            } else if (channel === "exec" && (msg.type === "task:chunk" || msg.type === "task:exit")) {
                this.tasks.on_agent_message(group.token, msg)
            } else if (
                channel === "file" &&
                (msg.type === "file:pull_meta" ||
                    msg.type === "file:pull_end" ||
                    msg.type === "file:push_end" ||
                    msg.type === "transfer:error")
            ) {
                this.transfers.on_agent_message(group.token, msg)
            }
        } catch {
            // Ignore malformed message
        }
    }

    private handle_agent_binary(token: string, channel: AgentChannelName, bytes: Uint8Array): void {
        if (bytes.length === 0) return

        if (channel === "pty") {
            this.ptys.on_agent_binary(token, bytes)
            return
        }

        if (channel === "forward") {
            this.forwards.on_agent_binary(token, bytes)
            return
        }

        if (channel === "file") {
            this.transfers.relay_agent_binary(token, bytes)
        }
    }

    private get_open_channel(token: string, channel: AgentChannelName): WebSocket | undefined {
        const ws = this.agents.get(token)?.channels[channel]
        if (!ws || ws.readyState !== WebSocket.OPEN) return undefined
        return ws
    }
}
