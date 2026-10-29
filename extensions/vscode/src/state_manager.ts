import * as vscode from "vscode"
import { get_rexec_config } from "./config"
import { H2StatusClient } from "./h2_client"
import type { ServerManager } from "./server_manager"
import type { AgentStatusInfo } from "./types"

export class StateManager implements vscode.Disposable {
    private current_status: AgentStatusInfo = {
        status: "unconfigured",
        hub_url: ""
    }
    private readonly on_status_change_emitter = new vscode.EventEmitter<AgentStatusInfo>()
    public readonly on_did_change_status = this.on_status_change_emitter.event

    private readonly h2_client = new H2StatusClient()
    private timer: NodeJS.Timeout | null = null
    private abort_controller: AbortController | null = null
    private window_focused = true
    private readonly disposables: vscode.Disposable[] = []

    public constructor(private readonly server_manager: ServerManager) {
        this.window_focused = vscode.window.state.focused

        this.disposables.push(
            this.server_manager.on_did_change_active_server(() => {
                this.h2_client.close_session()
                this.reset_timer()
                void this.poll(false)
            }),
            vscode.window.onDidChangeWindowState((state) => {
                const was_focused = this.window_focused
                this.window_focused = state.focused

                if (state.focused && !was_focused) {
                    void this.poll(false)
                    this.reset_timer()
                } else if (!state.focused) {
                    this.clear_timer()
                }
            })
        )
    }

    public start(): void {
        this.reset_timer()
        void this.poll(false)
    }

    public stop(): void {
        this.clear_timer()
        if (this.abort_controller) {
            this.abort_controller.abort()
            this.abort_controller = null
        }
    }

    public async refresh(): Promise<void> {
        this.reset_timer()
        await this.poll(true)
    }

    public get_current_status(): AgentStatusInfo {
        return this.current_status
    }

    public async poll(explicit = false): Promise<void> {
        const server = this.server_manager.get_active_server()
        if (!server || !server.hub_url || !server.token) {
            this.update_status({
                status: "unconfigured",
                hub_url: ""
            })
            return
        }

        if (this.abort_controller) {
            this.abort_controller.abort()
            this.abort_controller = null
        }

        const controller = new AbortController()
        this.abort_controller = controller
        const signal = controller.signal

        if (explicit || this.current_status.status === "unconfigured") {
            this.update_status({
                status: "checking",
                server_id: server.id,
                server_name: server.name,
                hub_url: server.hub_url,
                token: server.token
            })
        }

        const timeout_id = setTimeout(() => {
            controller.abort()
        }, 5000)

        try {
            const status = await this.h2_client.get_status(server.hub_url, server.token, signal)
            clearTimeout(timeout_id)

            if (signal.aborted) {
                return
            }

            if (status.agent_connected) {
                this.update_status({
                    status: "connected",
                    server_id: server.id,
                    server_name: server.name,
                    hub_url: server.hub_url,
                    token: server.token,
                    node_id: status.node_id || "agent",
                    active_tasks: status.active_tasks ?? 0,
                    last_checked: new Date()
                })
            } else {
                this.update_status({
                    status: "disconnected",
                    server_id: server.id,
                    server_name: server.name,
                    hub_url: server.hub_url,
                    token: server.token,
                    node_id: status.node_id,
                    active_tasks: 0,
                    last_checked: new Date()
                })
            }
        } catch (err: unknown) {
            clearTimeout(timeout_id)

            if (signal.aborted) {
                return
            }

            const message = err instanceof Error ? err.message : String(err)
            this.update_status({
                status: "error",
                server_id: server.id,
                server_name: server.name,
                hub_url: server.hub_url,
                token: server.token,
                error_message: message,
                last_checked: new Date()
            })
        } finally {
            if (this.abort_controller === controller) {
                this.abort_controller = null
            }
        }
    }

    private reset_timer(): void {
        this.clear_timer()
        if (!this.window_focused) {
            return
        }
        const config = get_rexec_config()
        this.timer = setInterval(() => {
            void this.poll(false)
        }, config.refresh_interval_sec * 1000)
    }

    private clear_timer(): void {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
    }

    private update_status(new_status: AgentStatusInfo): void {
        this.current_status = new_status
        this.on_status_change_emitter.fire(this.current_status)
    }

    public dispose(): void {
        this.stop()
        for (const d of this.disposables) {
            d.dispose()
        }
        this.h2_client.dispose()
        this.on_status_change_emitter.dispose()
    }
}
