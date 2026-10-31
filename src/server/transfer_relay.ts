import type {
    FileMetadata,
    FilePullEndMessage,
    FilePullMetaMessage,
    FilePushEndMessage,
    HubToAgentMessage,
    TransferErrorMessage
} from "@/protocol"
import { TRANSFER_ID_BYTES, decode_transfer_frame, encode_transfer_frame } from "@/transport"
import type { AgentSession } from "./types"
import { accepted_token, get_cors_headers } from "./utils"

interface ActivePull {
    token: string
    writer: WritableStreamDefaultWriter<Uint8Array>
    resolve_meta: (meta: FileMetadata) => void
    reject_meta: (err: Error) => void
    meta_received: boolean
    timeout_id?: ReturnType<typeof setTimeout>
    write_queue: Promise<void>
}

interface ActivePush {
    token: string
    resolve_push: (result: { sha256?: string }) => void
    reject_push: (err: Error) => void
    timeout_id?: ReturnType<typeof setTimeout>
}

export class TransferRelay {
    private active_pulls: Map<string, ActivePull> = new Map()
    private active_pushes: Map<string, ActivePush> = new Map()

    public constructor(
        private readonly send: (session: AgentSession, msg: HubToAgentMessage) => void,
        private readonly get_open_agent: (token: string) => AgentSession | undefined
    ) {}

    public on_agent_message(
        session: AgentSession,
        msg: FilePullMetaMessage | FilePullEndMessage | FilePushEndMessage | TransferErrorMessage
    ): void {
        if (msg.type === "file:pull_meta") {
            const pull = this.active_pulls.get(msg.transfer_id)
            if (pull && pull.token === session.token) {
                pull.meta_received = true
                pull.resolve_meta(msg.meta)
            }
            return
        }

        if (msg.type === "file:pull_end") {
            const pull = this.active_pulls.get(msg.transfer_id)
            if (pull && pull.token === session.token) {
                if (pull.timeout_id) clearTimeout(pull.timeout_id)
                pull.write_queue.then(() => pull.writer.close()).catch(() => {})
                this.active_pulls.delete(msg.transfer_id)
            }
            return
        }

        if (msg.type === "file:push_end") {
            const push = this.active_pushes.get(msg.transfer_id)
            if (push && push.token === session.token) {
                if (push.timeout_id) clearTimeout(push.timeout_id)
                push.resolve_push({ sha256: msg.sha256 })
                this.active_pushes.delete(msg.transfer_id)
            }
            return
        }

        const pull = this.active_pulls.get(msg.transfer_id)
        if (pull && pull.token === session.token) {
            if (pull.timeout_id) clearTimeout(pull.timeout_id)
            if (!pull.meta_received) {
                pull.reject_meta(new Error(msg.error))
            } else {
                pull.writer.abort(new Error(msg.error)).catch(() => {})
            }
            this.active_pulls.delete(msg.transfer_id)
        }
        const push = this.active_pushes.get(msg.transfer_id)
        if (push && push.token === session.token) {
            if (push.timeout_id) clearTimeout(push.timeout_id)
            push.reject_push(new Error(msg.error))
            this.active_pushes.delete(msg.transfer_id)
        }
    }

    public relay_agent_binary(session: AgentSession, bytes: Uint8Array): void {
        const decoded = decode_transfer_frame(bytes)
        if (!decoded) return

        const pull = this.active_pulls.get(decoded.transfer_id)
        if (pull && pull.token === session.token) {
            pull.write_queue = pull.write_queue.then(() => pull.writer.write(decoded.payload)).catch(() => {})
        }
    }

