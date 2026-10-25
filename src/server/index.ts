import { DurableObject } from "cloudflare:workers"
import {
    TRANSFER_ID_BYTES,
    type AgentToHubMessage,
    type ExecRequestPayload,
    type FileMetadata,
    type HubToAgentMessage,
    type TaskExecMessage
} from "@/protocol"

export interface Env {
    REXEC_HUB: DurableObjectNamespace
}

interface ActiveTask {
    token: string
    writer: WritableStreamDefaultWriter<Uint8Array>
    timeout_id?: ReturnType<typeof setTimeout>
    encoder: TextEncoder
    write_queue: Promise<void>
}

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

interface AgentSession {
    token: string
    node_id: string
    hostname?: string
    ws: WebSocket
    connected_at: number
}

function get_cors_headers(request?: Request): Record<string, string> {
    const origin = request?.headers.get("Origin")
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept",
        "Access-Control-Max-Age": "86400"
    }
}

function extract_token(request: Request, url: URL): string | null {
    const query_token = url.searchParams.get("token")
    const auth_header = request.headers.get("Authorization")
    let bearer_token: string | null = null
    if (auth_header) {
        bearer_token = auth_header.replace(/^Bearer\s+/i, "")
    }
    const token = query_token?.trim() || bearer_token?.trim()
    return token || null
}

export class RexecHub extends DurableObject {
    private agents: Map<string, AgentSession> = new Map()
    private active_tasks: Map<string, ActiveTask> = new Map()
    private active_pulls: Map<string, ActivePull> = new Map()
    private active_pushes: Map<string, ActivePush> = new Map()

    constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
        super(ctx, env)
    }

    override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === "/health" || url.pathname === "/api/health") {
            const token = extract_token(request, url)
            const headers = get_cors_headers(request)
            if (token) {
                const session = this.agents.get(token)
                const is_connected = session !== undefined && session.ws.readyState === WebSocket.OPEN
                let tasks_for_token = 0
                for (const [, task] of this.active_tasks) {
                    if (task.token === token) tasks_for_token++
                }
                return Response.json(
                    {
                        status: "ok",
                        agent_connected: is_connected,
                        node_id: session?.node_id,
                        active_tasks: tasks_for_token
                    },
                    { headers }
                )
            }

            return Response.json(
                {
                    status: "ok",
                    agent_connected: this.agents.size > 0,
                    connected_agents: this.agents.size,
                    active_tasks: this.active_tasks.size
                },
                { headers }
            )
        }

        if (url.pathname === "/ws" || url.pathname === "/ws/agent") {
            return this.handle_agent_ws(request, url)
        }

        if (url.pathname === "/exec" || url.pathname === "/api/exec") {
            if (request.method !== "POST") {
                return new Response("Method Not Allowed", { status: 405, headers: get_cors_headers(request) })
            }
            return this.handle_exec_request(request, url)
        }

        if (url.pathname === "/file/pull" || url.pathname === "/api/file/pull") {
            return this.handle_pull_request(request, url)
        }

        if (url.pathname === "/file/push" || url.pathname === "/api/file/push") {
            return this.handle_push_request(request, url)
        }

        return new Response("Not Found", { status: 404, headers: get_cors_headers(request) })
    }

    private handle_agent_ws(request: Request, url: URL): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426, headers: get_cors_headers(request) })
        }

        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401, headers: get_cors_headers(request) })
        }

        const node_id = url.searchParams.get("node_id") || "unknown-node"

        const existing_session = this.agents.get(token)
        if (existing_session && existing_session.ws.readyState === WebSocket.OPEN) {
            const web_socket_pair = new WebSocketPair()
            const [client, server] = Object.values(web_socket_pair)
            server.accept()
            const reason = `Token '${token}' is already in use by active node '${existing_session.node_id}'. Connection rejected.`
            try {
                server.close(4409, reason)
            } catch {
                // Ignore close error
            }
            return new Response(null, { status: 101, webSocket: client })
        }

        const web_socket_pair = new WebSocketPair()
        const [client, server] = Object.values(web_socket_pair)

        server.accept()

        const session: AgentSession = {
            token,
            node_id,
            ws: server,
            connected_at: Date.now()
        }
        this.agents.set(token, session)

        server.addEventListener("message", async (event) => {
            if (typeof event.data === "string") {
                this.handle_agent_message(session, event.data)
            } else if (event.data instanceof ArrayBuffer) {
                this.handle_agent_binary(session, new Uint8Array(event.data))
            } else if (ArrayBuffer.isView(event.data)) {
                this.handle_agent_binary(
                    session,
                    new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
                )
            } else if (event.data && typeof (event.data as Blob).arrayBuffer === "function") {
                const ab = await (event.data as Blob).arrayBuffer()
                this.handle_agent_binary(session, new Uint8Array(ab))
            }
        })

        server.addEventListener("close", () => {
            const current = this.agents.get(token)
            if (current && current.ws === server) {
                this.agents.delete(token)
                this.abort_tasks_for_token(token, "Agent disconnected unexpectedly")
                this.abort_transfers_for_token(token, "Agent disconnected unexpectedly")
            }
        })

        server.addEventListener("error", () => {
            const current = this.agents.get(token)
            if (current && current.ws === server) {
                this.agents.delete(token)
                this.abort_tasks_for_token(token, "Agent connection error")
                this.abort_transfers_for_token(token, "Agent connection error")
            }
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    private handle_agent_message(session: AgentSession, data: string): void {
        try {
            const msg = JSON.parse(data) as AgentToHubMessage
            if (msg.type === "chunk" || msg.type === "task:chunk") {
                const task = this.active_tasks.get(msg.task_id)
                if (task && task.token === session.token) {
                    const payload = JSON.stringify({ stream: msg.stream, data: msg.data })
                    this.write_to_task(task, `event: chunk\ndata: ${payload}\n\n`)
                }
            } else if (msg.type === "exit" || msg.type === "task:exit") {
                const task = this.active_tasks.get(msg.task_id)
                if (task && task.token === session.token) {
                    if (task.timeout_id) clearTimeout(task.timeout_id)
                    const payload = JSON.stringify({ code: msg.code, signal: msg.signal })
                    task.write_queue = task.write_queue
                        .then(() => task.writer.write(task.encoder.encode(`event: exit\ndata: ${payload}\n\n`)))
                        .then(() => task.writer.close())
                        .catch(() => {})
                    this.active_tasks.delete(msg.task_id)
                }
            } else if (msg.type === "file:pull_meta") {
                const pull = this.active_pulls.get(msg.transfer_id)
                if (pull && pull.token === session.token) {
                    pull.meta_received = true
                    pull.resolve_meta(msg.meta)
                }
            } else if (msg.type === "file:pull_end") {
                const pull = this.active_pulls.get(msg.transfer_id)
                if (pull && pull.token === session.token) {
                    if (pull.timeout_id) clearTimeout(pull.timeout_id)
                    pull.write_queue.then(() => pull.writer.close()).catch(() => {})
                    this.active_pulls.delete(msg.transfer_id)
                }
            } else if (msg.type === "file:push_end") {
                const push = this.active_pushes.get(msg.transfer_id)
                if (push && push.token === session.token) {
                    if (push.timeout_id) clearTimeout(push.timeout_id)
                    push.resolve_push({ sha256: msg.sha256 })
                    this.active_pushes.delete(msg.transfer_id)
                }
            } else if (msg.type === "transfer:error") {
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
            } else if (msg.type === "register") {
                if (msg.hostname) session.hostname = msg.hostname
                if (msg.node_id) session.node_id = msg.node_id
            } else if (msg.type === "ping") {
                this.send_to_agent(session, { type: "pong" })
            }
        } catch {
            // Ignore malformed message
        }
    }

    private handle_agent_binary(session: AgentSession, bytes: Uint8Array): void {
        if (bytes.length < TRANSFER_ID_BYTES) return
        const id_bytes = bytes.subarray(0, TRANSFER_ID_BYTES)
        const transfer_id = new TextDecoder().decode(id_bytes)
        const raw_payload = bytes.subarray(TRANSFER_ID_BYTES)

        const pull = this.active_pulls.get(transfer_id)
        if (pull && pull.token === session.token) {
            pull.write_queue = pull.write_queue.then(() => pull.writer.write(raw_payload)).catch(() => {})
        }
    }

    private async handle_exec_request(request: Request, url: URL): Promise<Response> {
        const headers = get_cors_headers(request)
        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401, headers })
        }

        const session = this.agents.get(token)
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            return Response.json(
                { error: "No agent connected for this token. Please start rexec-agent first." },
                { status: 503, headers }
            )
        }

        let body: ExecRequestPayload
        try {
            body = (await request.json()) as ExecRequestPayload
        } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400, headers })
        }

        if (!body.cmd) {
            return Response.json({ error: "Missing 'cmd' in request body" }, { status: 400, headers })
        }

        const task_id = crypto.randomUUID()
        const timeout_ms = body.timeout_ms || 300000

        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        const timeout_id = setTimeout(() => {
            const task = this.active_tasks.get(task_id)
            if (task) {
                const payload = JSON.stringify({ message: `Command timed out after ${timeout_ms}ms` })
                task.writer
                    .write(task.encoder.encode(`event: error\ndata: ${payload}\n\n`))
                    .then(() => task.writer.close())
                    .catch(() => {})
                this.send_to_agent(session, { type: "task:kill", task_id, signal: "SIGTERM" })
                this.active_tasks.delete(task_id)
            }
        }, timeout_ms)

        this.active_tasks.set(task_id, {
            token,
            writer,
            timeout_id,
            encoder,
            write_queue: Promise.resolve()
        })

        request.signal.addEventListener("abort", () => {
            const task = this.active_tasks.get(task_id)
            if (task) {
                if (task.timeout_id) clearTimeout(task.timeout_id)
                this.send_to_agent(session, { type: "task:kill", task_id, signal: "SIGINT" })
                task.writer.close().catch(() => {})
                this.active_tasks.delete(task_id)
            }
        })

        const exec_msg: TaskExecMessage = {
            type: "task:exec",
            task_id,
            cmd: body.cmd,
            cwd: body.cwd,
            env: body.env
        }
        this.send_to_agent(session, exec_msg)

        return new Response(readable, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                ...headers
            }
        })
    }

    private async handle_pull_request(request: Request, url: URL): Promise<Response> {
        const headers = get_cors_headers(request)
        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401, headers })
        }

        const session = this.agents.get(token)
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            return Response.json(
                { error: "No agent connected for this token. Please start rexec-agent first." },
                { status: 503, headers }
            )
        }

        const file_path = url.searchParams.get("path")
        if (!file_path) {
            return Response.json({ error: "Missing 'path' query parameter" }, { status: 400, headers })
        }

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
                this.send_to_agent(session, { type: "transfer:error", transfer_id, error: "Client aborted request" })
                pull.writer.abort(new Error("Client aborted")).catch(() => {})
                this.active_pulls.delete(transfer_id)
            }
        })

        this.send_to_agent(session, {
            type: "file:pull_start",
            transfer_id,
            path: file_path
        })

        try {
            const meta = await meta_promise
            return new Response(readable, {
                status: 200,
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": String(meta.size),
                    "X-File-Path": encodeURIComponent(meta.path),
                    "X-File-Size": String(meta.size),
                    ...headers
                }
            })
        } catch (err) {
            clearTimeout(timeout_id)
            this.active_pulls.delete(transfer_id)
            return Response.json({ error: (err as Error).message }, { status: 404, headers })
        }
    }

    private async handle_push_request(request: Request, url: URL): Promise<Response> {
        const headers = get_cors_headers(request)
        if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers })
        }

        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401, headers })
        }

        const session = this.agents.get(token)
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            return Response.json(
                { error: "No agent connected for this token. Please start rexec-agent first." },
                { status: 503, headers }
            )
        }

        const file_path = url.searchParams.get("path")
        if (!file_path) {
            return Response.json({ error: "Missing 'path' query parameter" }, { status: 400, headers })
        }

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

        this.send_to_agent(session, {
            type: "file:push_start",
            transfer_id,
            path: file_path,
            size
        })

        const reader = request.body.getReader()
        const id_header = new TextEncoder().encode(transfer_id)

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const packet = new Uint8Array(id_header.length + value.length)
                packet.set(id_header, 0)
                packet.set(value, id_header.length)
                session.ws.send(packet)
            }

            this.send_to_agent(session, {
                type: "file:push_end",
                transfer_id
            })

            const result = await push_promise
            return Response.json({ status: "ok", size, sha256: result.sha256 }, { headers })
        } catch (err) {
            clearTimeout(timeout_id)
            this.active_pushes.delete(transfer_id)
            this.send_to_agent(session, {
                type: "transfer:error",
                transfer_id,
                error: (err as Error).message
            })
            return Response.json({ error: (err as Error).message }, { status: 500, headers })
        }
    }

    private write_to_task(task: ActiveTask, text: string): void {
        task.write_queue = task.write_queue.then(() => task.writer.write(task.encoder.encode(text))).catch(() => {})
    }

    private send_to_agent(session: AgentSession, msg: HubToAgentMessage): void {
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify(msg))
        }
    }

    private abort_tasks_for_token(token: string, reason: string): void {
        for (const [task_id, task] of this.active_tasks) {
            if (task.token === token) {
                if (task.timeout_id) clearTimeout(task.timeout_id)
                const payload = JSON.stringify({ message: reason })
                task.writer
                    .write(task.encoder.encode(`event: error\ndata: ${payload}\n\n`))
                    .then(() => task.writer.close())
                    .catch(() => {})
                this.active_tasks.delete(task_id)
            }
        }
    }

    private abort_transfers_for_token(token: string, reason: string): void {
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

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: get_cors_headers(request)
            })
        }

        const url = new URL(request.url)

        // Intercept unauthenticated agent registrations before reaching Durable Object
        if (url.pathname === "/ws" || url.pathname === "/ws/agent") {
            const token = extract_token(request, url)
            if (!token) {
                return new Response("Missing authorization token for agent registration", {
                    status: 401,
                    headers: get_cors_headers(request)
                })
            }
        }

        // Intercept unauthenticated exec or file transfer requests before reaching Durable Object
        if (
            url.pathname === "/exec" ||
            url.pathname === "/api/exec" ||
            url.pathname === "/file/pull" ||
            url.pathname === "/api/file/pull" ||
            url.pathname === "/file/push" ||
            url.pathname === "/api/file/push"
        ) {
            const token = extract_token(request, url)
            if (!token) {
                return new Response("Missing authorization token", {
                    status: 401,
                    headers: get_cors_headers(request)
                })
            }
        }

        const id = env.REXEC_HUB.idFromName("default")
        const stub = env.REXEC_HUB.get(id)
        return stub.fetch(request)
    }
}
