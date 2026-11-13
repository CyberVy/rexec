import {
    HUB_ROUTES,
    PTY_CALLER_REPLACED_REASON,
    type PtyKillResMessage,
    type PtyListResMessage,
    type PtySessionInfo,
    type PtyUpdateResMessage
} from "@/protocol"
import { SESSION_ID_BYTES, decode_pty_frame, encode_pty_frame } from "@/transport/framing"
import { build_ws_url, WsClient } from "@/transport/ws"

export { PTY_CALLER_REPLACED_REASON }

const PTY_SESSION_MISSING = "PTY session not found or expired"
const PTY_PING_INTERVAL_MS = 20_000
/** Three missed pongs, matching the forward tunnel heartbeat. Detects half-open connections instead of blackholing. */
const PTY_IDLE_TIMEOUT_MS = PTY_PING_INTERVAL_MS * 3
const PTY_RECONNECT_BASE_DELAY_MS = 1_000
const PTY_RECONNECT_MAX_DELAY_MS = 10_000
const PTY_RPC_TIMEOUT_MS = 10_000

function generate_session_id(): string {
    return crypto.randomUUID().replace(/-/g, "").slice(0, SESSION_ID_BYTES)
}

export class PtySocketClosed extends Error {
    readonly close_code: number
    readonly close_reason: string

    public constructor(close_code: number, close_reason: string) {
        super(close_reason || "PTY session closed")
        this.name = "PtySocketClosed"
        this.close_code = close_code
        this.close_reason = close_reason
    }
}

export class PtySessionError extends Error {
    public constructor(message: string) {
        super(message || "PTY session failed")
        this.name = "PtySessionError"
    }
}

export function pty_taken_by_another_caller(err: unknown): boolean {
    return err instanceof PtySocketClosed && err.close_code === 1000 && err.close_reason === PTY_CALLER_REPLACED_REASON
}

export function pty_session_missing(err: unknown): boolean {
    return err instanceof Error && err.message === PTY_SESSION_MISSING
}

interface RegisteredPtySession {
    survive_agent_offline: boolean
    on_data(data: Uint8Array): void
    on_replay(info: PtyReplayInfo): void
    on_exit(status: PtyExitStatus): void
    on_error(err: Error): void
    on_detached(reason: string): void
    on_transport_closed(err: Error): void
    on_agent_offline?(): void
    get_reattach_params?(): { offset?: number; cols: number; rows: number }
}

interface PendingRpc<T = unknown> {
    resolve(value: T): void
    reject(err: Error): void
    timer: ReturnType<typeof setTimeout>
}

export interface PtyMuxOptions {
    hub_url: string
    token: string
    keep_alive?: boolean
}

/**
 * Shared multiplexed `/ws/pty` transport carrying multiple interactive PTY
 * sessions plus control RPCs (`list`, `kill`, `update`) over a single
 * Caller<->Hub WebSocket connection.
 */
export class PtyMuxClient {
    private readonly hub_url: string
    private readonly token: string
    private readonly keep_alive: boolean

    private client: WsClient | null = null
    private connect_promise: Promise<void> | null = null
    private resolve_status: (() => void) | null = null
    private reject_status: ((err: Error) => void) | null = null
    private status_received = false
    private agent_online = false
    private leases = 0
    private readonly sessions = new Map<string, RegisteredPtySession>()
    private readonly pending_rpcs = new Map<string, PendingRpc>()

    public constructor(options: PtyMuxOptions) {
        this.hub_url = options.hub_url
        this.token = options.token
        this.keep_alive = Boolean(options.keep_alive)
    }

    public async list_ptys(): Promise<PtySessionInfo[]> {
        return this.run_rpc<PtySessionInfo[]>(
            (req_id) => ({ type: "pty:list_req", req_id }),
            "Timed out listing PTY sessions"
        )
    }

