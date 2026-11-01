import { HUB_ROUTES } from "@/protocol"
import { decode_pty_frame, encode_pty_frame } from "@/transport/framing"
import { build_ws_url, WsClient } from "@/transport/ws"

export interface PtyClientOptions {
    hub_url: string
    token: string
    session_id?: string
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

export interface PtyClient {
    readonly session_id: string
    send(data: Uint8Array): void
    resize(cols: number, rows: number): void
    on_data(callback: (data: Uint8Array) => void): void
    detach(): void
    close(): void
    readonly exited: Promise<PtyExitStatus>
}

export async function open_pty_session(options: PtyClientOptions): Promise<PtyClient> {
    let data_handler: ((data: Uint8Array) => void) | null = null
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
                }
                if (msg.type === "pty:ready" && msg.session_id) {
                    resolve_ready(msg.session_id)
                    return
                }
                if (msg.type === "pty:exit") {
                    finish({ code: msg.code ?? 0, signal: msg.signal ?? 0 })
                    return
                }
                if (msg.type === "pty:error") {
                    finish(new Error(msg.error || "PTY session failed"))
                }
            } catch {
                // Ignore malformed JSON
            }
        },
        on_binary(bytes) {
            const decoded = decode_pty_frame(bytes)
            if (decoded) data_handler?.(decoded.payload)
        },
        on_close() {
            const err = new Error("PTY session closed")
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
                rows: options.rows && options.rows > 0 ? options.rows : 24
            })
        } else {
            client.send_json({
                type: "pty:open",
                session_id,
                file: options.file || "/bin/bash",
                args: options.args ?? [],
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
            on_data(callback) {
                data_handler = callback
            },
            detach() {
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
            exited
        }
    } catch (err) {
        client.close(1000, "PTY client closed")
        throw err
    }
}
