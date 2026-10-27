import type { ForwardCloseMessage, ForwardErrorMessage, HubToAgentMessage } from "@/protocol"
import { extract_forward_session_id } from "@/transport"
import type { AgentSession } from "./types"
import { accepted_token, get_cors_headers, read_ws_bytes } from "./utils"

interface ActiveForwardSession {
    session_id: string
    token: string
    caller_ws: WebSocket
    agent_ws: WebSocket
    remote_port: number
}

export class ForwardRelay {
    private active_forwards: Map<string, ActiveForwardSession> = new Map()

    public constructor(
        private readonly send: (session: AgentSession, msg: HubToAgentMessage) => void,
        private readonly get_open_agent: (token: string) => AgentSession | undefined
    ) {}

    public on_agent_message(session: AgentSession, msg: ForwardCloseMessage | ForwardErrorMessage): void {
        const forward = this.active_forwards.get(msg.session_id)
        if (forward && forward.token === session.token && forward.caller_ws.readyState === WebSocket.OPEN) {
            forward.caller_ws.send(JSON.stringify(msg))
        }
    }

    public relay_agent_binary(session: AgentSession, bytes: Uint8Array): void {
        const session_id = extract_forward_session_id(bytes)
        if (!session_id) return

        const forward = this.active_forwards.get(session_id)
        if (forward && forward.token === session.token && forward.caller_ws.readyState === WebSocket.OPEN) {
            forward.caller_ws.send(bytes)
        }
    }

    public handle_forward_ws(request: Request, url: URL): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426, headers: get_cors_headers(request) })
        }

        const token = accepted_token(request, url)
        const session = this.get_open_agent(token)
        if (!session) {
            return new Response("No agent connected for this token", {
                status: 503,
                headers: get_cors_headers(request)
            })
        }

        const remote_port = Number(url.searchParams.get("remote_port") || url.searchParams.get("port") || 0)
        if (!remote_port) {
            return new Response("Missing or invalid 'remote_port' query parameter", {
                status: 400,
                headers: get_cors_headers(request)
            })
        }

        const session_id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
        const web_socket_pair = new WebSocketPair()
        const [client, server] = Object.values(web_socket_pair)
        server.accept()

        const forward_session: ActiveForwardSession = {
            session_id,
            token,
            caller_ws: server,
            agent_ws: session.ws,
            remote_port
        }
        this.active_forwards.set(session_id, forward_session)

        server.send(JSON.stringify({ type: "forward:ready", session_id, remote_port }))

        server.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
                try {
                    const msg = JSON.parse(event.data) as Record<string, unknown>
                    if (msg.type === "ping") {
                        server.send(JSON.stringify({ type: "pong" }))
                        return
                    }
                    msg.session_id = session_id
                    if (msg.type === "forward:open" && !msg.remote_port) {
                        msg.remote_port = remote_port
                    }
                    if (session.ws.readyState === WebSocket.OPEN) {
                        session.ws.send(JSON.stringify(msg))
                    }
                } catch {
                    // Ignore malformed message
                }
                return
            }

            read_ws_bytes(event.data, (bytes) => {
                if (session.ws.readyState === WebSocket.OPEN) {
                    session.ws.send(bytes)
                }
            })
        })

        const cleanup = () => {
            const current = this.active_forwards.get(session_id)
            if (current && current.caller_ws === server) {
                this.active_forwards.delete(session_id)
                this.send(session, { type: "forward:session_end", session_id })
            }
        }

        server.addEventListener("close", cleanup)
        server.addEventListener("error", cleanup)

        return new Response(null, { status: 101, webSocket: client })
    }

    public abort_for_token(token: string, reason: string): void {
        for (const [session_id, forward] of this.active_forwards) {
            if (forward.token === token) {
                try {
                    forward.caller_ws.close(4503, reason)
                } catch {
                    // Ignore
                }
                this.active_forwards.delete(session_id)
            }
        }
    }
}
