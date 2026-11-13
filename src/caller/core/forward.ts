import { HUB_ROUTES } from "@/protocol"
import { SESSION_ID_BYTES, decode_forward_frame, encode_forward_frame } from "@/transport/framing"
import { build_ws_url, WsClient } from "@/transport/ws"

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
    private readonly hub_url: string
    private readonly token: string
    private readonly keep_alive: boolean
    private readonly default_timeout_ms: number
    private readonly tunnels = new Map<string, ForwardTunnelRegistration>()

    private client: WsClient | null = null
    private connect_promise: Promise<void> | null = null
    private resolve_status: (() => void) | null = null
    private reject_status: ((err: Error) => void) | null = null
    private status_received = false
    private has_ever_connected = false
    private agent_online = false
    private attached = false

    public constructor(options: ForwardMuxOptions) {
        this.hub_url = options.hub_url
        this.token = options.token
        this.keep_alive = Boolean(options.keep_alive)
        this.default_timeout_ms = options.timeout_ms ?? 10_000
    }

    public get is_attached(): boolean {
        return this.attached
    }

    public async ensure_connected(signal?: AbortSignal, timeout_ms?: number): Promise<void> {
        if (this.attached) return

        if (signal?.aborted) {
            throw new Error("Connection aborted")
        }

        if (!this.connect_promise) {
            this.connect_promise = this.open_transport(timeout_ms ?? this.default_timeout_ms).finally(() => {
                this.connect_promise = null
            })
        }

        if (!signal) {
            await this.connect_promise
            return
        }

        await new Promise<void>((resolve, reject) => {
            const on_abort = () => reject(new Error("Connection aborted"))
            signal.addEventListener("abort", on_abort, { once: true })
            this.connect_promise!.then(
                () => {
                    signal.removeEventListener("abort", on_abort)
                    resolve()
                },
                (err) => {
                    signal.removeEventListener("abort", on_abort)
                    reject(err)
                }
            )
        })
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
        if (had && this.attached) {
            this.send_json({ type: "forward:session_end", session_id })
        }
        if (this.tunnels.size === 0 && !this.keep_alive) {
            this.close()
        }
    }

    public send_json(data: unknown): void {
        if (!this.attached) return
        this.client?.send_json(data)
    }

    public send_binary(data: Uint8Array): void {
        if (!this.attached) return
        this.client?.send_binary(data)
    }

    public close(): void {
        this.attached = false
        this.agent_online = false
        this.status_received = false
        const reject = this.reject_status
        this.resolve_status = null
        this.reject_status = null
        reject?.(new Error("Forward client closed"))

        const client = this.client
        this.client = null
        client?.close(1000, "Client stopped port forward")

        for (const reg of Array.from(this.tunnels.values())) {
            reg.on_disconnect("forward session closed")
        }
    }

    private async open_transport(timeout_ms: number): Promise<void> {
        this.status_received = false
        this.agent_online = false
        this.attached = false

        const status_promise = new Promise<void>((resolve, reject) => {
            this.resolve_status = resolve
            this.reject_status = reject
        })
        status_promise.catch(() => {})

        const client = new WsClient({
            url: build_ws_url(this.hub_url, HUB_ROUTES.WS_FORWARD.path, this.token),
            reset_on_close: true,
            connect_timeout_ms: timeout_ms,
            ping_interval_ms: FORWARD_PING_INTERVAL_MS,
            idle_timeout_ms: FORWARD_IDLE_TIMEOUT_MS,
            reconnect: true,
            on_close: (event) => {
                this.handle_transport_drop(event.reason || "forward session disconnected")
            },
            on_dead: (reason) => {
                this.handle_transport_drop(reason || "forward session disconnected")
            },
            on_message: (data) => {
                this.handle_message(data)
            },
            on_binary: (bytes) => {
                const decoded = decode_forward_frame(bytes)
                if (!decoded) return
                this.tunnels.get(decoded.session_id)?.on_data(decoded.conn_id, decoded.payload)
            }
        })

        this.client = client
        try {
            await client.connect()
            await status_promise
        } catch (err) {
            if (this.client === client && !this.has_ever_connected) {
                this.client = null
                client.close(1000, "Forward connect failed")
            }
            throw err
        }
    }

    private handle_transport_drop(reason: string): void {
        this.attached = false
        this.agent_online = false
        this.status_received = false

        const reject = this.reject_status
        this.resolve_status = null
        this.reject_status = null
        reject?.(new Error(reason))

        for (const reg of Array.from(this.tunnels.values())) {
            reg.on_disconnect(reason)
        }
    }

    private handle_message(data: string): void {
        try {
            const msg = JSON.parse(data) as {
                type?: string
                agent_connected?: boolean
                session_id?: string
                conn_id?: number
                reason?: string
                error?: string
            }

            if (msg.type === "hub:status") {
                this.status_received = true
                this.agent_online = Boolean(msg.agent_connected)
                this.attached = this.agent_online
                if (this.agent_online) {
                    this.has_ever_connected = true
                    const resolve = this.resolve_status
                    this.resolve_status = null
                    this.reject_status = null
                    resolve?.()
                } else if (!this.has_ever_connected) {
                    const reject = this.reject_status
                    this.resolve_status = null
                    this.reject_status = null
                    reject?.(new Error("No agent connected for this token"))
                }
                return
            }

            if (msg.type === "hub:agent_online") {
                if (!this.status_received) return
                this.agent_online = true
                this.attached = true
                this.has_ever_connected = true
                const resolve = this.resolve_status
                this.resolve_status = null
                this.reject_status = null
                resolve?.()
                return
            }

            if (msg.type === "hub:agent_offline") {
                this.agent_online = false
                this.attached = false
                for (const reg of Array.from(this.tunnels.values())) {
                    reg.on_disconnect("agent disconnected")
                }
                return
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
        } catch {
            // Ignore malformed JSON
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
