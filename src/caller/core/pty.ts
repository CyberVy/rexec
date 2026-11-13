import { HUB_ROUTES, PTY_CALLER_REPLACED_REASON } from "@/protocol"
import { decode_pty_frame, encode_pty_frame } from "@/transport/framing"
import { build_ws_url, WsClient } from "@/transport/ws"

export { PTY_CALLER_REPLACED_REASON }

const PTY_SESSION_MISSING = "PTY session not found or expired"

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

export async function open_pty_session(options: PtyClientOptions): Promise<PtyClient> {
    let data_handler: ((data: Uint8Array) => void) | null = null
    let replay_handler: ((info: PtyReplayInfo) => void) | null = null
    let resolve_ready!: (session_id: string) => void
    let reject_ready!: (err: Error) => void
    const ready = new Promise<string>((resolve, reject) => {
        resolve_ready = resolve
        reject_ready = reject
    })

    let resolve_exit!: (status: PtyExitStatus) => void
    let reject_exit!: (err: Error) => void
    let settled = false
    const exited = new Promise<PtyExitStatus>((resolve, reject) => {
        resolve_exit = resolve
        reject_exit = reject
    })
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
        ping_interval_ms: 20000,
        idle_timeout_ms: 0,
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
