export interface HubWsClientOptions {
    hub_url: string
    path: string
    token: string
    query_params?: Record<string, string | number>
    reconnect?: boolean
    reconnect_delay_ms?: number
    heartbeat_interval_ms?: number
    /**
     * How long to wait for any inbound frame after a ping before the socket is
     * declared dead. Defaults to `heartbeat_interval_ms`. One missed pong is
     * enough: WebSocket runs on TCP, so a missing pong means the path is dead,
     * not that a datagram was lost.
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

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000
const DEFAULT_RECONNECT_DELAY_MS = 3_000
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const MAX_PONG_BUFFER_DEFERRALS = 3
const HEARTBEAT_CLOSE_CODE = 4000
const HEARTBEAT_CLOSE_REASON = "heartbeat pong timeout"

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

function make_close_event(code: number, reason: string): CloseEvent {
    const ctor = (globalThis as unknown as { CloseEvent?: new (type: string, init?: CloseEventInit) => CloseEvent })
        .CloseEvent
    if (ctor) return new ctor("close", { code, reason, wasClean: false })
    // Node's global WebSocket dispatches CloseEvent, but the constructor is not global.
    return { code, reason, wasClean: false } as CloseEvent
}

function is_pong_message(data: string): boolean {
    if (data === '{"type":"pong"}') return true
    if (data.length > 80 || !data.includes('"pong"')) return false
    try {
        return (JSON.parse(data) as { type?: unknown }).type === "pong"
    } catch {
        return false
    }
}

/**
 * Node's global WebSocket (undici) only emits `close` when the TCP socket
 * closes. `WebSocket.close()` sends a close frame and then waits forever if a
 * proxy ACKs the frame but never finishes the TCP close. Destroy the
 * underlying socket so a half-open session cannot pin the client in CLOSING.
 */
function terminate_websocket(ws: WebSocket): void {
    try {
        const symbols = Object.getOwnPropertySymbols(ws)
        for (const symbol of symbols) {
            if (symbol.description !== "response") continue
            const response = (ws as unknown as Record<symbol, { socket?: { destroy?: () => void } } | undefined>)[
                symbol
            ]
            const socket = response?.socket
            if (socket && typeof socket.destroy === "function") {
                socket.destroy()
                return
            }
        }
    } catch {
        // Fall through to the standard close.
    }
    try {
        ws.close(HEARTBEAT_CLOSE_CODE, HEARTBEAT_CLOSE_REASON)
    } catch {
        // Socket is already unusable.
    }
}

/**
 * Unified WebSocket client with heartbeat, dead-connection detection,
 * connection timeout, and reconnect. Shared by Agent and Caller.
 */
export class HubWsClient {
    readonly options: HubWsClientOptions
    private ws: WebSocket | null = null
    private readonly retired = new WeakSet<WebSocket>()
    private is_destroyed = false
    private awaiting_pong = false
    private pong_deferrals = 0
    private heartbeat_timer: ReturnType<typeof setInterval> | null = null
    private reconnect_timer: ReturnType<typeof setTimeout> | null = null
    private pong_timer: ReturnType<typeof setTimeout> | null = null

    constructor(options: HubWsClientOptions) {
        this.options = options
        if (options.signal) {
            options.signal.addEventListener("abort", () => this.close(1000, "Aborted by signal"), { once: true })
        }
    }

    get readyState(): number {
        return this.ws ? this.ws.readyState : WebSocket.CLOSED
    }

    get is_open(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN
    }

    async connect(): Promise<void> {
        if (this.is_destroyed) return
        return this.establish_connection(true)
    }

