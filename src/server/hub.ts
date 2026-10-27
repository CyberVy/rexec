import { DurableObject } from "cloudflare:workers"
import {
    type AgentToHubMessage,
    type ExecRequestPayload,
    type FileMetadata,
    type HubToAgentMessage,
    type TaskExecMessage
} from "@/protocol"
import {
    ChannelDomain,
    TRANSFER_ID_BYTES,
    decode_transfer_frame,
    encode_transfer_frame,
    extract_forward_session_id
} from "@/transport"
import type { ActiveForwardSession, ActivePull, ActivePush, ActiveTask, AgentSession } from "./types"
import { extract_token, get_cors_headers } from "./utils"

export class RexecHub extends DurableObject {
    private agents: Map<string, AgentSession> = new Map()
    private active_tasks: Map<string, ActiveTask> = new Map()
    private active_pulls: Map<string, ActivePull> = new Map()
    private active_pushes: Map<string, ActivePush> = new Map()
    private active_forwards: Map<string, ActiveForwardSession> = new Map()

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

        if (url.pathname === "/ws/forward" || url.pathname === "/api/ws/forward") {
            return this.handle_forward_ws(request, url)
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
            try {
                existing_session.ws.close(1000, "Replaced by new connection")
            } catch {
                // Ignore close error
            }
            this.cleanup_agent_session(token, existing_session.ws, "Agent replaced by new connection")
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
            this.cleanup_agent_session(token, server, "Agent disconnected unexpectedly")
        })

        server.addEventListener("error", () => {
            this.cleanup_agent_session(token, server, "Agent connection error")
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    private cleanup_agent_session(token: string, ws: WebSocket, reason: string): void {
        const current = this.agents.get(token)
        if (current && current.ws === ws) {
            this.agents.delete(token)
            this.abort_tasks_for_token(token, reason)
            this.abort_transfers_for_token(token, reason)
            this.abort_forwards_for_token(token, reason)
        }
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
            } else if (msg.type === "forward:close" || msg.type === "forward:error") {
                const forward = this.active_forwards.get(msg.session_id)
                if (forward && forward.token === session.token && forward.caller_ws.readyState === WebSocket.OPEN) {
                    forward.caller_ws.send(JSON.stringify(msg))
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
        if (bytes.length === 0) return

        if (bytes[0] === ChannelDomain.FORWARD) {
            const session_id = extract_forward_session_id(bytes)
            if (session_id) {
                const forward = this.active_forwards.get(session_id)
                if (forward && forward.token === session.token && forward.caller_ws.readyState === WebSocket.OPEN) {
                    forward.caller_ws.send(bytes)
                }
            }
            return
        }

        const decoded = decode_transfer_frame(bytes)
        if (!decoded) return

        const pull = this.active_pulls.get(decoded.transfer_id)
        if (pull && pull.token === session.token) {
            pull.write_queue = pull.write_queue.then(() => pull.writer.write(decoded.payload)).catch(() => {})
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
                this.send_to_agent(session, { type: "transfer:error", transfer_id, error: "Client aborted request" })
                pull.writer.abort(new Error("Client aborted")).catch(() => {})
                this.active_pulls.delete(transfer_id)
            }
        })

        this.send_to_agent(session, {
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

        this.send_to_agent(session, {
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

    private handle_forward_ws(request: Request, url: URL): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426, headers: get_cors_headers(request) })
        }

        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401, headers: get_cors_headers(request) })
        }

        const session = this.agents.get(token)
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            return new Response("No agent connected for this token", {
                status: 503,
                headers: get_cors_headers(request)
            })
        }

        const remote_port = Number(url.searchParams.get("remote_port") || url.searchParams.get("port") || 0)
        if (!remote_port) {
            return new Response("Missing or invalid 'remote_port' query parameter", {
                status: 400,
                headers: get_cors_headers(request)
            })
        }

        const session_id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
        const web_socket_pair = new WebSocketPair()
        const [client, server] = Object.values(web_socket_pair)
        server.accept()

        const forward_session: ActiveForwardSession = {
            session_id,
            token,
            caller_ws: server,
            agent_ws: session.ws,
            remote_port
        }
        this.active_forwards.set(session_id, forward_session)

        // Notify caller of session readiness and assigned session_id
        server.send(JSON.stringify({ type: "forward:ready", session_id, remote_port }))

        server.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
                try {
                    const msg = JSON.parse(event.data) as Record<string, unknown>
                    if (msg.type === "ping") {
                        server.send(JSON.stringify({ type: "pong" }))
                        return
                    }
                    msg.session_id = session_id
                    if (msg.type === "forward:open" && !msg.remote_port) {
                        msg.remote_port = remote_port
                    }
                    if (session.ws.readyState === WebSocket.OPEN) {
                        session.ws.send(JSON.stringify(msg))
                    }
                } catch {
                    // Ignore malformed message
                }
            } else {
                // Binary forward frame from caller -> forward directly to agent
                let bytes: Uint8Array
                if (event.data instanceof ArrayBuffer) {
                    bytes = new Uint8Array(event.data)
                } else if (ArrayBuffer.isView(event.data)) {
                    bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
                } else {
                    return
                }
                if (session.ws.readyState === WebSocket.OPEN) {
                    session.ws.send(bytes)
                }
            }
        })

        const cleanup = () => {
            const current = this.active_forwards.get(session_id)
            if (current && current.caller_ws === server) {
                this.active_forwards.delete(session_id)
                if (session.ws.readyState === WebSocket.OPEN) {
                    this.send_to_agent(session, { type: "forward:session_end", session_id })
                }
            }
        }

        server.addEventListener("close", cleanup)
        server.addEventListener("error", cleanup)

        return new Response(null, { status: 101, webSocket: client })
    }

    private abort_forwards_for_token(token: string, reason: string): void {
        for (const [session_id, forward] of this.active_forwards) {
            if (forward.token === token) {
                try {
                    forward.caller_ws.close(4503, reason)
                } catch {
                    // Ignore
                }
                this.active_forwards.delete(session_id)
            }
        }
    }
}
