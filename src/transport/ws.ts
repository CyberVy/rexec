/** Connecting → Open → Replacing → Backoff → Connecting. Stopped does not reconnect. */
export type LifecyclePhase = "idle" | "connecting" | "open" | "replacing" | "backoff" | "stopped"

const CLOSING_GRACE_MS = 1000

export interface WsClientOptions {
    url: string
    /** When false, a dead socket stops instead of connecting again. Default true. */
    reconnect?: boolean
    reconnect_delay_ms?: number
    /** Application ping interval. `0` disables pings. Default `0`. */
    ping_interval_ms?: number
    /** Reconnect when no inbound frame arrives. `0` disables the idle check. Default `0`. */
    idle_timeout_ms?: number
    /** Handshake deadline for every attempt. Default 10000. */
    connect_timeout_ms?: number
    /**
     * Extra interval folded into the single watchdog period.
     * Callers use this so `on_tick` can run a probe without a second timer.
     */
    watch_ms?: number
    signal?: AbortSignal
    /** RST the socket after close so a proxy cannot keep the caller session open. */
    reset_on_close?: boolean

    on_open?: (client: WsClient) => void
    on_message?: (data: string) => void
    on_binary?: (bytes: Uint8Array) => void
    on_error?: (event: Event) => void
    /** Return false to stop. The lifecycle does not exit the process. */
    on_close?: (event: CloseEvent) => boolean | void
    on_dead?: (reason: string) => void
    /** Fires while Open, after the ping and idle checks. */
    on_tick?: (now: number) => void
}

interface DestroyableSocket {
    destroy: () => void
    resetAndDestroy?: () => void
    remotePort?: number
}

function is_node_socket(value: unknown): value is DestroyableSocket {
    if (!value || typeof value !== "object") return false
    const candidate = value as { destroy?: unknown; write?: unknown }
    return typeof candidate.destroy === "function" && typeof candidate.write === "function"
}

function parse_port(url_str: string): number | undefined {
    try {
        const parsed = new URL(url_str)
        if (parsed.port) return Number(parsed.port)
        if (parsed.protocol === "wss:" || parsed.protocol === "https:") return 443
        if (parsed.protocol === "ws:" || parsed.protocol === "http:") return 80
    } catch {
        return undefined
    }
    return undefined
}