    send_json(data: unknown): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
        }
    }

    send_binary(data: Uint8Array): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data)
        }
    }

    close(code = 1000, reason = "Client closed"): void {
        this.is_destroyed = true
        this.stop_heartbeat()
        this.clear_reconnect()
        const ws = this.ws
        this.ws = null
        if (ws) {
            try {
                ws.close(code, reason)
            } catch {
                // Ignore
            }
        }
    }

    private heartbeat_interval_ms(): number {
        return this.options.heartbeat_interval_ms ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    }

    private heartbeat_timeout_ms(): number {
        const timeout = this.options.heartbeat_timeout_ms ?? this.heartbeat_interval_ms()
        return timeout > 0 ? timeout : this.heartbeat_interval_ms()
    }

    private clear_reconnect(): void {
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer)
            this.reconnect_timer = null
        }
    }

    private clear_pong_timer(): void {
        if (this.pong_timer) {
            clearTimeout(this.pong_timer)
            this.pong_timer = null
        }
    }

    private note_activity(): void {
        this.awaiting_pong = false
        this.pong_deferrals = 0
        this.clear_pong_timer()
    }

    private start_heartbeat(): void {
        this.stop_heartbeat()
        const interval = this.heartbeat_interval_ms()
        if (interval <= 0) return
        this.send_ping()
        if (this.is_destroyed || !this.ws) return
        this.heartbeat_timer = setInterval(() => {
            this.send_ping()
        }, interval)
    }

    private stop_heartbeat(): void {
        if (this.heartbeat_timer) {
            clearInterval(this.heartbeat_timer)
            this.heartbeat_timer = null
        }
        this.clear_pong_timer()
        this.awaiting_pong = false
        this.pong_deferrals = 0
    }

    private send_ping(): void {
        if (this.is_destroyed || !this.is_open) return
        if (this.awaiting_pong) return
        this.awaiting_pong = true
        this.pong_deferrals = 0
        try {
            this.send_json({ type: "ping" })
        } catch {
            this.fail_connection("heartbeat ping failed")
            return
        }
        this.arm_pong_timer()
    }

    private arm_pong_timer(): void {
        this.clear_pong_timer()
        const timeout = this.heartbeat_timeout_ms()
        if (timeout <= 0) return
        this.pong_timer = setTimeout(() => {
            this.pong_timer = null
            this.on_pong_timeout()
        }, timeout)
    }

    private on_pong_timeout(): void {
        if (!this.awaiting_pong || this.is_destroyed) return
        // A ping queued behind a large send has not reached the peer yet.
        // Keep waiting while the kernel buffer is still draining, but not forever.
        if (this.ws && this.ws.bufferedAmount > 0 && this.pong_deferrals < MAX_PONG_BUFFER_DEFERRALS) {
            this.pong_deferrals++
            this.arm_pong_timer()
            return
        }
        this.fail_connection(HEARTBEAT_CLOSE_REASON)
    }

    private schedule_reconnect(): void {
        if (this.is_destroyed || this.options.reconnect === false) return
        if (this.reconnect_timer) return

        const delay = this.options.reconnect_delay_ms ?? DEFAULT_RECONNECT_DELAY_MS
        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null
            if (!this.is_destroyed) {
                void this.establish_connection(false).catch(() => {})
            }
        }, delay)
    }

    /**
     * Drop the current socket and reconnect without waiting for a TCP close
     * that may never arrive. Close events from the abandoned socket are ignored.
     */
    private fail_connection(reason: string): void {
        if (this.is_destroyed) return
        const ws = this.ws
        if (!ws) return
        this.retired.add(ws)
        this.ws = null
        this.stop_heartbeat()
        terminate_websocket(ws)
        const event = make_close_event(HEARTBEAT_CLOSE_CODE, reason)
        const should_reconnect = this.options.on_close?.(event)
        if (should_reconnect !== false && !this.is_destroyed && this.options.reconnect !== false) {
            this.schedule_reconnect()
        }
    }

    private async establish_connection(is_initial: boolean): Promise<void> {
        if (this.is_destroyed) return

        const url = build_ws_url(this.options.hub_url, this.options.path, this.options.token, this.options.query_params)
        const timeout_ms = this.options.timeout_ms ?? DEFAULT_CONNECT_TIMEOUT_MS

        return new Promise<void>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null
            let ws: WebSocket

            try {
                ws = new WebSocket(url)
                ws.binaryType = "arraybuffer"
                this.ws = ws
            } catch (err) {
                if (is_initial) {
                    reject(err instanceof Error ? err : new Error(String(err)))
                } else {
                    this.schedule_reconnect()
                }
                return
            }

            const is_current = (): boolean => this.ws === ws && !this.retired.has(ws) && !this.is_destroyed

            const on_open = () => {
                if (!is_current()) return
                if (timer) {
                    clearTimeout(timer)
                    timer = null
                }
                this.start_heartbeat()
                this.options.on_open?.(this)
                resolve()
            }

            const on_error = (event: Event) => {
                if (!is_current()) return
                if (timer && is_initial) {
                    clearTimeout(timer)
                    timer = null
                    reject(new Error(`WebSocket connection to '${this.options.path}' failed`))
                }
                this.options.on_error?.(event)
            }

            const on_close = (event: CloseEvent) => {
                if (this.retired.has(ws)) return
                // A newer socket is already current. This close belongs to a previous attempt
                // that was not explicitly retired (it should have been). Ignore it so it cannot
                // stop the live heartbeat or exit the process on a stale 1000.
                if (this.ws !== null && this.ws !== ws) return
                if (this.ws === ws) this.ws = null
                const closed_before_open = timer !== null && is_initial
                if (timer) {
                    clearTimeout(timer)
                    timer = null
                }
                if (closed_before_open) {
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

            ws.addEventListener("message", (event: MessageEvent) => {
                if (!is_current()) return
                void this.handle_message(ws, event)
            })

            if (is_initial) {
                timer = setTimeout(() => {
                    if (timer === null || this.ws !== ws || this.retired.has(ws)) return
                    timer = null
                    this.retired.add(ws)
                    this.ws = null
                    this.stop_heartbeat()
                    try {
                        ws.close(1000, "Connection timeout")
                    } catch {
                        // Ignore
                    }
                    reject(new Error(`WebSocket connection to '${this.options.path}' timed out after ${timeout_ms}ms`))
                    this.schedule_reconnect()
                }, timeout_ms)
            }
        })
    }

    private async handle_message(ws: WebSocket, event: MessageEvent): Promise<void> {
        if (this.ws !== ws || this.is_destroyed) return
        this.note_activity()

        if (typeof event.data === "string") {
            if (is_pong_message(event.data)) return
            this.options.on_message?.(event.data)
            return
        }

        let bytes: Uint8Array
        if (event.data instanceof ArrayBuffer) {
            bytes = new Uint8Array(event.data)
        } else if (ArrayBuffer.isView(event.data)) {
            bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
        } else if (event.data && typeof (event.data as Blob).arrayBuffer === "function") {
            const ab = await (event.data as Blob).arrayBuffer()
            if (this.ws !== ws || this.is_destroyed) return
            bytes = new Uint8Array(ab)
        } else {
            return
        }
        this.options.on_binary?.(bytes)
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
