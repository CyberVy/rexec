import { decode_forward_frame, encode_forward_frame } from "@/transport/framing"
import { build_ws_url, WsClient } from "@/transport/ws"

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

    let resolve_session!: (session_id: string) => void
    const session_promise = new Promise<string>((resolve) => {
        resolve_session = resolve
    })

    const client = new WsClient({
        url: build_ws_url(options.hub_url, "/ws/forward", options.token, { remote_port: options.remote_port }),
        signal: options.signal,
        reset_on_close: true,
        connect_timeout_ms: options.timeout_ms ?? 10000,
        ping_interval_ms: 20000,
        idle_timeout_ms: 0,
        reconnect: true,
        // Idle drop is off. Set idle_timeout_ms (for example 15000) to RST a half-open tunnel.
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
                    resolve_session(msg.session_id)
                    return
                }
                if (typeof msg.conn_id === "number") {
                    if (msg.type === "forward:close") {
                        close_handler?.(msg.conn_id, msg.reason)
                    } else if (msg.type === "forward:error") {
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
    const session_id = await session_promise

    return {
        session_id,
        remote_port: options.remote_port,
        open_channel(conn_id: number) {
            client.send_json({
                type: "forward:open",
                session_id,
                conn_id,
                remote_port: options.remote_port
            })
        },
        send_data(conn_id: number, data: Uint8Array) {
            const frame = encode_forward_frame(session_id, conn_id, data)
            client.send_binary(frame)
        },
        close_channel(conn_id: number, reason?: string) {
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