    public async kill_pty(session_id: string): Promise<void> {
        await this.run_rpc<void>(
            (req_id) => ({ type: "pty:kill", session_id, req_id }),
            "Timed out killing PTY session"
        )
    }

    public async update_pty(session_id: string, updates: { persistent: boolean }): Promise<void> {
        await this.run_rpc<void>(
            (req_id) => ({ type: "pty:update", session_id, persistent: updates.persistent, req_id }),
            "Timed out updating PTY session"
        )
    }

    public async acquire_session_transport(signal?: AbortSignal): Promise<void> {
        await this.ensure_connected(signal)
        this.leases += 1
    }

    public register_session(session_id: string, entry: RegisteredPtySession): void {
        const existing = this.sessions.get(session_id)
        if (existing) {
            this.sessions.delete(session_id)
            existing.on_detached(PTY_CALLER_REPLACED_REASON)
        }
        this.sessions.set(session_id, entry)
    }

    public unregister_session(session_id: string): boolean {
        return this.sessions.delete(session_id)
    }

    public release_lease(): void {
        if (this.leases > 0) {
            this.leases -= 1
        }
        this.release_if_idle()
    }

    public send_json(data: unknown): void {
        this.client?.send_json(data)
    }

    public send_binary(data: Uint8Array): void {
        this.client?.send_binary(data)
    }

    public ping(): void {
        this.client?.ping()
    }

    public close(): void {
        const client = this.client
        this.client = null
        this.status_received = false
        this.agent_online = false
        this.leases = 0

        const reject = this.reject_status
        this.resolve_status = null
        this.reject_status = null
        reject?.(new PtySocketClosed(1000, "PTY client closed"))

        this.fail_pending_rpcs(new PtySocketClosed(1000, "PTY client closed"))

        const stale = [...this.sessions.values()]
        this.sessions.clear()
        for (const entry of stale) {
            entry.on_transport_closed(new PtySocketClosed(1000, "PTY client closed"))
        }

        client?.close(1000, "PTY client closed")
    }

    private async run_rpc<T>(build_msg: (req_id: string) => unknown, timeout_message: string): Promise<T> {
        await this.ensure_connected()
        this.leases += 1
        const req_id = generate_session_id()
        try {
            return await new Promise<T>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending_rpcs.delete(req_id)
                    reject(new Error(timeout_message))
                }, PTY_RPC_TIMEOUT_MS)

