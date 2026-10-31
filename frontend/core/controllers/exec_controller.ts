import { BaseController } from "@/infra/base_controller"
import { create_logger } from "@/infra/logger"
import { session_controller } from "./session_controller"

const logger = create_logger("ExecController")

export interface ExecChunk {
    stream: "stdout" | "stderr"
    data: string
    timestamp: number
}

export interface ExecState {
    is_running: boolean
    command: string
    cwd: string
    exit_code: number | null
    duration_ms: number | null
    error: string | null
    chunks: ExecChunk[]
}

export class ExecController extends BaseController<ExecState> {
    private abort_controller: AbortController | null = null

    constructor() {
        super()
        this._state = {
            is_running: false,
            command: "uname -a",
            cwd: "",
            exit_code: null,
            duration_ms: null,
            error: null,
            chunks: []
        }
    }

    public set_command(command: string): void {
        this.update_state({ command })
        this.dispatchEvent(new Event("change"))
    }

    public set_cwd(cwd: string): void {
        this.update_state({ cwd })
        this.dispatchEvent(new Event("change"))
    }

    public clear_output(): void {
        this.update_state({
            chunks: [],
            exit_code: null,
            duration_ms: null,
            error: null
        })
        this.dispatchEvent(new Event("change"))
    }

    public abort(): void {
        if (this.abort_controller) {
            this.abort_controller.abort()
            this.abort_controller = null
            this.update_state({
                is_running: false,
                error: "Execution aborted by user"
            })
            this.dispatchEvent(new Event("change"))
        }
    }

    public async run(command_to_run?: string, cwd_override?: string): Promise<number | null> {
        const cmd = (command_to_run ?? this.state.command).trim()
        if (!cmd) return null

        if (this.state.is_running) {
            this.abort()
        }

        const caller = session_controller.get_caller()
        const cwd = cwd_override ?? (this.state.cwd.trim() || undefined)

        this.abort_controller = new AbortController()
        const signal = this.abort_controller.signal

        this.update_state({
            is_running: true,
            command: cmd,
            cwd: cwd || "",
            exit_code: null,
            duration_ms: null,
            error: null,
            chunks: []
        })
        this.dispatchEvent(new Event("change"))

        const start_time = performance.now()

        try {
            const exit_code = await caller.exec(
                {
                    cmd,
                    cwd,
                    signal
                },
                (stream, data) => {
                    const chunk: ExecChunk = {
                        stream,
                        data,
                        timestamp: Date.now()
                    }
                    const current_chunks = this.state.chunks ?? []
                    this.update_state({
                        chunks: [...current_chunks, chunk]
                    })
                    this.dispatchEvent(new Event("chunk"))
                    this.dispatchEvent(new Event("change"))
                }
            )

            const duration = Math.round(performance.now() - start_time)
            this.update_state({
                is_running: false,
                exit_code,
                duration_ms: duration
            })
            this.dispatchEvent(new Event("change"))
            this.dispatchEvent(new Event("finish"))
            return exit_code
        } catch (err) {
            if (signal.aborted) {
                return null
            }
            const message = err instanceof Error ? err.message : String(err)
            logger.error("Exec command failed", message)
            const duration = Math.round(performance.now() - start_time)
            this.update_state({
                is_running: false,
                error: message,
                duration_ms: duration
            })
            this.dispatchEvent(new Event("change"))
            this.dispatchEvent(new Event("finish"))
            return null
        } finally {
            this.abort_controller = null
        }
    }
}

export const exec_controller = new ExecController()
