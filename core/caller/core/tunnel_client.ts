import { build_ws_url, WsClient } from "@core/transport/ws"

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

export interface HubTunnelDropInfo {
    code?: number
    reason: string
    from_close: boolean
}

export interface HubTunnelClientOptions {
    hub_url: string
    path: string
    token: string
    reconnect: boolean
    ping_interval_ms: number
    idle_timeout_ms: number
    default_timeout_ms?: number
    on_json: (msg: Record<string, unknown>) => void
    on_binary: (bytes: Uint8Array) => void
    on_agent_online?: () => void
    on_agent_offline?: () => void
    on_drop?: (info: HubTunnelDropInfo) => void
    create_abort_error?: () => Error
    create_closed_error?: () => Error
    create_drop_error?: (info: HubTunnelDropInfo) => Error
}

interface PendingReady {
    resolve: () => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
}

/**
 * Shared Caller <-> Hub TunnelRelay WebSocket lifecycle manager.
 *
 * Owns the full connection and initial `hub:status` handshake under a single
 * deadline, isolates callbacks by active `WsClient` instance, and guarantees
 * at most one underlying socket and one drop notification per attempt.
 */
export class HubTunnelClient {
    private readonly options: HubTunnelClientOptions
    private readonly default_timeout_ms: number

    private client: WsClient | null = null
    private connect_promise: Promise<void> | null = null
    private pending_ready: PendingReady | null = null
    private status_received = false
    private agent_online = false
    private has_ever_connected = false
    private dropped_attempt = 0

    public constructor(options: HubTunnelClientOptions) {
        this.options = options
        this.default_timeout_ms = options.default_timeout_ms ?? DEFAULT_CONNECT_TIMEOUT_MS
    }

    public get is_open(): boolean {
        return Boolean(this.client?.is_open)
    }

    public get is_ready(): boolean {
        return Boolean(this.client?.is_open && this.status_received && this.agent_online)
    }

    public get has_status(): boolean {
        return this.status_received
    }

    public get is_agent_online(): boolean {
        return this.agent_online
    }

