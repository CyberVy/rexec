import type { ExecRequestPayload, HubToAgentMessage, TaskChunkMessage, TaskExitMessage } from "@/protocol"
import type { AgentSession } from "./types"
import { accepted_token, get_cors_headers } from "./utils"

interface ActiveTask {
    token: string
    writer: WritableStreamDefaultWriter<Uint8Array>
    timeout_id?: ReturnType<typeof setTimeout>
    encoder: TextEncoder
    write_queue: Promise<void>
}

export class TaskRelay {
    private active_tasks: Map<string, ActiveTask> = new Map()

    public constructor(
        private readonly send: (session: AgentSession, msg: HubToAgentMessage) => void,
        private readonly get_open_agent: (token: string) => AgentSession | undefined
    ) {}

    public get size(): number {
        return this.active_tasks.size
    }

    public count_for(token: string): number {
        let count = 0
        for (const task of this.active_tasks.values()) {
            if (task.token === token) count++
        }
        return count
    }

    public on_agent_message(session: AgentSession, msg: TaskChunkMessage | TaskExitMessage): void {
        if (msg.type === "task:chunk") {
            const task = this.active_tasks.get(msg.task_id)
            if (task && task.token === session.token) {
                const payload = JSON.stringify({ stream: msg.stream, data: msg.data })
                this.write_to_task(task, msg.task_id, `event: chunk\ndata: ${payload}\n\n`)
            }
        } else if (msg.type === "task:exit") {
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
        }
    }

    public async handle_exec_request(request: Request, url: URL): Promise<Response> {
        const headers = get_cors_headers(request)
        const token = accepted_token(request, url)
        const session = this.get_open_agent(token)
        if (!session) {
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
            if (!task) return
            const payload = JSON.stringify({ message: `Command timed out after ${timeout_ms}ms` })
            task.writer.write(task.encoder.encode(`event: error\ndata: ${payload}\n\n`)).catch(() => {})
            this.finish_task(task_id)
        }, timeout_ms)

        const task: ActiveTask = {
            token,
            writer,
            timeout_id,
            encoder,
            write_queue: Promise.resolve()
        }
        this.active_tasks.set(task_id, task)

        request.signal.addEventListener("abort", () => {
            this.finish_task(task_id)
        })

        this.write_to_task(task, task_id, `event: start\ndata: ${JSON.stringify({ task_id })}\n\n`)

        this.send(session, {
            type: "task:exec",
            task_id,
            cmd: body.cmd,
            cwd: body.cwd,
            env: body.env
        })

        return new Response(readable, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                ...headers
            }
        })
    }

    public async handle_kill_request(request: Request, url: URL): Promise<Response> {
        const headers = get_cors_headers(request)
        const token = accepted_token(request, url)
        let body: { task_id?: string }
        try {
            body = (await request.json()) as { task_id?: string }
        } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400, headers })
        }
        if (!body.task_id) {
            return Response.json({ error: "Missing 'task_id' in request body" }, { status: 400, headers })
        }
        const task = this.active_tasks.get(body.task_id)
        if (task && task.token !== token) {
            return Response.json({ error: "Task not found" }, { status: 404, headers })
        }
        this.finish_task(body.task_id)
        return Response.json({ status: "ok" }, { headers })
    }

    public stop_on_agent(session: AgentSession): void {
        for (const task_id of this.active_tasks.keys()) {
            const task = this.active_tasks.get(task_id)
            if (task && task.token === session.token) {
                this.send(session, { type: "task:kill", task_id, signal: "SIGTERM" })
            }
        }
    }

    public abort_for_token(token: string, reason: string): void {
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

    private finish_task(task_id: string): void {
        const task = this.active_tasks.get(task_id)
        if (!task) return
        if (task.timeout_id) clearTimeout(task.timeout_id)
        this.active_tasks.delete(task_id)
        const agent = this.get_open_agent(task.token)
        if (agent) this.send(agent, { type: "task:kill", task_id, signal: "SIGTERM" })
        task.writer.close().catch(() => {})
    }

    private write_to_task(task: ActiveTask, task_id: string, text: string): void {
        task.write_queue = task.write_queue
            .then(() => task.writer.write(task.encoder.encode(text)))
            .catch(() => {
                this.finish_task(task_id)
            })
    }
}