function find_socket(root: object, target_port?: number): DestroyableSocket | null {
    const seen = new Set<unknown>()
    const queue: unknown[] = [root]
    let fallback: DestroyableSocket | null = null
    while (queue.length > 0 && seen.size < 80) {
        const current = queue.shift()
        if (!current || typeof current !== "object" || seen.has(current)) continue
        seen.add(current)
        const named = current as { socket?: unknown }
        if (is_node_socket(named.socket)) {
            if (typeof named.socket.resetAndDestroy === "function") return named.socket
            fallback ??= named.socket
        }
        let keys: (string | symbol)[]
        try {
            keys = [...Object.getOwnPropertyNames(current), ...Object.getOwnPropertySymbols(current)]
        } catch {
            continue
        }
        for (const key of keys) {
            if (key === "ws") continue
            try {
                const value = (current as Record<string | symbol, unknown>)[key]
                if (value && typeof value === "object") queue.push(value)
            } catch {
                // Getter threw.
            }
        }
    }
    if (fallback) return fallback

    // Modern Node.js undici WebSocket stores socket in private fields.
    // Inspect active handles if available in Node.js runtime.
    if (
        typeof process !== "undefined" &&
        typeof (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles === "function"
    ) {
        try {
            const handles = (process as unknown as { _getActiveHandles: () => unknown[] })._getActiveHandles()
            for (const handle of handles) {
                if (is_node_socket(handle)) {
                    if (target_port !== undefined && handle.remotePort === target_port) {
                        return handle
                    }
                }
            }
        } catch {
            // Ignore
        }
    }

    return null
}

/** RST. A graceful close can sit in CLOSING while a proxy holds the TCP flow. */
function abort_websocket(ws: WebSocket, target_port?: number): void {
    const socket = find_socket(ws, target_port)
    if (socket) {
        try {
            if (typeof socket.resetAndDestroy === "function") socket.resetAndDestroy()
            else socket.destroy()
            return
        } catch {
            // Already unusable.
        }
    }
    try {
        ws.close(1000, "Aborted")
    } catch {
        // Already unusable.
    }
}

function is_pong(data: string): boolean {
    if (data === '{"type":"pong"}') return true
    if (!data.startsWith("{") || !data.includes('"pong"')) return false
    try {
        return (JSON.parse(data) as { type?: string }).type === "pong"
    } catch {
        return false
    }
}

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
    base_url: string,
    path: string,
    token?: string,
    query_params?: Record<string, string | number>
): string {
    const base = format_ws_url(base_url)
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

interface PendingOpen {
    resolve: () => void
    reject: (err: Error) => void
}

/**
 * Universal WebSocket client with watchdog heartbeat, idle detection,
 * half-open TCP abortion, and exponential backoff reconnection.
 */
export class WsClient {
    public readonly options: WsClientOptions
    private phase: LifecyclePhase = "idle"
    private ws: WebSocket | null = null
    private readonly retired = new WeakSet<WebSocket>()
    private attempt = 0
    private has_opened = false
    private pending: PendingOpen | null = null
    private watchdog: ReturnType<typeof setInterval> | null = null
    private backoff_timer: ReturnType<typeof setTimeout> | null = null
    private outstanding_ping: string | null = null
    private ping_seq = 0
    private last_inbound_at = 0
    private last_ping_at = 0
    private attempt_started_at = 0
    private closing_since = 0
    private readonly target_port?: number

    public constructor(options: WsClientOptions) {
        this.options = options
        this.target_port = parse_port(options.url)
        if (options.signal) {
            options.signal.addEventListener("abort", () => this.close(1000, "Aborted by signal"), { once: true })
        }
    }

    public get epoch(): number {
        return this.attempt
    }

    public get is_open(): boolean {
        return this.phase === "open" && this.ws !== null && this.ws.readyState === WebSocket.OPEN
    }

    public get readyState(): number {
        return this.ws ? this.ws.readyState : WebSocket.CLOSED
    }

    public connect(): Promise<void> {
        if (this.phase === "stopped") return Promise.resolve()
        this.start_watchdog()
        return new Promise<void>((resolve, reject) => {
            this.pending = { resolve, reject }
            this.connect_socket()
        })
    }

    /** Alias for connect() */
    public start(): Promise<void> {
        return this.connect()
    }

    public close(code = 1000, reason = "Client closed"): void {
        if (this.phase === "stopped") return
        this.phase = "stopped"
        this.clear_backoff()
        this.clear_watchdog()
        const pending = this.pending
        this.pending = null
        if (pending && !this.has_opened) pending.reject(new Error(reason))
        const ws = this.ws
        this.ws = null
        if (!ws) return
        this.retired.add(ws)
        try {
            ws.close(code, reason)
        } catch {
            // Ignore
        }
        if (this.options.reset_on_close) abort_websocket(ws, this.target_port)
    }

    /** Alias for close() */
    public stop(code = 1000, reason = "Client closed"): void {
        this.close(code, reason)
    }

    public send_json(data: unknown): void {
        this.send_text(JSON.stringify(data))
    }

    public send_binary(data: Uint8Array): void {
        if (!this.is_open || !this.ws) return
        this.ws.send(data)
    }

    /** Connecting or Open → Replacing → RST → Backoff → Connecting. */
    public drop(reason: string): void {
        this.fail(reason)
    }

    private send_text(payload: string): void {
        if (!this.is_open || !this.ws) return
        this.ws.send(payload)
    }

    private fail(reason: string): void {
        if (this.phase !== "connecting" && this.phase !== "open") return
        const ws = this.ws
        this.phase = "replacing"
        this.ws = null
        this.outstanding_ping = null
        this.closing_since = 0
        if (ws) {
            this.retired.add(ws)
            abort_websocket(ws, this.target_port)
        }
        this.options.on_dead?.(reason)
        this.reject_initial(reason)
        if (this.options.reconnect === false) {
            this.phase = "stopped"
            this.clear_watchdog()
            return
        }
        this.phase = "backoff"
        this.arm_backoff()
    }

    private reject_initial(reason: string): void {
        if (!this.pending || this.has_opened) return
        const pending = this.pending
        this.pending = null
        pending.reject(new Error(reason))
    }

    private connect_socket(): void {
        if (this.phase === "stopped") return
        this.clear_backoff()
        this.phase = "connecting"
        this.attempt += 1
        this.attempt_started_at = Date.now()
        this.closing_since = 0
        this.outstanding_ping = null
        const attempt = this.attempt

        let ws: WebSocket
        try {
            ws = new WebSocket(this.options.url)
            ws.binaryType = "arraybuffer"
        } catch {
            this.fail("connect_timeout")
            return
        }
        this.ws = ws

        ws.addEventListener("open", () => {
            if (this.phase !== "connecting" || this.ws !== ws || this.attempt !== attempt) return
            this.enter_open()
        })

        ws.addEventListener("error", (event: Event) => {
            if (this.retired.has(ws)) return
            this.options.on_error?.(event)
        })

        ws.addEventListener("close", (event: CloseEvent) => {
            if (this.retired.has(ws) || this.ws !== ws) return
            const keep_going = this.options.on_close?.(event)
            if (keep_going === false || this.phase === "stopped") {
                this.retired.add(ws)
                this.ws = null
                this.phase = "stopped"
                this.clear_backoff()
                this.clear_watchdog()
                this.reject_initial(event.reason || "closed")
                return
            }
            this.fail("socket_close")
        })

        ws.addEventListener("message", (event: MessageEvent) => {
            if (this.phase !== "open" || this.ws !== ws || this.attempt !== attempt) return
            if (typeof event.data === "string") {
                if (!this.observe_text(event.data)) return
                this.options.on_message?.(event.data)
                return
            }
            this.last_inbound_at = Date.now()
            void this.deliver_binary(ws, attempt, event.data)
        })
    }

    private enter_open(): void {
        const now = Date.now()
        this.phase = "open"
        this.has_opened = true
        this.last_inbound_at = now
        this.last_ping_at = now
        this.closing_since = 0
        const pending = this.pending
        this.pending = null
        pending?.resolve()
        this.options.on_open?.(this)
    }

    private observe_text(data: string): boolean {
        if (this.outstanding_ping && data === this.outstanding_ping) {
            this.fail("ping_echoed")
            return false
        }
        this.last_inbound_at = Date.now()
        return !is_pong(data)
    }

    private tick(): void {
        if (
            this.phase === "stopped" ||
            this.phase === "idle" ||
            this.phase === "replacing" ||
            this.phase === "backoff"
        ) {
            return
        }
        const now = Date.now()
        const ws = this.ws
        if (!ws) return

        if (this.phase === "connecting") {
            if (ws.readyState !== WebSocket.CONNECTING && ws.readyState !== WebSocket.OPEN) {
                this.note_closing(now)
                return
            }
            if (now - this.attempt_started_at >= (this.options.connect_timeout_ms ?? 10000)) {
                this.fail("connect_timeout")
            }
            return
        }

        if (ws.readyState !== WebSocket.OPEN) {
            this.note_closing(now)
            return
        }

        this.closing_since = 0
        const idle = this.options.idle_timeout_ms ?? 0
        if (idle > 0 && now - this.last_inbound_at >= idle) {
            this.fail("idle_timeout")
            return
        }

        const ping = this.options.ping_interval_ms ?? 0
        if (ping > 0 && now - this.last_ping_at >= ping) {
            this.last_ping_at = now
            this.send_ping()
            if (this.phase !== "open") return
        }

        this.options.on_tick?.(now)
    }

    private note_closing(now: number): void {
        if (this.closing_since === 0) this.closing_since = now
        if (now - this.closing_since >= CLOSING_GRACE_MS) this.fail("stuck_closing")
    }

    private send_ping(): void {
        this.ping_seq = (this.ping_seq + 1) % 1_000_000_000
        const payload = JSON.stringify({ type: "ping", n: this.ping_seq })
        this.outstanding_ping = payload
        try {
            this.send_text(payload)
        } catch {
            this.fail("socket_close")
        }
    }

    private arm_backoff(): void {
        this.clear_backoff()
        const delay = this.options.reconnect_delay_ms ?? 3000
        this.backoff_timer = setTimeout(() => {
            this.backoff_timer = null
            if (this.phase === "backoff") this.connect_socket()
        }, delay)
    }

    private clear_backoff(): void {
        if (!this.backoff_timer) return
        clearTimeout(this.backoff_timer)
        this.backoff_timer = null
    }

    private start_watchdog(): void {
        this.clear_watchdog()
        const samples = [
            this.options.connect_timeout_ms ?? 10000,
            this.options.idle_timeout_ms ?? 0,
            this.options.ping_interval_ms ?? 0,
            this.options.watch_ms ?? 0
        ].filter((value) => value > 0)
        const period = samples.length === 0 ? 1000 : Math.max(50, Math.min(1000, Math.floor(Math.min(...samples) / 2)))
        this.watchdog = setInterval(() => this.tick(), period)
    }

    private clear_watchdog(): void {
        if (!this.watchdog) return
        clearInterval(this.watchdog)
        this.watchdog = null
    }

    private async deliver_binary(ws: WebSocket, attempt: number, data: unknown): Promise<void> {
        let bytes: Uint8Array
        if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data)
        } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        } else if (data && typeof (data as Blob).arrayBuffer === "function") {
            const ab = await (data as Blob).arrayBuffer()
            if (this.phase !== "open" || this.ws !== ws || this.attempt !== attempt) return
            bytes = new Uint8Array(ab)
        } else {
            return
        }
        if (this.phase !== "open" || this.ws !== ws || this.attempt !== attempt) return
        this.options.on_binary?.(bytes)
    }
}
