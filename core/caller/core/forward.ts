import { HUB_ROUTES } from "@core/protocol"
import { SESSION_ID_BYTES, decode_forward_frame, encode_forward_frame } from "@core/transport/framing"
import { HubTunnelClient } from "./tunnel_client"

const FORWARD_PING_INTERVAL_MS = 20_000
/** Three missed pongs, matching the agent heartbeat. A half-open tunnel reconnects instead of blackholing. */
const FORWARD_IDLE_TIMEOUT_MS = FORWARD_PING_INTERVAL_MS * 3

function generate_session_id(): string {
    return crypto.randomUUID().replace(/-/g, "").slice(0, SESSION_ID_BYTES)
}

interface ForwardTunnelRegistration {
    get_session_id(): string
    on_data(conn_id: number, payload: Uint8Array): void
    on_close(conn_id: number, reason?: string): void
    on_error(conn_id: number, error: string): void
    on_disconnect(reason: string): void
}

export interface ForwardMuxOptions {
    hub_url: string
    token: string
    keep_alive?: boolean
    timeout_ms?: number
}

/**
 * Shared multiplexed `/ws/forward` transport allowing multiple forwarded
 * remote ports to share a single Caller<->Hub WebSocket connection.
 */
export class ForwardMuxClient {
    private readonly keep_alive: boolean
    private readonly tunnels = new Map<string, ForwardTunnelRegistration>()
    private readonly transport: HubTunnelClient

    public constructor(options: ForwardMuxOptions) {
        this.keep_alive = Boolean(options.keep_alive)
        this.transport = new HubTunnelClient({
            hub_url: options.hub_url,
            path: HUB_ROUTES.WS_FORWARD.path,
            token: options.token,
            reconnect: true,
            ping_interval_ms: FORWARD_PING_INTERVAL_MS,
            idle_timeout_ms: FORWARD_IDLE_TIMEOUT_MS,
            default_timeout_ms: options.timeout_ms,
            on_json: (msg) => this.handle_message(msg),
            on_binary: (bytes) => {
                const decoded = decode_forward_frame(bytes)
                if (!decoded) return
                this.tunnels.get(decoded.session_id)?.on_data(decoded.conn_id, decoded.payload)
            },
            on_agent_offline: () => {
                this.notify_disconnect("agent disconnected")
            },
            on_drop: (info) => {
                this.notify_disconnect(info.reason || "forward session disconnected")
            },
            create_abort_error: () => new Error("Connection aborted"),
            create_closed_error: () => new Error("Forward client closed"),
            create_drop_error: (info) => new Error(info.reason || "forward session disconnected")
        })
    }

    public get is_attached(): boolean {
        return this.transport.is_ready
    }

    public async ensure_connected(signal?: AbortSignal, timeout_ms?: number): Promise<void> {
        await this.transport.ensure_connected(signal, timeout_ms)
    }

    public register_tunnel(reg: ForwardTunnelRegistration): void {
        this.tunnels.set(reg.get_session_id(), reg)
    }

    public rekey_tunnel(old_session_id: string, reg: ForwardTunnelRegistration): void {
        this.tunnels.delete(old_session_id)
        this.tunnels.set(reg.get_session_id(), reg)
    }

    public unregister_tunnel(session_id: string): void {
        const had = this.tunnels.delete(session_id)
        if (had && this.is_attached) {
            this.send_json({ type: "forward:session_end", session_id })
        }
        if (this.tunnels.size === 0 && !this.keep_alive) {
            this.close()
        }
    }

    public send_json(data: unknown): void {
        this.transport.send_json(data)
    }

    public send_binary(data: Uint8Array): void {
        this.transport.send_binary(data)
    }

    public close(): void {
        this.transport.close("Client stopped port forward")
        this.notify_disconnect("forward session closed")
    }

    private notify_disconnect(reason: string): void {
        for (const reg of Array.from(this.tunnels.values())) {
            reg.on_disconnect(reason)
        }
    }

    private handle_message(raw_msg: Record<string, unknown>): void {
        const msg = raw_msg as {
            type?: string
            session_id?: string
            conn_id?: number
            reason?: string
            error?: string
        }

        if (msg.session_id && typeof msg.conn_id === "number") {
            const reg = this.tunnels.get(msg.session_id)
            if (!reg) return
            if (msg.type === "forward:close") {
                reg.on_close(msg.conn_id, msg.reason)
            } else if (msg.type === "forward:error") {
                reg.on_error(msg.conn_id, msg.error || "Unknown remote socket error")
            }
        }
    }
}

export interface ForwardClientOptions {
    hub_url: string
    token: string
    remote_port: number
    signal?: AbortSignal
    timeout_ms?: number
    transport?: ForwardMuxClient
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

    let session_id = generate_session_id()
    let closed = false
    const open_conns = new Set<number>()

    const mux =
        options.transport ??
        new ForwardMuxClient({
            hub_url: options.hub_url,
            token: options.token,
            timeout_ms: options.timeout_ms
        })

    const drop_open_conns = (reason: string) => {
        if (open_conns.size === 0) return
        const stale = [...open_conns]
        open_conns.clear()
        for (const conn_id of stale) close_handler?.(conn_id, reason)
    }

    const registration: ForwardTunnelRegistration = {
        get_session_id: () => session_id,
        on_data(conn_id, payload) {
            data_handler?.(conn_id, payload)
        },
        on_close(conn_id, reason) {
            open_conns.delete(conn_id)
            close_handler?.(conn_id, reason)
        },
        on_error(conn_id, error) {
            open_conns.delete(conn_id)
            error_handler?.(conn_id, error)
        },
        on_disconnect(reason) {
            const old_id = session_id
            session_id = generate_session_id()
            mux.rekey_tunnel(old_id, registration)
            drop_open_conns(reason)
        }
    }

    const tunnel: ForwardTunnelClient = {
        get session_id() {
            return session_id
        },
        remote_port: options.remote_port,
        open_channel(conn_id: number) {
            open_conns.add(conn_id)
            if (closed || !mux.is_attached) return
            mux.send_json({
                type: "forward:open",
                session_id,
                conn_id,
                remote_port: options.remote_port
            })
        },
        send_data(conn_id: number, data: Uint8Array) {
            if (closed || !mux.is_attached || !open_conns.has(conn_id)) return
            mux.send_binary(encode_forward_frame(session_id, conn_id, data))
        },
        close_channel(conn_id: number, reason?: string) {
            if (!open_conns.delete(conn_id) || closed || !mux.is_attached) return
            mux.send_json({
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
            if (closed) return
            closed = true
            options.signal?.removeEventListener("abort", on_abort)
            open_conns.clear()
            mux.unregister_tunnel(session_id)
        }
    }

    const on_abort = () => tunnel.close()
    options.signal?.addEventListener("abort", on_abort, { once: true })

    mux.register_tunnel(registration)
    try {
        await mux.ensure_connected(options.signal, options.timeout_ms)
        if (closed) {
            throw new Error("Connection aborted")
        }
        return tunnel
    } catch (err) {
        tunnel.close()
        throw err
    }
}
