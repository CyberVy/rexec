export interface HubWsClientOptions {
    hub_url: string
    path: string
    token: string
    query_params?: Record<string, string | number>
    reconnect?: boolean
    reconnect_delay_ms?: number
    heartbeat_interval_ms?: number
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
 * Industrial-grade unified WebSocket client with automatic heartbeat,
 * connection timeout, and reconnect resilience. Shared by Agent and Caller.
 */
export class HubWsClient {
    public readonly options: HubWsClientOptions
    private ws: WebSocket | null = null
    private is_destroyed = false
    private heartbeat_timer: ReturnType<typeof setInterval> | null = null
    private reconnect_timer: ReturnType<typeof setTimeout> | null = null

    public constructor(options: HubWsClientOptions) {
        this.options = options
        if (options.signal) {
            options.signal.addEventListener("abort", () => this.close(1000, "Aborted by signal"), { once: true })
        }
    }

    public get readyState(): number {
        return this.ws ? this.ws.readyState : WebSocket.CLOSED
    }

    public get is_open(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN
    }

    public async connect(): Promise<void> {
        if (this.is_destroyed) return
        return this.establish_connection(true)
    }

    public send_json(data: unknown): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
        }
    }

    public send_binary(data: Uint8Array): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data)
        }
    }

    public close(code = 1000, reason = "Client closed"): void {
        this.is_destroyed = true
        this.stop_heartbeat()
        this.clear_reconnect()
        if (this.ws) {
            try {
                this.ws.close(code, reason)
            } catch {
                // Ignore
            }
            this.ws = null
        }
    }

    private clear_reconnect(): void {
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer)
            this.reconnect_timer = null
        }
    }

    private start_heartbeat(): void {
        this.stop_heartbeat()
        const interval = this.options.heartbeat_interval_ms ?? 20000
        if (interval <= 0) return
        this.heartbeat_timer = setInterval(() => {
            if (this.is_open) {
                this.send_json({ type: "ping" })
            }
        }, interval)
    }

    private stop_heartbeat(): void {
        if (this.heartbeat_timer) {
            clearInterval(this.heartbeat_timer)
            this.heartbeat_timer = null
        }
    }

    private schedule_reconnect(): void {
        if (this.is_destroyed || this.options.reconnect === false) return
        if (this.reconnect_timer) return

        const delay = this.options.reconnect_delay_ms ?? 3000
        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null
            if (!this.is_destroyed) {
                void this.establish_connection(false).catch(() => {})
            }
        }, delay)
    }

    private async establish_connection(is_initial: boolean): Promise<void> {
        if (this.is_destroyed) return

        const url = build_ws_url(this.options.hub_url, this.options.path, this.options.token, this.options.query_params)

        const timeout_ms = this.options.timeout_ms ?? 10000

        return new Promise<void>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null
            let ws: WebSocket

            try {
                ws = new WebSocket(url)
                ws.binaryType = "arraybuffer"
                this.ws = ws
            } catch (err) {
                if (is_initial) {
                    reject(err)
                } else {
                    this.schedule_reconnect()
                }
                return
            }

            const on_open = () => {
                if (timer) clearTimeout(timer)
                this.start_heartbeat()
                this.options.on_open?.(this)
                resolve()
            }

            const on_error = (event: Event) => {
                if (timer && is_initial) {
                    clearTimeout(timer)
                    reject(new Error(`WebSocket connection to '${this.options.path}' failed`))
                }
                this.options.on_error?.(event)
            }

            const on_close = (event: CloseEvent) => {
                if (timer && is_initial) {
                    clearTimeout(timer)
                    reject(
                        new Error(
                            `WebSocket closed before ready (code: ${event.code}, reason: ${event.reason || "none"})`
                        )
                    )
                }
                this.stop_heartbeat()
                const should_reconnect = this.options.on_close?.(event)
                if (should_reconnect !== false && !this.is_destroyed && this.options.reconnect !== false) {
                    this.schedule_reconnect()
                }
            }

            ws.addEventListener("open", on_open)
            ws.addEventListener("error", on_error)
            ws.addEventListener("close", on_close)

            ws.addEventListener("message", async (event: MessageEvent) => {
                if (typeof event.data === "string") {
                    if (event.data === '{"type":"pong"}') return
                    this.options.on_message?.(event.data)
                } else {
                    let bytes: Uint8Array
                    if (event.data instanceof ArrayBuffer) {
                        bytes = new Uint8Array(event.data)
                    } else if (ArrayBuffer.isView(event.data)) {
                        bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
                    } else if (event.data && typeof (event.data as Blob).arrayBuffer === "function") {
                        const ab = await (event.data as Blob).arrayBuffer()
                        bytes = new Uint8Array(ab)
                    } else {
                        return
                    }
                    this.options.on_binary?.(bytes)
                }
            })

            if (is_initial) {
                timer = setTimeout(() => {
                    timer = null
                    try {
                        ws.close(1000, "Connection timeout")
                    } catch {
                        // Ignore
                    }
                    reject(new Error(`WebSocket connection to '${this.options.path}' timed out after ${timeout_ms}ms`))
                }, timeout_ms)
            }
        })
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
