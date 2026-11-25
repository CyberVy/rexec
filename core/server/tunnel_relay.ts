import type { HubAgentOfflineMessage, HubAgentOnlineMessage, HubStatusMessage } from "@/protocol"
import {
    BROADCAST_CLIENT_ID,
    CLIENT_ID_BYTES,
    LINK_PONG_PAYLOAD,
    is_link_ping,
    unwrap_client_binary,
    unwrap_client_text,
    wrap_client_binary,
    wrap_client_text
} from "@/transport"
import { CALLER_IDLE_MS, accepted_token, get_cors_headers, read_ws_bytes } from "./utils"

interface CallerEntry {
    ws: WebSocket
    idle_timer: ReturnType<typeof setTimeout> | null
}

/**
 * Domain-agnostic passthrough WebSocket router bridging multiple Caller
 * connections (`client_id`) to a single Agent channel WebSocket.
 *
 * Link-level heartbeats (`ping` / `pong`) terminate locally at the Hub and are
 * never forwarded across either side.
 */
export class TunnelRelay {
    private readonly clients = new Map<string, Map<string, CallerEntry>>()

    public constructor(private readonly get_open_agent: (token: string) => WebSocket | undefined) {}

    public handle_ws(request: Request, url: URL): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426, headers: get_cors_headers(request) })
        }

        const token = accepted_token(request, url)
        const pair = new WebSocketPair()
        const [client, server] = Object.values(pair)
        server.accept()

        const client_id = crypto.randomUUID().replace(/-/g, "").slice(0, CLIENT_ID_BYTES)
        const entry: CallerEntry = { ws: server, idle_timer: null }

        let token_clients = this.clients.get(token)
        if (!token_clients) {
            token_clients = new Map<string, CallerEntry>()
            this.clients.set(token, token_clients)
        }
        token_clients.set(client_id, entry)

        const reset_timer = () => {
            if (entry.idle_timer) {
                clearTimeout(entry.idle_timer)
            }
            entry.idle_timer = setTimeout(() => {
                this.cleanup_caller(token, client_id)
                try {
                    server.close(1000, "Idle timeout")
                } catch {}
            }, CALLER_IDLE_MS)
        }
        reset_timer()

        const agent_ws = this.get_open_agent(token)
        const status_msg: HubStatusMessage = {
            type: "hub:status",
            agent_connected: agent_ws !== undefined
        }
        try {
            server.send(JSON.stringify(status_msg))
        } catch {}

        server.addEventListener("message", (event) => {
            reset_timer()

            if (typeof event.data === "string") {
                if (is_link_ping(event.data)) {
                    try {
                        server.send(LINK_PONG_PAYLOAD)
                    } catch {}
                    return
                }
                const target = this.get_open_agent(token)
                if (target) {
                    try {
                        target.send(wrap_client_text(client_id, event.data))
                    } catch {}
                }
                return
            }

            read_ws_bytes(event.data, (bytes) => {
                const target = this.get_open_agent(token)
                if (target) {
                    try {
                        target.send(wrap_client_binary(client_id, bytes))
                    } catch {}
                }
            })
        })

        server.addEventListener("close", () => this.cleanup_caller(token, client_id))
        server.addEventListener("error", () => this.cleanup_caller(token, client_id))

        return new Response(null, { status: 101, webSocket: client })
    }

    public on_agent_online(token: string): void {
        const msg: HubAgentOnlineMessage = { type: "hub:agent_online" }
        this.broadcast_text(token, JSON.stringify(msg))
    }

    public on_agent_offline(token: string): void {
        const msg: HubAgentOfflineMessage = { type: "hub:agent_offline" }
        this.broadcast_text(token, JSON.stringify(msg))
    }

    public on_agent_text(token: string, raw: string): void {
        const unwrapped = unwrap_client_text(raw)
        if (!unwrapped) return
        if (unwrapped.client_id === BROADCAST_CLIENT_ID) {
            this.broadcast_text(token, unwrapped.payload)
            return
        }
        this.send_to_caller(token, unwrapped.client_id, unwrapped.payload)
    }

    public on_agent_binary(token: string, bytes: Uint8Array): void {
        const unwrapped = unwrap_client_binary(bytes)
        if (!unwrapped) return
        if (unwrapped.client_id === BROADCAST_CLIENT_ID) {
            const token_clients = this.clients.get(token)
            if (!token_clients) return
            for (const entry of token_clients.values()) {
                if (entry.ws.readyState === WebSocket.OPEN) {
                    try {
                        entry.ws.send(unwrapped.payload)
                    } catch {}
                }
            }
            return
        }
        this.send_to_caller(token, unwrapped.client_id, unwrapped.payload)
    }

    private broadcast_text(token: string, text: string): void {
        const token_clients = this.clients.get(token)
        if (!token_clients) return
        for (const entry of token_clients.values()) {
            if (entry.ws.readyState === WebSocket.OPEN) {
                try {
                    entry.ws.send(text)
                } catch {}
            }
        }
    }

    private send_to_caller(token: string, client_id: string, payload: string | Uint8Array): void {
        const entry = this.clients.get(token)?.get(client_id)
        if (!entry || entry.ws.readyState !== WebSocket.OPEN) return
        try {
            entry.ws.send(payload)
        } catch {}
    }

    private cleanup_caller(token: string, client_id: string): void {
        const token_clients = this.clients.get(token)
        const entry = token_clients?.get(client_id)
        if (!entry) return

        token_clients!.delete(client_id)
        if (token_clients!.size === 0) {
            this.clients.delete(token)
        }
        if (entry.idle_timer) {
            clearTimeout(entry.idle_timer)
            entry.idle_timer = null
        }

        const agent_ws = this.get_open_agent(token)
        if (agent_ws) {
            try {
                agent_ws.send(wrap_client_text(client_id, '{"type":"client:close"}'))
            } catch {}
        }
    }
}