    public async handle_pull_request(request: Request, url: URL): Promise<Response> {
        const headers = get_cors_headers(request)
        const token = accepted_token(request, url)
        const session = this.get_open_agent(token)
        if (!session) {
            return Response.json(
                { error: "No agent connected for this token. Please start rexec-agent first." },
                { status: 503, headers }
            )
        }

        const file_path = url.searchParams.get("path")
        if (!file_path) {
            return Response.json({ error: "Missing 'path' query parameter" }, { status: 400, headers })
        }

        const recursive = url.searchParams.get("recursive") === "1" || url.searchParams.get("recursive") === "true"

        const transfer_id = crypto.randomUUID().replace(/-/g, "").slice(0, TRANSFER_ID_BYTES)
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
        const writer = writable.getWriter()

        let resolve_meta!: (meta: FileMetadata) => void
        let reject_meta!: (err: Error) => void
        const meta_promise = new Promise<FileMetadata>((res, rej) => {
            resolve_meta = res
            reject_meta = rej
        })

        const timeout_id = setTimeout(() => {
            const pull = this.active_pulls.get(transfer_id)
            if (pull) {
                if (!pull.meta_received) {
                    pull.reject_meta(new Error("Pull request timed out waiting for agent"))
                } else {
                    pull.writer.abort(new Error("Pull stream timed out")).catch(() => {})
                }
                this.active_pulls.delete(transfer_id)
            }
        }, 300000)

        this.active_pulls.set(transfer_id, {
            token,
            writer,
            resolve_meta,
            reject_meta,
            meta_received: false,
            timeout_id,
            write_queue: Promise.resolve()
        })

        request.signal.addEventListener("abort", () => {
            const pull = this.active_pulls.get(transfer_id)
            if (pull) {
                if (pull.timeout_id) clearTimeout(pull.timeout_id)
                this.send(session, { type: "transfer:error", transfer_id, error: "Client aborted request" })
                pull.writer.abort(new Error("Client aborted")).catch(() => {})
                this.active_pulls.delete(transfer_id)
            }
        })

        this.send(session, {
            type: "file:pull_start",
            transfer_id,
            path: file_path,
            recursive
        })

        try {
            const meta = await meta_promise
            const resp_headers: Record<string, string> = {
                "Content-Type": "application/octet-stream",
                "X-File-Path": encodeURIComponent(meta.path),
                ...headers
            }
            if (meta.is_directory) {
                resp_headers["X-Is-Directory"] = "1"
            } else {
                resp_headers["Content-Length"] = String(meta.size)
                resp_headers["X-File-Size"] = String(meta.size)
            }
            return new Response(readable, {
                status: 200,
                headers: resp_headers
            })
        } catch (err) {
            clearTimeout(timeout_id)
            this.active_pulls.delete(transfer_id)
            return Response.json({ error: (err as Error).message }, { status: 404, headers })
        }
    }

    public async handle_push_request(request: Request, url: URL): Promise<Response> {
        const headers = get_cors_headers(request)
        if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers })
        }

        const token = accepted_token(request, url)
        const session = this.get_open_agent(token)
        if (!session) {
            return Response.json(
                { error: "No agent connected for this token. Please start rexec-agent first." },
                { status: 503, headers }
            )
        }

        const file_path = url.searchParams.get("path")
        if (!file_path) {
            return Response.json({ error: "Missing 'path' query parameter" }, { status: 400, headers })
        }

        const recursive = url.searchParams.get("recursive") === "1" || url.searchParams.get("recursive") === "true"

        if (!request.body) {
            return Response.json({ error: "Missing request body" }, { status: 400, headers })
        }

        const size = Number(request.headers.get("Content-Length") || url.searchParams.get("size") || 0)
        const transfer_id = crypto.randomUUID().replace(/-/g, "").slice(0, TRANSFER_ID_BYTES)

        let resolve_push!: (result: { sha256?: string }) => void
        let reject_push!: (err: Error) => void
        const push_promise = new Promise<{ sha256?: string }>((res, rej) => {
            resolve_push = res
            reject_push = rej
        })

        const timeout_id = setTimeout(() => {
            const push = this.active_pushes.get(transfer_id)
            if (push) {
                push.reject_push(new Error("Push request timed out"))
                this.active_pushes.delete(transfer_id)
            }
        }, 600000)

        this.active_pushes.set(transfer_id, {
            token,
            resolve_push,
            reject_push,
            timeout_id
        })

        this.send(session, {
            type: "file:push_start",
            transfer_id,
            path: file_path,
            size,
            recursive
        })

        const reader = request.body.getReader()

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const packet = encode_transfer_frame(transfer_id, value)
                session.ws.send(packet)
            }

            this.send(session, {
                type: "file:push_end",
                transfer_id
            })

            const result = await push_promise
            return Response.json({ status: "ok", size, sha256: result.sha256 }, { headers })
        } catch (err) {
            clearTimeout(timeout_id)
            this.active_pushes.delete(transfer_id)
            this.send(session, {
                type: "transfer:error",
                transfer_id,
                error: (err as Error).message
            })
            return Response.json({ error: (err as Error).message }, { status: 500, headers })
        }
    }

    public stop_on_agent(session: AgentSession): void {
        for (const [transfer_id, pull] of this.active_pulls) {
            if (pull.token === session.token) {
                this.send(session, { type: "transfer:error", transfer_id, error: "Agent session ended" })
            }
        }
        for (const [transfer_id, push] of this.active_pushes) {
            if (push.token === session.token) {
                this.send(session, { type: "transfer:error", transfer_id, error: "Agent session ended" })
            }
        }
    }

    public abort_for_token(token: string, reason: string): void {
        for (const [id, pull] of this.active_pulls) {
            if (pull.token === token) {
                if (pull.timeout_id) clearTimeout(pull.timeout_id)
                if (!pull.meta_received) {
                    pull.reject_meta(new Error(reason))
                } else {
                    pull.writer.abort(new Error(reason)).catch(() => {})
                }
                this.active_pulls.delete(id)
            }
        }
        for (const [id, push] of this.active_pushes) {
            if (push.token === token) {
                if (push.timeout_id) clearTimeout(push.timeout_id)
                push.reject_push(new Error(reason))
                this.active_pushes.delete(id)
            }
        }
    }
}
