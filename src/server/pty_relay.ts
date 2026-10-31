import type { HubToAgentMessage, PtyErrorMessage, PtyExitMessage } from "@/protocol"
import { extract_pty_session_id } from "@/transport"
import type { AgentSession } from "./types"
import { accepted_token, clear_idle_timer, get_cors_headers, read_ws_bytes, reset_idle_timer } from "./utils"

interface ActivePtySession {
    session_id: string
    token: string
    caller_ws: WebSocket
}

export class PtyRelay {
    private active_sessions: Map<string, ActivePtySession> = new Map()
    private idle_timers: Map<string, ReturnType<typeof setTimeout>> = new Map()

    public constructor(
        private readonly send: (session: AgentSession, msg: HubToAgentMessage) => void,
        private readonly get_open_agent: (token: string) => AgentSession | undefined
    ) {}

    public on_agent_message(session: AgentSession, msg: PtyExitMessage | PtyErrorMessage): void {
        const pty = this.active_sessions.get(msg.session_id)
        if (pty && pty.token === session.token) {
            this.active_sessions.delete(msg.session_id)
            clear_idle_timer(this.idle_timers, msg.session_id)
            if (pty.caller_ws.readyState === WebSocket.OPEN) {
                try {
                    pty.caller_ws.send(JSON.stringify(msg))
                    pty.caller_ws.close(1000, "PTY session exited")
                } catch {
                    // Ignore
                }
            }
        }
    }

    public relay_agent_binary(session: AgentSession, bytes: Uint8Array): void {
        const session_id = extract_pty_session_id(bytes)
        if (!session_id) return

        const pty = this.active_sessions.get(session_id)
        if (pty && pty.token === session.token && pty.caller_ws.readyState === WebSocket.OPEN) {
            pty.caller_ws.send(bytes)
        }
    }

    public handle_pty_ws(request: Request, url: URL): Response {
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

        const requested_id = url.searchParams.get("session_id")?.trim()
        const session_id =
            requested_id && requested_id.length === 16
                ? requested_id
                : crypto.randomUUID().replace(/-/g, "").slice(0, 16)

        const web_socket_pair = new WebSocketPair()
        const [client, server] = Object.values(web_socket_pair)
        server.accept()

        const existing = this.active_sessions.get(session_id)
        if (existing && existing.token === token) {
            try {
                existing.caller_ws.close(1000, "Replaced by new connection")
            } catch {
                // Ignore
            }
            existing.caller_ws = server
        } else {
            const pty_session: ActivePtySession = {
                session_id,
                token,
                caller_ws: server
            }
            this.active_sessions.set(session_id, pty_session)
        }
        this.arm_idle(session_id)

        server.send(JSON.stringify({ type: "pty:ready", session_id }))

        server.addEventListener("message", (event) => {
            this.arm_idle(session_id)
            if (typeof event.data === "string") {
                try {
                    const msg = JSON.parse(event.data) as Record<string, unknown>
                    if (msg.type === "ping") {
                        server.send(JSON.stringify({ type: "pong" }))
                        return
                    }
                    msg.session_id = session_id
                    if (msg.type === "pty:close") {
                        this.end_session(session_id, "Caller requested close")
                        return
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

        const on_caller_drop = () => {
            const current = this.active_sessions.get(session_id)
            if (current && current.caller_ws === server) {
                clear_idle_timer(this.idle_timers, session_id)
                // Accidental disconnect: notify agent to detach without killing process
                if (session.ws.readyState === WebSocket.OPEN) {
                    this.send(session, { type: "pty:detach", session_id })
                }
            }
        }
        server.addEventListener("close", on_caller_drop)
        server.addEventListener("error", on_caller_drop)

        return new Response(null, { status: 101, webSocket: client })
    }

    public stop_on_agent(session: AgentSession): void {
        for (const [session_id, pty] of this.active_sessions) {
            if (pty.token === session.token) {
                this.send(session, { type: "pty:close", session_id })
            }
        }
    }

    public abort_for_token(token: string, reason: string): void {
        for (const [session_id, pty] of this.active_sessions) {
            if (pty.token === token) this.end_session(session_id, reason)
        }
    }

    private arm_idle(session_id: string): void {
        if (!this.active_sessions.has(session_id)) return
        reset_idle_timer(this.idle_timers, session_id, () => {
            const current = this.active_sessions.get(session_id)
            if (current) {
                try {
                    current.caller_ws.close(1000, "Caller connection idle")
                } catch {
                    // Ignore
                }
                const agent = this.get_open_agent(current.token)
                if (agent) this.send(agent, { type: "pty:detach", session_id })
            }
        })
    }

    private end_session(session_id: string, reason: string): void {
        const current = this.active_sessions.get(session_id)
        if (!current) return
        this.active_sessions.delete(session_id)
        clear_idle_timer(this.idle_timers, session_id)
        const agent = this.get_open_agent(current.token)
        if (agent) this.send(agent, { type: "pty:close", session_id })
        try {
            current.caller_ws.close(1000, reason)
        } catch {
            // Ignore
        }
    }
}
