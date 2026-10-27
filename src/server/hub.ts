import { DurableObject } from "cloudflare:workers"
import type { AgentToHubMessage, HubToAgentMessage } from "@/protocol"
import { ChannelDomain } from "@/transport"
import { ForwardRelay } from "./forward_relay"
import { TaskRelay } from "./task_relay"
import { TransferRelay } from "./transfer_relay"
import type { AgentSession } from "./types"
import { extract_token, get_cors_headers, read_ws_bytes } from "./utils"

export class RexecHub extends DurableObject {
    private agents: Map<string, AgentSession> = new Map()
    private tasks: TaskRelay
    private transfers: TransferRelay
    private forwards: ForwardRelay

    public constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
        super(ctx, env)
        const send = (session: AgentSession, msg: HubToAgentMessage) => {
            this.send_to_agent(session, msg)
        }
        const get_open_agent = (token: string) => this.get_open_agent(token)
        this.tasks = new TaskRelay(send, get_open_agent)
        this.transfers = new TransferRelay(send, get_open_agent)
        this.forwards = new ForwardRelay(send, get_open_agent)
    }

    public override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === "/health" || url.pathname === "/api/health") {
            return this.handle_health(request, url)
        }

        if (url.pathname === "/ws" || url.pathname === "/ws/agent") {
            return this.handle_agent_ws(request, url)
        }

        if (url.pathname === "/ws/forward" || url.pathname === "/api/ws/forward") {
            return this.forwards.handle_forward_ws(request, url)
        }

        if (url.pathname === "/exec" || url.pathname === "/api/exec") {
            if (request.method !== "POST") {
                return new Response("Method Not Allowed", { status: 405, headers: get_cors_headers(request) })
            }
            return this.tasks.handle_exec_request(request, url)
        }

        if (url.pathname === "/file/pull" || url.pathname === "/api/file/pull") {
            return this.transfers.handle_pull_request(request, url)
        }

        if (url.pathname === "/file/push" || url.pathname === "/api/file/push") {
            return this.transfers.handle_push_request(request, url)
        }

        return new Response("Not Found", { status: 404, headers: get_cors_headers(request) })
    }

    private handle_health(request: Request, url: URL): Response {
        const token = extract_token(request, url)
        const headers = get_cors_headers(request)
        if (token) {
            const session = this.agents.get(token)
            const is_connected = session !== undefined && session.ws.readyState === WebSocket.OPEN
            return Response.json(
                {
                    status: "ok",
                    agent_connected: is_connected,
                    node_id: session?.node_id,
                    active_tasks: this.tasks.count_for(token)
                },
                { headers }
            )
        }

        return Response.json(
            {
                status: "ok",
                agent_connected: this.agents.size > 0,
                connected_agents: this.agents.size,
                active_tasks: this.tasks.size
            },
            { headers }
        )
    }

    private handle_agent_ws(request: Request, url: URL): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426, headers: get_cors_headers(request) })
        }

        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401, headers: get_cors_headers(request) })
        }

        const node_id = url.searchParams.get("node_id") || "unknown-node"

        const existing_session = this.agents.get(token)
        if (existing_session && existing_session.ws.readyState === WebSocket.OPEN) {
            try {
                existing_session.ws.close(1000, "Replaced by new connection")
            } catch {
                // Ignore close error
            }
            this.cleanup_agent_session(token, existing_session.ws, "Agent replaced by new connection")
        }

        const web_socket_pair = new WebSocketPair()
        const [client, server] = Object.values(web_socket_pair)

        server.accept()

        const session: AgentSession = {
            token,
            node_id,
            ws: server,
            connected_at: Date.now()
        }
        this.agents.set(token, session)

        server.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
                this.handle_agent_message(session, event.data)
                return
            }
            read_ws_bytes(event.data, (bytes) => this.handle_agent_binary(session, bytes))
        })

        server.addEventListener("close", () => {
            this.cleanup_agent_session(token, server, "Agent disconnected unexpectedly")
        })

        server.addEventListener("error", () => {
            this.cleanup_agent_session(token, server, "Agent connection error")
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    private cleanup_agent_session(token: string, ws: WebSocket, reason: string): void {
        const current = this.agents.get(token)
        if (current && current.ws === ws) {
            this.agents.delete(token)
            this.tasks.abort_for_token(token, reason)
            this.transfers.abort_for_token(token, reason)
            this.forwards.abort_for_token(token, reason)
        }
    }

    private handle_agent_message(session: AgentSession, data: string): void {
        try {
            const msg = JSON.parse(data) as AgentToHubMessage
            if (msg.type === "chunk" || msg.type === "task:chunk" || msg.type === "exit" || msg.type === "task:exit") {
                this.tasks.on_agent_message(session, msg)
            } else if (
                msg.type === "file:pull_meta" ||
                msg.type === "file:pull_end" ||
                msg.type === "file:push_end" ||
                msg.type === "transfer:error"
            ) {
                this.transfers.on_agent_message(session, msg)
            } else if (msg.type === "forward:close" || msg.type === "forward:error") {
                this.forwards.on_agent_message(session, msg)
            } else if (msg.type === "register") {
                if (msg.hostname) session.hostname = msg.hostname
                if (msg.node_id) session.node_id = msg.node_id
            } else if (msg.type === "ping") {
                this.send_to_agent(session, { type: "pong" })
            }
        } catch {
            // Ignore malformed message
        }
    }

    private handle_agent_binary(session: AgentSession, bytes: Uint8Array): void {
        if (bytes.length === 0) return

        if (bytes[0] === ChannelDomain.FORWARD) {
            this.forwards.relay_agent_binary(session, bytes)
            return
        }

        this.transfers.relay_agent_binary(session, bytes)
    }

    private get_open_agent(token: string): AgentSession | undefined {
        const session = this.agents.get(token)
        if (!session || session.ws.readyState !== WebSocket.OPEN) return undefined
        return session
    }

    private send_to_agent(session: AgentSession, msg: HubToAgentMessage): void {
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify(msg))
        }
    }
}
