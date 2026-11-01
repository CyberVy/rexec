import { HUB_ROUTES } from "@/protocol"
import { decode_forward_frame, encode_forward_frame } from "@/transport/framing"
import { build_ws_url, WsClient } from "@/transport/ws"

const FORWARD_PING_INTERVAL_MS = 20_000
/** Three missed pongs, matching the agent heartbeat. A half-open tunnel reconnects instead of blackholing. */
const FORWARD_IDLE_TIMEOUT_MS = FORWARD_PING_INTERVAL_MS * 3

export interface ForwardClientOptions {
    hub_url: string
    token: string
    remote_port: number
    signal?: AbortSignal
    timeout_ms?: number
}

export interface ForwardTunnelClient {
    readonly session_id: string
    readonly remote_port: number
    open_channel(conn_id: number): void
    send_data(conn_id: number, data: Uint8Array): void
    close_channel(conn_id: number, reason?: string): void
    on_data(callback: (conn_id: number, data: Uint8Array) => void): void
    on_channel_close(callback: (conn_id: number, reason?: string) => void): void
    on_channel_error(callback: (conn_id: number, error: string) => void): void
    close(): void
}

export async function open_forward_tunnel(options: ForwardClientOptions): Promise<ForwardTunnelClient> {
    let data_handler: ((conn_id: number, data: Uint8Array) => void) | null = null
    let close_handler: ((conn_id: number, reason?: string) => void) | null = null
    let error_handler: ((conn_id: number, error: string) => void) | null = null

    let session_id = ""
    let attached = false
    const open_conns = new Set<number>()

    let resolve_session!: (session_id: string) => void
    const session_promise = new Promise<string>((resolve) => {
        resolve_session = resolve
    })

    const drop_open_conns = (reason: string) => {
        if (open_conns.size === 0) return
        const stale = [...open_conns]
        open_conns.clear()
        for (const conn_id of stale) close_handler?.(conn_id, reason)
    }

    const detach = () => {
        attached = false
        drop_open_conns("forward session disconnected")
    }

    const adopt_session = (next_session_id: string) => {
        const previous = session_id
        const replaced = previous !== "" && previous !== next_session_id
        session_id = next_session_id
        attached = true
        if (previous === "") resolve_session(session_id)
        if (replaced || open_conns.size > 0) {
            drop_open_conns(replaced ? "forward session replaced" : "forward session disconnected")
        }
    }

    const client = new WsClient({
        url: build_ws_url(options.hub_url, HUB_ROUTES.WS_FORWARD.path, options.token, {
            remote_port: options.remote_port
        }),
        signal: options.signal,
        reset_on_close: true,
        connect_timeout_ms: options.timeout_ms ?? 10000,
        ping_interval_ms: FORWARD_PING_INTERVAL_MS,
        idle_timeout_ms: FORWARD_IDLE_TIMEOUT_MS,
        reconnect: true,
        on_close() {
            detach()
        },
        on_dead() {
            detach()
        },
        on_message(data) {
            try {
                const msg = JSON.parse(data) as {
                    type: string
                    session_id?: string
                    conn_id?: number
                    reason?: string
                    error?: string
                }
                if (msg.type === "forward:ready" && msg.session_id) {
                    adopt_session(msg.session_id)
                    return
                }
                if (typeof msg.conn_id === "number") {
                    if (msg.type === "forward:close") {
                        open_conns.delete(msg.conn_id)
                        close_handler?.(msg.conn_id, msg.reason)
                    } else if (msg.type === "forward:error") {
                        open_conns.delete(msg.conn_id)
                        error_handler?.(msg.conn_id, msg.error || "Unknown remote socket error")
                    }
                }
            } catch {
                // Ignore malformed JSON
            }
        },
        on_binary(bytes) {
            const decoded = decode_forward_frame(bytes)
            if (decoded) {
                data_handler?.(decoded.conn_id, decoded.payload)
            }
        }
    })

    await client.connect()
    await session_promise

    return {
        get session_id() {
            return session_id
        },
        remote_port: options.remote_port,
        open_channel(conn_id: number) {
            open_conns.add(conn_id)
            if (!attached) return
            client.send_json({
                type: "forward:open",
                session_id,
                conn_id,
                remote_port: options.remote_port
            })
        },
        send_data(conn_id: number, data: Uint8Array) {
            if (!attached || !open_conns.has(conn_id)) return
            const frame = encode_forward_frame(session_id, conn_id, data)
            client.send_binary(frame)
        },
        close_channel(conn_id: number, reason?: string) {
            if (!open_conns.delete(conn_id) || !attached) return
            client.send_json({
                type: "forward:close",
                session_id,
                conn_id,
                reason
            })
        },
        on_data(callback) {
            data_handler = callback
        },
        on_channel_close(callback) {
            close_handler = callback
        },
        on_channel_error(callback) {
            error_handler = callback
        },
        close() {
            client.close(1000, "Client stopped port forward")
        }
    }
}
