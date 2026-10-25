import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import type { AgentToHubMessage, TaskExecMessage, TaskKillMessage } from "@/protocol"

export class TaskManager {
    private running_tasks: Map<string, ChildProcess> = new Map()

    execute(msg: TaskExecMessage, base_workspace: string, send: (msg: AgentToHubMessage) => void): void {
        const { task_id, cmd, cwd, env } = msg
        const task_cwd = cwd ? path.resolve(base_workspace, cwd) : base_workspace
        const task_env = { ...process.env, ...env }

        console.log(`[rexec-agent] [task:${task_id.slice(0, 8)}] Spawning: ${cmd} (cwd: ${task_cwd})`)

        const child = spawn(cmd, {
            shell: true,
            cwd: task_cwd,
            env: task_env
        })

        this.running_tasks.set(task_id, child)

        child.stdout?.on("data", (chunk: Buffer) => {
            send({
                type: "chunk",
                task_id,
                stream: "stdout",
                data: chunk.toString("utf-8")
            })
        })

        child.stderr?.on("data", (chunk: Buffer) => {
            send({
                type: "chunk",
                task_id,
                stream: "stderr",
                data: chunk.toString("utf-8")
            })
        })

        child.on("close", (code, signal) => {
            console.log(
                `[rexec-agent] [task:${task_id.slice(0, 8)}] Exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`
            )
            this.running_tasks.delete(task_id)
            send({
                type: "exit",
                task_id,
                code,
                signal
            })
        })

        child.on("error", (err) => {
            console.error(`[rexec-agent] [task:${task_id.slice(0, 8)}] Spawn error:`, err)
            send({
                type: "chunk",
                task_id,
                stream: "stderr",
                data: `rexec: failed to spawn process: ${err.message}\n`
            })
            send({
                type: "exit",
                task_id,
                code: 1,
                signal: null
            })
            this.running_tasks.delete(task_id)
        })
    }

    kill(msg: TaskKillMessage): void {
        const child = this.running_tasks.get(msg.task_id)
        if (child) {
            console.log(`[rexec-agent] Killing task ${msg.task_id.slice(0, 8)} with signal ${msg.signal || "SIGINT"}`)
            child.kill((msg.signal as NodeJS.Signals) || "SIGINT")
        }
    }

    abort_all(): void {
        for (const [task_id, child] of this.running_tasks) {
            console.log(`[rexec-agent] Terminating running task ${task_id.slice(0, 8)}`)
            child.kill("SIGTERM")
        }
        this.running_tasks.clear()
    }
}
