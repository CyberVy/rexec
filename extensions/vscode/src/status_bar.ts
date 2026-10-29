import * as vscode from "vscode"
import type { ForwardManager } from "./forward_manager"
import type { StateManager } from "./state_manager"
import type { AgentStatusInfo, PortForwardInfo } from "./types"

export class StatusBarController implements vscode.Disposable {
    private readonly status_bar_item: vscode.StatusBarItem
    private readonly disposables: vscode.Disposable[] = []

    public constructor(
        private readonly state_manager: StateManager,
        private readonly forward_manager: ForwardManager
    ) {
        this.status_bar_item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
        this.status_bar_item.command = "rexec.showMenu"

        this.disposables.push(
            this.status_bar_item,
            this.state_manager.on_did_change_status(() => this.update()),
            this.forward_manager.on_did_change_tunnels(() => this.update())
        )

        this.update()
        this.status_bar_item.show()
    }

    public update(): void {
        const status = this.state_manager.get_current_status()
        const tunnels = this.forward_manager.get_active_tunnels()

        this.render_text(status, tunnels)
        this.render_tooltip(status, tunnels)
    }

    private render_text(status: AgentStatusInfo, tunnels: PortForwardInfo[]): void {
        const tunnel_badge = tunnels.length > 0 ? ` [$(zap)${tunnels.length}]` : ""
        const server_title = status.server_name || status.node_id || "agent"

        switch (status.status) {
            case "unconfigured":
                this.status_bar_item.text = "$(vm) rexec: add server"
                this.status_bar_item.backgroundColor = undefined
                break

            case "checking":
                this.status_bar_item.text = "$(sync~spin) rexec: checking..."
                this.status_bar_item.backgroundColor = undefined
                break

            case "connected":
                if (status.active_tasks && status.active_tasks > 0) {
                    const task_label = status.active_tasks === 1 ? "1 task" : `${status.active_tasks} tasks`
                    this.status_bar_item.text = `$(sync~spin) rexec: ${server_title} (${task_label})${tunnel_badge}`
                } else {
                    this.status_bar_item.text = `$(vm-active) rexec: ${server_title}${tunnel_badge}`
                }
                this.status_bar_item.backgroundColor = undefined
                break

            case "disconnected":
                this.status_bar_item.text = `$(vm-outline) rexec: ${server_title} (offline)${tunnel_badge}`
                this.status_bar_item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
                break

            case "error":
                this.status_bar_item.text = `$(error) rexec: ${server_title} (error)${tunnel_badge}`
                this.status_bar_item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
                break
        }
    }

    private render_tooltip(status: AgentStatusInfo, tunnels: PortForwardInfo[]): void {
        const md = new vscode.MarkdownString("", true)
        md.isTrusted = true
        md.supportThemeIcons = true

        md.appendMarkdown("### Rexec Remote Execution\n\n")

        if (status.server_name) {
            md.appendMarkdown(`- **Server**: \`${status.server_name}\`\n`)
        }

        switch (status.status) {
            case "connected":
                md.appendMarkdown(`- **Status**: $(pass-filled) Connected\n`)
                md.appendMarkdown(`- **Node ID**: \`${status.node_id || "unknown"}\`\n`)
                md.appendMarkdown(`- **Active Tasks**: \`${status.active_tasks ?? 0}\`\n`)
                break
            case "disconnected":
                md.appendMarkdown(`- **Status**: $(warning) Disconnected (No agent online)\n`)
                break
            case "error":
                md.appendMarkdown(`- **Status**: $(error) Error: ${status.error_message || "Unknown error"}\n`)
                break
            case "checking":
                md.appendMarkdown(`- **Status**: $(sync~spin) Checking health...\n`)
                break
            case "unconfigured":
                md.appendMarkdown(`- **Status**: $(info) No remote server configured\n`)
                break
        }

        if (status.hub_url) {
            md.appendMarkdown(`- **Hub**: \`${status.hub_url}\`\n`)
        }

        if (status.last_checked) {
            const time_str = status.last_checked.toLocaleTimeString()
            md.appendMarkdown(`- **Last Checked**: ${time_str}\n`)
        }

        if (tunnels.length > 0) {
            md.appendMarkdown(`\n**Active Port Forwards (${tunnels.length}):**\n`)
            for (const t of tunnels) {
                const conns = t.active_connections > 0 ? ` (${t.active_connections} active)` : ""
                md.appendMarkdown(`- \`127.0.0.1:${t.local_port}\` → \`agent:${t.remote_port}\`${conns}\n`)
            }
        }

        md.appendMarkdown("\n---\n\n")
        md.appendMarkdown("[$(server-process) Switch Server](command:rexec.switchServer) &nbsp;|&nbsp; ")
        md.appendMarkdown("[$(terminal) Terminal](command:rexec.openTerminal) &nbsp;|&nbsp; ")
        md.appendMarkdown("[$(plug) Forward Port](command:rexec.forwardPort) &nbsp;|&nbsp; ")
        md.appendMarkdown("[$(refresh) Refresh](command:rexec.refresh)\n")

        this.status_bar_item.tooltip = md
    }

    public dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
    }
}
