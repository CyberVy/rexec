import { HUB_ROUTES, PTY_CALLER_REPLACED_REASON } from "@/protocol"
import { decode_pty_frame, encode_pty_frame } from "@/transport/framing"
import { build_ws_url, WsClient } from "@/transport/ws"

export { PTY_CALLER_REPLACED_REASON }

const PTY_SESSION_MISSING = "PTY session not found or expired"
const PTY_PING_INTERVAL_MS = 20_000
/** Three missed pongs, matching the forward tunnel heartbeat. Detects half-open connections instead of blackholing. */
const PTY_IDLE_TIMEOUT_MS = PTY_PING_INTERVAL_MS * 3
const PTY_RECONNECT_BASE_DELAY_MS = 1_000
const PTY_RECONNECT_MAX_DELAY_MS = 10_000

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
    let data_handler: ((data: Uint8Array) => void) | null = null
    let replay_handler: ((info: PtyReplayInfo) => void) | null = null
    let resolve_ready!: (session_id: string) => void
    let reject_ready!: (err: Error) => void
    const ready = new Promise<string>((resolve, reject) => {
        resolve_ready = resolve
        reject_ready = reject
    })
    ready.catch(() => {})

    let resolve_exit!: (status: PtyExitStatus) => void
    let reject_exit!: (err: Error) => void
    let settled = false
    const exited = new Promise<PtyExitStatus>((resolve, reject) => {
        resolve_exit = resolve
        reject_exit = reject
    })
    exited.catch(() => {})
    let resolve_detach!: () => void
    const detached = new Promise<void>((resolve) => {
        resolve_detach = resolve
    })

    const finish = (result: PtyExitStatus | Error): void => {
        if (settled) return
        settled = true
        if (result instanceof Error) reject_exit(result)
        else resolve_exit(result)
    }

    const base_url = build_ws_url(options.hub_url, HUB_ROUTES.WS_PTY.path, options.token)
    const ws_url = options.session_id ? `${base_url}&session_id=${encodeURIComponent(options.session_id)}` : base_url

    const client = new WsClient({
        url: ws_url,
        signal: options.signal,
        reconnect: false,
        reset_on_close: true,
        connect_timeout_ms: 10000,
        ping_interval_ms: PTY_PING_INTERVAL_MS,
        idle_timeout_ms: PTY_IDLE_TIMEOUT_MS,
        on_message(data) {
            try {
                const msg = JSON.parse(data) as {
                    type?: string
                    session_id?: string
                    code?: number
                    signal?: number
                    error?: string
                    bytes?: number
                    reset?: boolean
                    offset?: number
                }
                if (msg.type === "pty:ready" && msg.session_id) {
                    resolve_ready(msg.session_id)
                    return
                }
                if (msg.type === "pty:replay" && typeof msg.bytes === "number") {
                    replay_handler?.({
                        bytes: msg.bytes,
                        reset: msg.reset !== false,
                        offset: typeof msg.offset === "number" ? msg.offset : undefined
                    })
                    return
                }
                if (msg.type === "pty:exit") {
                    finish({ code: msg.code ?? 0, signal: msg.signal ?? 0 })
                    return
                }
                if (msg.type === "pty:error") {
                    finish(new PtySessionError(msg.error || "PTY session failed"))
                }
            } catch {
                // Ignore malformed JSON
            }
        },
        on_binary(bytes) {
            const decoded = decode_pty_frame(bytes)
            if (decoded) data_handler?.(decoded.payload)
        },
        on_close(event) {
            const err = new PtySocketClosed(event.code, event.reason || "")
            reject_ready(err)
            finish(err)
        },
        on_dead(reason) {
            const err = new Error(reason || "PTY connection closed")
            reject_ready(err)
            finish(err)
        }
    })

    try {
        await client.connect()
        let ready_timer: ReturnType<typeof setTimeout> | undefined
        const ready_timeout = new Promise<string>((_, reject) => {
            ready_timer = setTimeout(() => reject(new Error("Timed out waiting for the PTY session")), 10000)
        })
        ready_timeout.catch(() => {})
        let session_id: string
        try {
            session_id = await Promise.race([ready, ready_timeout])
        } finally {
            clearTimeout(ready_timer)
        }

        if (options.session_id) {
            client.send_json({
                type: "pty:attach",
                session_id,
                cols: options.cols && options.cols > 0 ? options.cols : 80,
                rows: options.rows && options.rows > 0 ? options.rows : 24,
                ...(typeof options.offset === "number" ? { offset: options.offset } : {})
            })
        } else {
            client.send_json({
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
                client.send_binary(encode_pty_frame(session_id, data))
            },
            resize(cols: number, rows: number) {
                client.send_json({ type: "pty:resize", session_id, cols, rows })
            },
            ping() {
                client.ping()
            },
            on_data(callback) {
                data_handler = callback
            },
            on_replay(callback) {
                replay_handler = callback
            },
            detach() {
                resolve_detach()
                client.close(1000, "PTY client detached")
            },
            close() {
                try {
                    client.send_json({ type: "pty:close", session_id })
                } catch {
                    // Ignore send error
                }
                client.close(1000, "PTY client closed")
            },
            exited,
            detached
        }
    } catch (err) {
        client.close(1000, "PTY client closed")
        throw err
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
                    opened = await open_pty_session({
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
                        signal: attempt_ctrl.signal
                    })
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

                opened.on_replay((replay) => {
                    if (current_client !== opened) return
                    replay_remaining = replay.bytes > 0 ? replay.bytes : 0
                    if (typeof replay.offset === "number") {
                        received_bytes = replay.offset
                    } else if (replay.reset) {
                        received_bytes = undefined
                    }
                    if (is_reconnect && replay.reset) {
                        for (const cb of reset_listeners) cb()
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