    public async ensure_connected(signal?: AbortSignal, timeout_ms?: number): Promise<void> {
        if (signal?.aborted) {
            throw this.make_abort_error()
        }

        if (this.client?.is_open && this.status_received) {
            if (this.agent_online) return
            if (!this.options.reconnect || !this.has_ever_connected) {
                throw new Error("No agent connected for this token")
            }
        }

        const deadline_ms = timeout_ms ?? this.default_timeout_ms
        if (!this.connect_promise) {
            this.connect_promise = this.establish_ready(deadline_ms).finally(() => {
                this.connect_promise = null
            })
        }

        const pending = this.connect_promise
        if (!signal) {
            await pending
            return
        }

        await new Promise<void>((resolve, reject) => {
            const on_abort = () => reject(this.make_abort_error())
            signal.addEventListener("abort", on_abort, { once: true })
            pending.then(
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

    public send_json(data: unknown): void {
        if (!this.is_ready) return
        this.client?.send_json(data)
    }

    public send_binary(data: Uint8Array): void {
        if (!this.is_ready) return
        this.client?.send_binary(data)
    }

    public ping(): void {
        this.client?.ping()
    }

    public close(reason = "Tunnel client closed"): void {
        const client = this.client
        this.client = null
        this.status_received = false
        this.agent_online = false
        this.dropped_attempt = 0
        this.reject_pending_ready(this.make_closed_error(reason))
        client?.close(1000, reason)
    }

    private async establish_ready(timeout_ms: number): Promise<void> {
        // If an open socket is already waiting for the agent to come back online,
        // wait on that existing socket instead of churning it.
        if (this.client?.is_open && this.status_received && !this.agent_online && this.options.reconnect) {
            await this.wait_for_ready(timeout_ms, "Timed out waiting for agent to come online")
            return
        }

        // Replace any stale or backing-off client so at most one WsClient exists.
        if (this.client) {
            const stale = this.client
            this.client = null
            stale.close(1000, "Replaced by new connect attempt")
        }

        this.status_received = false
        this.agent_online = false
        this.dropped_attempt = 0

        let ws_opened = false
        const ready_promise = this.wait_for_ready(timeout_ms, () =>
            ws_opened
                ? `Timed out waiting for hub:status after ${timeout_ms}ms`
                : `Timed out connecting to Hub WebSocket after ${timeout_ms}ms`
        )

        const client = new WsClient({
            url: build_ws_url(this.options.hub_url, this.options.path, this.options.token),
            connect_timeout_ms: timeout_ms,
            ping_interval_ms: this.options.ping_interval_ms,
            idle_timeout_ms: this.options.idle_timeout_ms,
            reconnect: this.options.reconnect,
            on_open: () => {
                if (this.client !== client) return
                ws_opened = true
            },
            on_close: (event) => {
                this.handle_transport_drop(client, {
                    code: event.code,
                    reason: event.reason || "",
                    from_close: true
                })
            },
            on_dead: (reason) => {
                this.handle_transport_drop(client, {
                    reason: reason || "",
                    from_close: false
                })
            },
            on_message: (data) => {
                if (this.client !== client) return
                this.handle_message(data)
            },
            on_binary: (bytes) => {
                if (this.client !== client) return
                this.options.on_binary(bytes)
            }
        })

        this.client = client
        const connect_op = client.connect()
        connect_op.catch(() => {})
        try {
            await Promise.all([connect_op, ready_promise])
        } catch (err) {
            this.reject_pending_ready(err instanceof Error ? err : new Error(String(err)))
            if (this.client === client && !this.is_ready) {
                this.client = null
                this.status_received = false
                this.agent_online = false
                client.close(1000, "Hub tunnel connect failed")
            }
            throw err
        }
    }

    private wait_for_ready(timeout_ms: number, timeout_message: string | (() => string)): Promise<void> {
        this.clear_pending_ready()
        const promise = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending_ready?.timer !== timer) return
                this.pending_ready = null
                const msg = typeof timeout_message === "function" ? timeout_message() : timeout_message
                reject(new Error(msg))
            }, timeout_ms)
            this.pending_ready = { resolve, reject, timer }
        })
        promise.catch(() => {})
        return promise
    }

    private resolve_pending_ready(): void {
        const pending = this.pending_ready
        if (!pending) return
        this.pending_ready = null
        clearTimeout(pending.timer)
        pending.resolve()
    }

    private reject_pending_ready(err: Error): void {
        const pending = this.pending_ready
        if (!pending) return
        this.pending_ready = null
        clearTimeout(pending.timer)
        pending.reject(err)
    }

    private clear_pending_ready(): void {
        const pending = this.pending_ready
        if (!pending) return
        this.pending_ready = null
        clearTimeout(pending.timer)
    }

    private handle_transport_drop(client: WsClient, info: HubTunnelDropInfo): void {
        if (this.client !== client) return

        // WsClient emits on_close followed immediately by on_dead for the same socket close;
        // deduplicate per attempt so consumers see exactly one drop with the close event details.
        const attempt = client.epoch
        if (this.dropped_attempt === attempt) return
        this.dropped_attempt = attempt

        this.status_received = false
        this.agent_online = false

        if (!this.options.reconnect) {
            this.client = null
        }

        const err = this.make_drop_error(info)
        this.reject_pending_ready(err)
        this.options.on_drop?.(info)
    }

    private handle_message(data: string): void {
        let msg: Record<string, unknown>
        try {
            const parsed: unknown = JSON.parse(data)
            if (!parsed || typeof parsed !== "object") return
            msg = parsed as Record<string, unknown>
        } catch {
            return
        }

        if (msg.type === "hub:status") {
            this.status_received = true
            this.agent_online = Boolean(msg.agent_connected)
            if (this.agent_online) {
                this.has_ever_connected = true
                this.resolve_pending_ready()
            } else if (!this.options.reconnect || !this.has_ever_connected) {
                this.reject_pending_ready(new Error("No agent connected for this token"))
            }
            return
        }

        if (msg.type === "hub:agent_online") {
            if (!this.status_received) return
            this.agent_online = true
            this.has_ever_connected = true
            this.resolve_pending_ready()
            this.options.on_agent_online?.()
            return
        }

        if (msg.type === "hub:agent_offline") {
            this.agent_online = false
            this.options.on_agent_offline?.()
            return
        }

        this.options.on_json(msg)
    }

    private make_abort_error(): Error {
        return this.options.create_abort_error ? this.options.create_abort_error() : new Error("Connection aborted")
    }

    private make_closed_error(reason: string): Error {
        return this.options.create_closed_error ? this.options.create_closed_error() : new Error(reason)
    }

    private make_drop_error(info: HubTunnelDropInfo): Error {
        return this.options.create_drop_error
            ? this.options.create_drop_error(info)
            : new Error(info.reason || "Tunnel disconnected")
    }
}