                this.pending_rpcs.set(req_id, {
                    resolve: (val) => resolve(val as T),
                    reject,
                    timer
                })
                this.send_json(build_msg(req_id))
            })
        } finally {
            this.release_lease()
        }
    }

    private async ensure_connected(signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) {
            throw new PtySocketClosed(1000, "PTY connection aborted")
        }

        if (this.client?.is_open && this.status_received) {
            if (!this.agent_online) {
                throw new Error("No agent connected for this token")
            }
            return
        }

        if (!this.connect_promise) {
            this.connect_promise = this.open_transport().finally(() => {
                this.connect_promise = null
            })
        }

        if (!signal) {
            await this.connect_promise
            return
        }

        await new Promise<void>((resolve, reject) => {
            const on_abort = () => reject(new PtySocketClosed(1000, "PTY connection aborted"))
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

    private async open_transport(): Promise<void> {
        this.status_received = false
        this.agent_online = false

        const status_promise = new Promise<void>((resolve, reject) => {
            this.resolve_status = resolve
            this.reject_status = reject
        })
        status_promise.catch(() => {})

        const client = new WsClient({
            url: build_ws_url(this.hub_url, HUB_ROUTES.WS_PTY.path, this.token),
            reconnect: false,
            reset_on_close: true,
            connect_timeout_ms: 10000,
            ping_interval_ms: PTY_PING_INTERVAL_MS,
            idle_timeout_ms: PTY_IDLE_TIMEOUT_MS,
            on_message: (data) => this.handle_message(data),
            on_binary: (bytes) => {
                const decoded = decode_pty_frame(bytes)
                if (decoded) {
                    this.sessions.get(decoded.session_id)?.on_data(decoded.payload)
                }
            },
            on_close: (event) => {
                this.handle_transport_closed(client, new PtySocketClosed(event.code, event.reason || ""))
            },
            on_dead: (reason) => {
                this.handle_transport_closed(client, new Error(reason || "PTY connection closed"))
            }
        })

        this.client = client
        try {
            await client.connect()
            await status_promise
        } catch (err) {
            if (this.client === client && !this.keep_alive && this.leases === 0 && this.sessions.size === 0) {
                this.client = null
                this.status_received = false
                this.agent_online = false
                client.close(1000, "PTY connect failed")
            }
            throw err
        }
    }

    private handle_transport_closed(client: WsClient, err: Error): void {
        if (this.client !== client) return
        this.client = null
        this.status_received = false
        this.agent_online = false
        this.leases = 0

        const reject = this.reject_status
        this.resolve_status = null
        this.reject_status = null
        reject?.(err)

        this.fail_pending_rpcs(err)

        const stale = [...this.sessions.values()]
        this.sessions.clear()
        for (const entry of stale) {
            entry.on_transport_closed(err)
        }
    }

    private handle_message(data: string): void {
        try {
            const msg = JSON.parse(data) as {
                type?: string
                agent_connected?: boolean
                session_id?: string
                req_id?: string
                code?: number
                signal?: number
                error?: string
                reason?: string
                bytes?: number
                reset?: boolean
                offset?: number
                sessions?: PtySessionInfo[]
                killed?: boolean
                updated?: boolean
            }

            if (msg.type === "hub:status") {
                this.status_received = true
                this.agent_online = Boolean(msg.agent_connected)
                if (this.agent_online) {
                    const resolve = this.resolve_status
                    this.resolve_status = null
                    this.reject_status = null
                    resolve?.()
                } else {
                    const reject = this.reject_status
                    this.resolve_status = null
                    this.reject_status = null
                    reject?.(new Error("No agent connected for this token"))
                }
                return
            }

            if (msg.type === "hub:agent_offline") {
                this.agent_online = false
                this.fail_pending_rpcs(new Error("Agent disconnected"))
                for (const [session_id, entry] of Array.from(this.sessions)) {
                    if (entry.survive_agent_offline) {
                        entry.on_agent_offline?.()
                    } else {
                        this.sessions.delete(session_id)
                        entry.on_error(new Error("Agent disconnected"))
                    }
                }
                return
            }

            if (msg.type === "hub:agent_online") {
                if (!this.status_received) return
                this.agent_online = true
                const resolve = this.resolve_status
                this.resolve_status = null
                this.reject_status = null
                resolve?.()
                for (const [session_id, entry] of Array.from(this.sessions)) {
                    if (!entry.survive_agent_offline) continue
                    const params = entry.get_reattach_params?.()
                    if (!params) continue
                    this.send_json({
                        type: "pty:attach",
                        session_id,
                        cols: params.cols,
                        rows: params.rows,
                        ...(typeof params.offset === "number" ? { offset: params.offset } : {})
                    })
                }
                return
            }

            if (msg.type === "pty:list_res" && msg.req_id) {
                const rpc = this.pending_rpcs.get(msg.req_id)
                if (rpc) {
                    clearTimeout(rpc.timer)
                    this.pending_rpcs.delete(msg.req_id)
                    rpc.resolve((msg as PtyListResMessage).sessions)
                }
                return
            }

            if (msg.type === "pty:kill_res" && msg.req_id) {
                const rpc = this.pending_rpcs.get(msg.req_id)
                if (rpc) {
                    clearTimeout(rpc.timer)
                    this.pending_rpcs.delete(msg.req_id)
                    void (msg as PtyKillResMessage)
                    rpc.resolve(undefined)
                }
                return
            }

            if (msg.type === "pty:update_res" && msg.req_id) {
                const rpc = this.pending_rpcs.get(msg.req_id)
                if (rpc) {
                    clearTimeout(rpc.timer)
                    this.pending_rpcs.delete(msg.req_id)
                    void (msg as PtyUpdateResMessage)
                    rpc.resolve(undefined)
                }
                return
            }

            if (!msg.session_id) return
            const entry = this.sessions.get(msg.session_id)
            if (!entry) return

            if (msg.type === "pty:replay" && typeof msg.bytes === "number") {
                entry.on_replay({
                    bytes: msg.bytes,
                    reset: msg.reset !== false,
                    offset: typeof msg.offset === "number" ? msg.offset : undefined
                })
                return
            }

            if (msg.type === "pty:exit") {
                this.sessions.delete(msg.session_id)
                entry.on_exit({ code: msg.code ?? 0, signal: msg.signal ?? 0 })
                return
            }

            if (msg.type === "pty:error") {
                this.sessions.delete(msg.session_id)
                entry.on_error(new PtySessionError(msg.error || "PTY session failed"))
                return
            }

            if (msg.type === "pty:detached") {
                this.sessions.delete(msg.session_id)
                entry.on_detached(msg.reason || PTY_CALLER_REPLACED_REASON)
            }
        } catch {
            // Ignore malformed JSON
        }
    }

    private fail_pending_rpcs(err: Error): void {
        for (const [req_id, rpc] of this.pending_rpcs) {
            clearTimeout(rpc.timer)
            this.pending_rpcs.delete(req_id)
            rpc.reject(err)
        }
    }

    private release_if_idle(): void {
        if (this.keep_alive || this.leases > 0 || this.sessions.size > 0 || this.pending_rpcs.size > 0) {
            return
        }
        const client = this.client
        this.client = null
        this.status_received = false
        this.agent_online = false
        client?.close(1000, "PTY client idle")
    }
}

export interface PtyClientOptions {
    hub_url: string
    token: string
    session_id?: string
    offset?: number
    file?: string
    args?: string[]
    cwd?: string
    cols?: number
    rows?: number
    term?: string
    orphan_ttl_ms?: number
    persistent?: boolean
    signal?: AbortSignal
    transport?: PtyMuxClient
}

interface InternalPtyOpenOptions extends PtyClientOptions {
    survive_agent_offline?: boolean
    on_agent_offline?: () => void
    get_reattach_params?: () => { offset?: number; cols: number; rows: number }
}

export interface PtyExitStatus {
    code: number
    signal: number
}

export interface PtyReplayInfo {
    bytes: number
    reset: boolean
    offset?: number
}

export interface PtyClient {
    readonly session_id: string
    send(data: Uint8Array): void
    resize(cols: number, rows: number): void
    ping(): void
    on_data(callback: (data: Uint8Array) => void): void
    on_replay(callback: (info: PtyReplayInfo) => void): void
    detach(): void
    close(): void
    readonly ready: Promise<string>
    readonly exited: Promise<PtyExitStatus>
    readonly detached: Promise<void>
}

export type PtyConnectionStatus = "connecting" | "connected" | "detached" | "closed" | "exited" | "error"

export interface PtyStatusEvent {
    status: PtyConnectionStatus
    session_id: string | null
    attempt?: number
    error?: string
    exit_code?: number
}

export interface PtyConnection {
    readonly session_id: string | null
    readonly status: PtyConnectionStatus
    readonly replay_remaining: number
    send(data: Uint8Array): void
    resize(cols: number, rows: number): void
    resume(): void
    on_data(callback: (data: Uint8Array, replay_bytes: number) => void): () => void
    on_reset(callback: () => void): () => void
    on_status(callback: (event: PtyStatusEvent) => void): () => void
    detach(): void
    close(): void
    readonly ready: Promise<string>
    readonly exited: Promise<PtyExitStatus>
    readonly detached: Promise<void>
}

export async function open_pty_session(options: PtyClientOptions): Promise<PtyClient> {
    const internal = options as InternalPtyOpenOptions
    let data_handler: ((data: Uint8Array) => void) | null = null
    let replay_handler: ((info: PtyReplayInfo) => void) | null = null

    let resolve_exit!: (status: PtyExitStatus) => void
    let reject_exit!: (err: Error) => void
    let settled = false
    let lease_released = false
    const exited = new Promise<PtyExitStatus>((resolve, reject) => {
        resolve_exit = resolve
        reject_exit = reject
    })
    exited.catch(() => {})

    let resolve_detach!: () => void
    const detached = new Promise<void>((resolve) => {
        resolve_detach = resolve
    })

    const mux =
        options.transport ??
        new PtyMuxClient({
            hub_url: options.hub_url,
            token: options.token,
            keep_alive: false
        })

    const session_id = options.session_id || generate_session_id()

    const release_lease_once = () => {
        if (lease_released) return
        lease_released = true
        options.signal?.removeEventListener("abort", on_abort)
        mux.release_lease()
    }

    const finish = (result: PtyExitStatus | Error): void => {
        release_lease_once()
        if (settled) return
        settled = true
        if (result instanceof Error) reject_exit(result)
        else resolve_exit(result)
    }

    const on_abort = () => {
        if (!settled) {
            if (mux.unregister_session(session_id)) {
                mux.send_json({ type: "pty:detach", session_id })
            }
            resolve_detach()
            finish(new PtySocketClosed(1000, "PTY client aborted"))
        }
    }

    await mux.acquire_session_transport(options.signal)

    mux.register_session(session_id, {
        survive_agent_offline: Boolean(internal.survive_agent_offline),
        on_data: (data) => data_handler?.(data),
        on_replay: (info) => replay_handler?.(info),
        on_exit: (status) => finish(status),
        on_error: (err) => finish(err),
        on_detached: (reason) => finish(new PtySocketClosed(1000, reason)),
        on_transport_closed: (err) => finish(err),
        on_agent_offline: internal.on_agent_offline,
        get_reattach_params: internal.get_reattach_params
    })

    if (options.signal?.aborted) {
        on_abort()
        throw new PtySocketClosed(1000, "PTY connection aborted")
    }
    options.signal?.addEventListener("abort", on_abort, { once: true })

    if (options.session_id) {
        mux.send_json({
            type: "pty:attach",
            session_id,
            cols: options.cols && options.cols > 0 ? options.cols : 80,
            rows: options.rows && options.rows > 0 ? options.rows : 24,
            ...(typeof options.offset === "number" ? { offset: options.offset } : {})
        })
    } else {
        mux.send_json({
            type: "pty:open",
            session_id,
            file: options.file,
            args: options.args,
            cwd: options.cwd,
            cols: options.cols && options.cols > 0 ? options.cols : 80,
            rows: options.rows && options.rows > 0 ? options.rows : 24,
            term: options.term,
            orphan_ttl_ms: options.orphan_ttl_ms,
            persistent: options.persistent
        })
    }

    return {
        session_id,
        send(data: Uint8Array) {
            if (settled) return
            mux.send_binary(encode_pty_frame(session_id, data))
        },
        resize(cols: number, rows: number) {
            if (settled) return
            mux.send_json({ type: "pty:resize", session_id, cols, rows })
        },
        ping() {
            mux.ping()
        },
        on_data(callback) {
            data_handler = callback
        },
        on_replay(callback) {
            replay_handler = callback
        },
        detach() {
            if (settled) return
            if (mux.unregister_session(session_id)) {
                mux.send_json({ type: "pty:detach", session_id })
            }
            resolve_detach()
            finish(new PtySocketClosed(1000, "PTY client detached"))
        },
        close() {
            if (settled) return
            if (mux.unregister_session(session_id)) {
                mux.send_json({ type: "pty:close", session_id })
            }
            finish(new PtySocketClosed(1000, "PTY client closed"))
        },
        ready: Promise.resolve(session_id),
        exited,
        detached
    }
}

/**
 * Open a persistent PTY connection using Web Standard APIs that automatically
 * reconnects with byte-offset resume after unexpected transport drops once
 * the initial connection has succeeded.
 */
export function connect_pty_session(options: PtyClientOptions): PtyConnection {
    const data_listeners = new Set<(data: Uint8Array, replay_bytes: number) => void>()
    const reset_listeners = new Set<() => void>()
    const status_listeners = new Set<(event: PtyStatusEvent) => void>()

    let status: PtyConnectionStatus = "connecting"
    let active_session_id: string | undefined = options.session_id
    let current_client: PtyClient | null = null
    let has_connected = false
    let received_bytes: number | undefined = options.session_id ? options.offset : 0
    let replay_remaining = 0
    let current_cols = options.cols && options.cols > 0 ? options.cols : 80
    let current_rows = options.rows && options.rows > 0 ? options.rows : 24
    let is_reattaching = false

    let stop_reason: "detached" | "closed" | "finished" | null = null
    let reconnect_attempts = 0
    let attempt_abort: AbortController | null = null
    let backoff_abort: AbortController | null = null
    let wake_backoff: (() => void) | null = null

    let resolve_ready!: (session_id: string) => void
    let reject_ready!: (err: Error) => void
    let ready_settled = false
    const ready = new Promise<string>((resolve, reject) => {
        resolve_ready = resolve
        reject_ready = reject
    })
    ready.catch(() => {})

    let resolve_exit!: (result: PtyExitStatus) => void
    let reject_exit!: (err: Error) => void
    let exit_settled = false
    const exited = new Promise<PtyExitStatus>((resolve, reject) => {
        resolve_exit = resolve
        reject_exit = reject
    })
    exited.catch(() => {})

    let resolve_detach!: () => void
    let detach_settled = false
    const detached = new Promise<void>((resolve) => {
        resolve_detach = resolve
    })

    const emit_status = (next: PtyStatusEvent): void => {
        status = next.status
        for (const cb of status_listeners) {
            cb(next)
        }
    }

    const settle_ready_ok = (session_id: string): void => {
        if (ready_settled) return
        ready_settled = true
        resolve_ready(session_id)
    }

    const settle_ready_err = (err: Error): void => {
        if (ready_settled) return
        ready_settled = true
        reject_ready(err)
    }

    const settle_exit_ok = (result: PtyExitStatus): void => {
        if (exit_settled) return
        exit_settled = true
        resolve_exit(result)
    }

    const settle_exit_err = (err: Error): void => {
        if (exit_settled) return
        exit_settled = true
        reject_exit(err)
    }

    const wait_for_reconnect = (delay_ms: number): Promise<"retry" | "stop"> => {
        if (stop_reason !== null || options.signal?.aborted) return Promise.resolve("stop")
        return new Promise((resolve) => {
            const abort = new AbortController()
            backoff_abort = abort
            const timer = setTimeout(() => finish("retry"), delay_ms)
            const finish = (outcome: "retry" | "stop") => {
                clearTimeout(timer)
                abort.signal.removeEventListener("abort", on_abort)
                if (backoff_abort === abort) backoff_abort = null
                if (wake_backoff === wake) wake_backoff = null
                resolve(outcome)
            }
            const on_abort = () => finish("stop")
            const wake = () => finish("retry")
            wake_backoff = wake
            abort.signal.addEventListener("abort", on_abort, { once: true })
        })
    }

    const connection: PtyConnection = {
        get session_id() {
            return active_session_id ?? null
        },
        get status() {
            return status
        },
        get replay_remaining() {
            return replay_remaining
        },
        send(data: Uint8Array) {
            current_client?.send(data)
        },
        resize(cols: number, rows: number) {
            if (cols <= 0 || rows <= 0) return
            current_cols = cols
            current_rows = rows
            current_client?.resize(cols, rows)
        },
        resume() {
            if (stop_reason !== null) return
            if (wake_backoff) {
                reconnect_attempts = 0
                wake_backoff()
                return
            }
            current_client?.ping()
        },
        on_data(callback) {
            data_listeners.add(callback)
            return () => data_listeners.delete(callback)
        },
        on_reset(callback) {
            reset_listeners.add(callback)
            return () => reset_listeners.delete(callback)
        },
        on_status(callback) {
            status_listeners.add(callback)
            return () => status_listeners.delete(callback)
        },
        detach() {
            if (stop_reason !== null) return
            stop_reason = "detached"
            replay_remaining = 0
            cleanup_signal()
            backoff_abort?.abort()
            attempt_abort?.abort()
            const client = current_client
            current_client = null
            if (!detach_settled) {
                detach_settled = true
                resolve_detach()
            }
            settle_ready_err(new PtySocketClosed(1000, "PTY client detached"))
            emit_status({ status: "detached", session_id: active_session_id ?? null })
            client?.detach()
        },
        close() {
            if (stop_reason !== null) return
            stop_reason = "closed"
            replay_remaining = 0
            cleanup_signal()
            backoff_abort?.abort()
            attempt_abort?.abort()
            const client = current_client
            current_client = null
            const closed_err = new PtySocketClosed(1000, "PTY client closed")
            settle_ready_err(closed_err)
            settle_exit_err(closed_err)
            emit_status({ status: "closed", session_id: active_session_id ?? null })
            client?.close()
        },
        ready,
        exited,
        detached
    }

    const on_external_abort = () => connection.detach()
    const cleanup_signal = () => {
        options.signal?.removeEventListener("abort", on_external_abort)
    }
    options.signal?.addEventListener("abort", on_external_abort, { once: true })

    const fail_fatally = (err: unknown): void => {
        const formatted = format_pty_error(err)
        stop_reason = "finished"
        received_bytes = undefined
        replay_remaining = 0
        settle_ready_err(formatted)
        settle_exit_err(formatted)
        emit_status({ status: "error", session_id: active_session_id ?? null, error: formatted.message })
    }

    const run_loop = async (): Promise<void> => {
        try {
            while (stop_reason === null) {
                if (options.signal?.aborted) {
                    connection.detach()
                    return
                }

                const is_reconnect = has_connected
                if (is_reconnect) {
                    const action = await wait_for_reconnect(backoff_delay_ms(reconnect_attempts))
                    if (action === "stop" || stop_reason !== null) return
                }

                const attempt_cols = current_cols
                const attempt_rows = current_rows
                const attempt_ctrl = new AbortController()
                attempt_abort = attempt_ctrl

                let opened: PtyClient
                try {
                    const open_opts: InternalPtyOpenOptions = {
                        hub_url: options.hub_url,
                        token: options.token,
                        session_id: active_session_id,
                        offset: is_reconnect && active_session_id ? received_bytes : options.offset,
                        file: active_session_id ? undefined : options.file,
                        args: active_session_id ? undefined : options.args,
                        cwd: active_session_id ? undefined : options.cwd,
                        cols: attempt_cols,
                        rows: attempt_rows,
                        term: options.term,
                        orphan_ttl_ms: active_session_id ? undefined : options.orphan_ttl_ms,
                        persistent: active_session_id ? undefined : options.persistent,
                        signal: attempt_ctrl.signal,
                        transport: options.transport,
                        survive_agent_offline: true,
                        on_agent_offline: () => {
                            if (stop_reason !== null) return
                            is_reattaching = true
                            replay_remaining = 0
                            emit_status({
                                status: "connecting",
                                session_id: active_session_id ?? null,
                                attempt: 1
                            })
                        },
                        get_reattach_params: () => ({
                            offset: received_bytes,
                            cols: current_cols,
                            rows: current_rows
                        })
                    }
                    opened = await open_pty_session(open_opts)
                } catch (err) {
                    if (attempt_abort === attempt_ctrl) attempt_abort = null
                    if (stop_reason !== null) return
                    if (should_reconnect_pty(err, has_connected, active_session_id)) {
                        reconnect_attempts += 1
                        continue
                    }
                    fail_fatally(err)
                    return
                }

                if (attempt_abort === attempt_ctrl) attempt_abort = null
                if (stop_reason === "closed") {
                    opened.close()
                    return
                }
                if (stop_reason !== null) {
                    opened.detach()
                    return
                }

                current_client = opened
                active_session_id = opened.session_id
                if (!has_connected) {
                    has_connected = true
                    if (received_bytes === undefined && !options.session_id) {
                        received_bytes = 0
                    }
                }
                reconnect_attempts = 0
                replay_remaining = 0
                is_reattaching = false

                opened.on_replay((replay) => {
                    if (current_client !== opened) return
                    replay_remaining = replay.bytes > 0 ? replay.bytes : 0
                    if (typeof replay.offset === "number") {
                        received_bytes = replay.offset
                    } else if (replay.reset) {
                        received_bytes = undefined
                    }
                    if ((is_reconnect || is_reattaching) && replay.reset) {
                        for (const cb of reset_listeners) cb()
                    }
                    if (is_reattaching) {
                        is_reattaching = false
                        emit_status({ status: "connected", session_id: active_session_id ?? null })
                    }
                })

                opened.on_data((data) => {
                    if (current_client !== opened) return
                    if (received_bytes !== undefined) {
                        received_bytes += data.byteLength
                    }
                    let replay_bytes = 0
                    if (replay_remaining > 0) {
                        replay_bytes = Math.min(replay_remaining, data.byteLength)
                        replay_remaining -= replay_bytes
                    }
                    for (const cb of data_listeners) {
                        cb(data, replay_bytes)
                    }
                })

                if (current_cols !== attempt_cols || current_rows !== attempt_rows) {
                    opened.resize(current_cols, current_rows)
                }

                settle_ready_ok(active_session_id)
                emit_status({ status: "connected", session_id: active_session_id })

                try {
                    const exit_status = await opened.exited
                    if (current_client === opened) current_client = null
                    if (stop_reason !== null) return
                    stop_reason = "finished"
                    received_bytes = undefined
                    replay_remaining = 0
                    settle_exit_ok(exit_status)
                    emit_status({
                        status: "exited",
                        session_id: active_session_id ?? null,
                        exit_code: exit_status.code
                    })
                    return
                } catch (err) {
                    if (current_client === opened) current_client = null
                    if (stop_reason !== null) return
                    if (should_reconnect_pty(err, has_connected, active_session_id)) {
                        reconnect_attempts += 1
                        replay_remaining = 0
                        emit_status({
                            status: "connecting",
                            session_id: active_session_id ?? null,
                            attempt: reconnect_attempts
                        })
                        continue
                    }
                    fail_fatally(err)
                    return
                }
            }
        } finally {
            cleanup_signal()
        }
    }

    queueMicrotask(() => {
        if (stop_reason !== null) return
        if (options.signal?.aborted) {
            connection.detach()
            return
        }
        void run_loop()
    })

    return connection
}

function should_reconnect_pty(err: unknown, has_connected: boolean, session_id?: string): boolean {
    if (!has_connected || !session_id) return false
    if (err instanceof PtySessionError) return false
    if (pty_taken_by_another_caller(err)) return false
    if (pty_session_missing(err)) return false
    return true
}

function format_pty_error(err: unknown): Error {
    if (pty_taken_by_another_caller(err)) {
        return new Error("Session is open in another client")
    }
    return err instanceof Error ? err : new Error(String(err))
}

function backoff_delay_ms(attempt: number): number {
    return Math.min(PTY_RECONNECT_BASE_DELAY_MS * 1.5 ** Math.max(0, attempt - 1), PTY_RECONNECT_MAX_DELAY_MS)
}
