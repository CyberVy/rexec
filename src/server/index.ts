import { DurableObject } from "cloudflare:workers"
import type { AgentToHubMessage, ExecRequestPayload, HubToAgentMessage, TaskExecMessage } from "@/protocol"

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

interface AgentSession {
    token: string
    node_id: string
    hostname?: string
    ws: WebSocket
    connected_at: number
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

    constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
        super(ctx, env)
    }

    override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === "/health" || url.pathname === "/api/health") {
            const token = extract_token(request, url)
            if (token) {
                const session = this.agents.get(token)
                const is_connected = session !== undefined && session.ws.readyState === WebSocket.OPEN
                let tasks_for_token = 0
                for (const [, task] of this.active_tasks) {
                    if (task.token === token) tasks_for_token++
                }
                return Response.json({
                    status: "ok",
                    agent_connected: is_connected,
                    node_id: session?.node_id,
                    active_tasks: tasks_for_token
                })
            }

            return Response.json({
                status: "ok",
                agent_connected: this.agents.size > 0,
                connected_agents: this.agents.size,
                active_tasks: this.active_tasks.size
            })
        }

        if (url.pathname === "/ws" || url.pathname === "/ws/agent") {
            return this.handle_agent_ws(request, url)
        }

        if (url.pathname === "/exec" || url.pathname === "/api/exec") {
            if (request.method !== "POST") {
                return new Response("Method Not Allowed", { status: 405 })
            }
            return this.handle_exec_request(request, url)
        }

        return new Response("Not Found", { status: 404 })
    }

    private handle_agent_ws(request: Request, url: URL): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426 })
        }

        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401 })
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

        server.addEventListener("message", (event) => {
            this.handle_agent_message(session, event.data)
        })

        server.addEventListener("close", () => {
            const current = this.agents.get(token)
            if (current && current.ws === server) {
                this.agents.delete(token)
                this.abort_tasks_for_token(token, "Agent disconnected unexpectedly")
            }
        })

        server.addEventListener("error", () => {
            const current = this.agents.get(token)
            if (current && current.ws === server) {
                this.agents.delete(token)
                this.abort_tasks_for_token(token, "Agent connection error")
            }
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    private handle_agent_message(session: AgentSession, data: unknown): void {
        if (typeof data !== "string") return
        try {
            const msg = JSON.parse(data) as AgentToHubMessage
            if (msg.type === "chunk") {
                const task = this.active_tasks.get(msg.task_id)
                if (task && task.token === session.token) {
                    const payload = JSON.stringify({ stream: msg.stream, data: msg.data })
                    this.write_to_task(task, `event: chunk\ndata: ${payload}\n\n`)
                }
            } else if (msg.type === "exit") {
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

    private async handle_exec_request(request: Request, url: URL): Promise<Response> {
        const token = extract_token(request, url)
        if (!token) {
            return new Response("Missing authorization token", { status: 401 })
        }

        const session = this.agents.get(token)
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            return Response.json(
                { error: "No agent connected for this token. Please start rexec-agent first." },
                { status: 503 }
            )
        }

        let body: ExecRequestPayload
        try {
            body = (await request.json()) as ExecRequestPayload
        } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 })
        }

        if (!body.cmd) {
            return Response.json({ error: "Missing 'cmd' in request body" }, { status: 400 })
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
                this.send_to_agent(session, { type: "kill", task_id, signal: "SIGTERM" })
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
                this.send_to_agent(session, { type: "kill", task_id, signal: "SIGINT" })
                task.writer.close().catch(() => {})
                this.active_tasks.delete(task_id)
            }
        })

        const exec_msg: TaskExecMessage = {
            type: "exec",
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
                Connection: "keep-alive"
            }
        })
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
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)

        // Intercept unauthenticated agent registrations before reaching Durable Object
        if (url.pathname === "/ws" || url.pathname === "/ws/agent") {
            const token = extract_token(request, url)
            if (!token) {
                return new Response("Missing authorization token for agent registration", { status: 401 })
            }
        }

        // Intercept unauthenticated exec requests before reaching Durable Object
        if (url.pathname === "/exec" || url.pathname === "/api/exec") {
            const token = extract_token(request, url)
            if (!token) {
                return new Response("Missing authorization token", { status: 401 })
            }
        }

        const id = env.REXEC_HUB.idFromName("default")
        const stub = env.REXEC_HUB.get(id)
        return stub.fetch(request)
    }
}
