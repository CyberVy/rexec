import { WsLifecycle } from "@/transport/lifecycle"

export interface HubWsClientOptions {
    hub_url: string
    path: string
    token: string
    query_params?: Record<string, string | number>
    /**
     * Reconnect after the socket dies. Default true.
     * Idle recovery stays off until `heartbeat_timeout_ms` is set.
     */
    reconnect?: boolean
    reconnect_delay_ms?: number
    /** Application ping interval. Default 20000. `0` disables pings. */
    heartbeat_interval_ms?: number
    /**
     * Drop the socket when no inbound frame arrives for this long, then reconnect.
     * Default `0` (off), so short-lived and forward sessions keep their previous behavior.
     * Set for example `15000` on a long-lived forward to self-heal a half-open tunnel.
     */
    heartbeat_timeout_ms?: number
    timeout_ms?: number
    signal?: AbortSignal

    on_open?: (client: HubWsClient) => void
    on_message?: (data: string) => void
    on_binary?: (bytes: Uint8Array) => void
    on_close?: (event: CloseEvent) => boolean | void
    on_error?: (event: Event) => void
}

export type ConnectWsOptions = HubWsClientOptions

/**
 * Normalizes HTTP/HTTPS/WS/WSS URLs to a WebSocket URL scheme (ws:// or wss://).
 */
export function format_ws_url(url_str: string): string {
    let base = url_str.trim()
    if (base.startsWith("https://")) {
        base = "wss://" + base.slice(8)
    } else if (base.startsWith("http://")) {
        base = "ws://" + base.slice(7)
    } else if (!base.startsWith("wss://") && !base.startsWith("ws://")) {
        base = "wss://" + base
    }
    return base
}

/**
 * Constructs a fully qualified WebSocket URL with path and query parameters.
 */
export function build_ws_url(
    hub_url: string,
    path: string,
    token: string,
    query_params?: Record<string, string | number>
): string {
    const base = format_ws_url(hub_url)
    const url = new URL(base)
    url.pathname = path
    if (token) {
        url.searchParams.set("token", token.trim())
    }
    if (query_params) {
        for (const [key, value] of Object.entries(query_params)) {
            url.searchParams.set(key, String(value))
        }
    }
    return url.toString()
}

/**
 * Caller WebSocket. Frames go through `WsLifecycle`.
 * Ping defaults on; idle drop stays off unless `heartbeat_timeout_ms` is set.
 */
export class HubWsClient {
    public readonly options: HubWsClientOptions
    private readonly life: WsLifecycle

    public constructor(options: HubWsClientOptions) {
        this.options = options
        this.life = new WsLifecycle({
            url: build_ws_url(options.hub_url, options.path, options.token, options.query_params),
            reconnect: options.reconnect !== false,
            reconnect_delay_ms: options.reconnect_delay_ms ?? 3000,
            ping_interval_ms: options.heartbeat_interval_ms ?? 20000,
            idle_timeout_ms: options.heartbeat_timeout_ms ?? 0,
            connect_timeout_ms: options.timeout_ms ?? 10000,
            signal: options.signal,
            on_open: () => options.on_open?.(this),
            on_message: (data) => options.on_message?.(data),
            on_binary: (bytes) => options.on_binary?.(bytes),
            on_error: (event) => options.on_error?.(event),
            on_close: (event) => options.on_close?.(event)
        })
    }

    public get readyState(): number {
        return this.life.readyState
    }

    public get is_open(): boolean {
        return this.life.is_open
    }

    public connect(): Promise<void> {
        return this.life.start()
    }

    public send_json(data: unknown): void {
        this.life.send_json(data)
    }

    public send_binary(data: Uint8Array): void {
        this.life.send_binary(data)
    }

    public close(code = 1000, reason = "Client closed"): void {
        this.life.stop(code, reason)
    }
}

/**
 * Creates, connects, and returns an initialized HubWsClient.
 */
export async function connect_hub_ws(options: ConnectWsOptions): Promise<HubWsClient> {
    const client = new HubWsClient(options)
    await client.connect()
    return client
}
