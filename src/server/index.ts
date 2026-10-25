import { DurableObject } from "cloudflare:workers"
import type { AgentToHubMessage, ExecRequestPayload, HubToAgentMessage, TaskExecMessage } from "@/protocol"

export interface Env {
    REXEC_HUB: DurableObjectNamespace
    AUTH_TOKEN?: string
}

interface ActiveTask {
    writer: WritableStreamDefaultWriter<Uint8Array>
    timeout_id?: ReturnType<typeof setTimeout>
    encoder: TextEncoder
    write_queue: Promise<void>
}

export class RexecHub extends DurableObject {
    private agent_ws: WebSocket | null = null
    private active_tasks: Map<string, ActiveTask> = new Map()
    private auth_token: string

    constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
        super(ctx, env)
        this.auth_token = (env.AUTH_TOKEN as string) || ""
    }

    private verify_token(request: Request, url: URL): boolean {
        if (!this.auth_token) return false
        const query_token = url.searchParams.get("token")
        const auth_header = request.headers.get("Authorization")
        const bearer_token = auth_header?.startsWith("Bearer ") ? auth_header.slice(7) : null
        const token = query_token || bearer_token
        return token === this.auth_token
    }

    override async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === "/health" || url.pathname === "/api/health") {
            return Response.json({
                status: "ok",
                agent_connected: this.agent_ws !== null && this.agent_ws.readyState === WebSocket.OPEN,
                active_tasks: this.active_tasks.size
            })
        }

        if (!this.verify_token(request, url)) {
            return new Response("Unauthorized", { status: 401 })
        }

        if (url.pathname === "/ws" || url.pathname === "/ws/agent") {
            return this.handle_agent_ws(request)
        }

        if (url.pathname === "/exec" || url.pathname === "/api/exec") {
            if (request.method !== "POST") {
                return new Response("Method Not Allowed", { status: 405 })
            }
            return this.handle_exec_request(request)
        }

        return new Response("Not Found", { status: 404 })
    }

    private handle_agent_ws(request: Request): Response {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket Upgrade", { status: 426 })
        }

        const web_socket_pair = new WebSocketPair()
        const [client, server] = Object.values(web_socket_pair)

        server.accept()

        if (this.agent_ws) {
            try {
                this.agent_ws.close(1000, "New agent connected")
            } catch {
                // Ignore close error on replaced agent
            }
        }

        this.agent_ws = server

        server.addEventListener("message", (event) => {
            this.handle_agent_message(event.data)
        })

        server.addEventListener("close", () => {
            if (this.agent_ws === server) {
                this.agent_ws = null
                this.abort_all_tasks("Agent disconnected unexpectedly")
            }
        })

        server.addEventListener("error", () => {
            if (this.agent_ws === server) {
                this.agent_ws = null
                this.abort_all_tasks("Agent connection error")
            }
        })

        return new Response(null, {
            status: 101,
            webSocket: client
        })
    }

    private handle_agent_message(data: unknown): void {
        if (typeof data !== "string") return
        try {
            const msg = JSON.parse(data) as AgentToHubMessage
            if (msg.type === "chunk") {
                const task = this.active_tasks.get(msg.task_id)
                if (task) {
                    const payload = JSON.stringify({ stream: msg.stream, data: msg.data })
                    this.write_to_task(task, `event: chunk\ndata: ${payload}\n\n`)
                }
            } else if (msg.type === "exit") {
                const task = this.active_tasks.get(msg.task_id)
                if (task) {
                    if (task.timeout_id) clearTimeout(task.timeout_id)
                    const payload = JSON.stringify({ code: msg.code, signal: msg.signal })
                    task.write_queue = task.write_queue
                        .then(() => task.writer.write(task.encoder.encode(`event: exit\ndata: ${payload}\n\n`)))
                        .then(() => task.writer.close())
                        .catch(() => {})
                    this.active_tasks.delete(msg.task_id)
                }
            } else if (msg.type === "ping") {
                this.send_to_agent({ type: "pong" })
            }
        } catch {
            // Ignore malformed message
        }
    }

    private async handle_exec_request(request: Request): Promise<Response> {
        if (!this.agent_ws || this.agent_ws.readyState !== WebSocket.OPEN) {
            return Response.json(
                { error: "No agent connected. Please start rexec agent on the remote server first." },
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
                this.send_to_agent({ type: "kill", task_id, signal: "SIGTERM" })
                this.active_tasks.delete(task_id)
            }
        }, timeout_ms)

        this.active_tasks.set(task_id, { writer, timeout_id, encoder, write_queue: Promise.resolve() })

        request.signal.addEventListener("abort", () => {
            const task = this.active_tasks.get(task_id)
            if (task) {
                if (task.timeout_id) clearTimeout(task.timeout_id)
                this.send_to_agent({ type: "kill", task_id, signal: "SIGINT" })
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
        this.send_to_agent(exec_msg)

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

    private send_to_agent(msg: HubToAgentMessage): void {
        if (this.agent_ws && this.agent_ws.readyState === WebSocket.OPEN) {
            this.agent_ws.send(JSON.stringify(msg))
        }
    }

    private abort_all_tasks(reason: string): void {
        for (const [, task] of this.active_tasks) {
            if (task.timeout_id) clearTimeout(task.timeout_id)
            const payload = JSON.stringify({ message: reason })
            task.writer
                .write(task.encoder.encode(`event: error\ndata: ${payload}\n\n`))
                .then(() => task.writer.close())
                .catch(() => {})
        }
        this.active_tasks.clear()
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const id = env.REXEC_HUB.idFromName("default")
        const stub = env.REXEC_HUB.get(id)
        return stub.fetch(request)
    }
}
