import * as vscode from "vscode"
import type { ForwardManager } from "./forward_manager"
import { WORKSPACE_ENV_SERVER_ID, type ServerManager } from "./server_manager"
import type { StateManager } from "./state_manager"

interface MenuActionItem extends vscode.QuickPickItem {
    action: () => void | Promise<void>
}

export async function show_rexec_menu(
    server_manager: ServerManager,
    state_manager: StateManager,
    forward_manager: ForwardManager
): Promise<void> {
    const status = state_manager.get_current_status()
    const tunnels = forward_manager.get_active_tunnels()
    const active_server = server_manager.get_active_server()
    const items: MenuActionItem[] = []

    // 1. Status overview item
    let status_label = "$(vm) Rexec: No Server Configured"
    let status_detail = "Click 'Add Remote Server' to connect"
    if (active_server) {
        if (status.status === "connected") {
            status_label = `$(vm-active) ${active_server.name}: ${status.node_id || "online"}`
            status_detail = `Online · ${status.active_tasks ?? 0} active task(s)`
        } else if (status.status === "disconnected") {
            status_label = `$(vm-outline) ${active_server.name}: Offline`
            status_detail = "Hub reachable, but no agent daemon is currently connected"
        } else if (status.status === "error") {
            status_label = `$(error) ${active_server.name}: Error`
            status_detail = status.error_message || "Failed to reach Hub"
        } else if (status.status === "checking") {
            status_label = `$(sync~spin) ${active_server.name}: Checking Health...`
            status_detail = "Querying hub endpoint..."
        }
    }

    items.push({
        label: status_label,
        detail: status_detail,
        action: () => {
            void state_manager.refresh()
        }
    })

    // 2. Server management
    items.push({
        label: "$(server-process) Switch Remote Server...",
        description: active_server ? `Current: ${active_server.name}` : "Select active server",
        action: () => {
            void vscode.commands.executeCommand("rexec.switchServer")
        }
    })

    items.push({
        label: "$(add) Add Remote Server...",
        description: "Register a new remote server into your global pool",
        action: () => {
            void vscode.commands.executeCommand("rexec.addServer")
        }
    })

    if (server_manager.get_servers().length > 0) {
        items.push({
            label: "$(gear) Manage Servers...",
            description: "Edit or remove servers from your global pool",
            action: () => {
                void vscode.commands.executeCommand("rexec.manageServers")
            }
        })
    }

    // 3. Operational actions
    items.push({
        label: "$(refresh) Refresh Status",
        description: "Poll current server connectivity and tasks",
        action: () => {
            void state_manager.refresh()
        }
    })

    items.push({
        label: "$(terminal) Open Rexec Terminal",
        description: "Terminal initialized with active server credentials",
        action: () => {
            void vscode.commands.executeCommand("rexec.openTerminal")
        }
    })

    items.push({
        label: "$(plug) Forward Remote Port...",
        description: "Create a TCP forward tunnel (127.0.0.1:<local> -> agent:<remote>)",
        action: () => {
            void vscode.commands.executeCommand("rexec.forwardPort")
        }
    })

    if (tunnels.length > 0) {
        items.push({
            label: `$(debug-stop) Stop Port Forwarding (${tunnels.length} active)...`,
            description: "Close one or all active forward tunnels",
            action: () => {
                void vscode.commands.executeCommand("rexec.stopForward")
            }
        })
    }

    // 4. Copy utility
    if (status.status === "connected" && status.node_id) {
        const node_id = status.node_id
        items.push({
            label: "$(copy) Copy Node ID",
            description: node_id,
            action: async () => {
                await vscode.env.clipboard.writeText(node_id)
                void vscode.window.showInformationMessage(`Copied Node ID '${node_id}' to clipboard`)
            }
        })
    }

    if (active_server) {
        items.push({
            label: "$(clippy) Copy Environment Export",
            description: `export REXEC_HUB="${active_server.hub_url}" REXEC_TOKEN="..."`,
            action: async () => {
                const cmd = `export REXEC_HUB="${active_server.hub_url}" REXEC_TOKEN="${active_server.token}"`
                await vscode.env.clipboard.writeText(cmd)
                void vscode.window.showInformationMessage("Copied REXEC env export command to clipboard")
            }
        })
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a Rexec Action",
        matchOnDescription: true,
        matchOnDetail: true
    })

    if (selected) {
        await selected.action()
    }
}

export async function prompt_switch_server(server_manager: ServerManager, state_manager: StateManager): Promise<void> {
    const servers = server_manager.get_servers()
    const active = server_manager.get_active_server()

    interface ServerPickItem extends vscode.QuickPickItem {
        server_id?: string
        is_add_new?: boolean
    }

    const items: ServerPickItem[] = servers.map((s) => {
        const is_current = active?.id === s.id
        const icon = is_current ? "$(check)" : "$(server)"
        return {
            label: `${icon} ${s.name}`,
            description: s.hub_url,
            detail: is_current ? "Active for current workspace" : undefined,
            server_id: s.id
        }
    })

    items.push({
        label: "$(add) Add New Remote Server...",
        description: "Configure and connect to another remote agent",
        is_add_new: true
    })

    const selected = await vscode.window.showQuickPick(items, {
        title: "Switch Active Remote Server",
        placeHolder: "Select a server for this workspace"
    })

    if (!selected) {
        return
    }

    if (selected.is_add_new) {
        await prompt_add_server(server_manager)
        return
    }

    if (selected.server_id) {
        await server_manager.set_active_server(selected.server_id)
        const updated = server_manager.get_active_server()
        if (updated) {
            void vscode.window.showInformationMessage(`Switched active server to: ${updated.name}`)
        }
        await state_manager.refresh()
    }
}

export async function prompt_add_server(server_manager: ServerManager): Promise<void> {
    const name = await vscode.window.showInputBox({
        title: "Rexec: Add Remote Server (1/3)",
        prompt: "Enter a friendly display name for this server",
        placeHolder: "e.g. Colab GPU T4, AWS H100, Home Lab",
        ignoreFocusOut: true,
        validateInput: (val) => {
            if (!val.trim()) {
                return "Server name cannot be empty"
            }
            return null
        }
    })

    if (!name) {
        return
    }

    const hub_url = await vscode.window.showInputBox({
        title: "Rexec: Add Remote Server (2/3)",
        prompt: "Enter Rexec Hub URL",
        placeHolder: "https://hub.example.workers.dev or http://localhost:8787",
        ignoreFocusOut: true,
        validateInput: (val) => {
            if (!val.trim()) {
                return "Hub URL cannot be empty"
            }
            return null
        }
    })

    if (!hub_url) {
        return
    }

    const token = await vscode.window.showInputBox({
        title: "Rexec: Add Remote Server (3/3)",
        prompt: "Enter Auth Token for this server",
        password: true,
        ignoreFocusOut: true,
        validateInput: (val) => {
            if (!val.trim()) {
                return "Token cannot be empty"
            }
            return null
        }
    })

    if (!token) {
        return
    }

    const created = await server_manager.add_server(name.trim(), hub_url.trim(), token.trim())
    void vscode.window.showInformationMessage(`Added and switched to server: ${created.name}`)
}

export async function prompt_manage_servers(server_manager: ServerManager): Promise<void> {
    const servers = server_manager.get_servers().filter((s) => s.id !== WORKSPACE_ENV_SERVER_ID)
    if (servers.length === 0) {
        void vscode.window.showInformationMessage("No custom servers in global pool to manage.")
        return
    }

    interface ManageItem extends vscode.QuickPickItem {
        server_id: string
        server_name: string
    }

    const items: ManageItem[] = servers.map((s) => ({
        label: `$(server) ${s.name}`,
        description: s.hub_url,
        server_id: s.id,
        server_name: s.name
    }))

    const selected = await vscode.window.showQuickPick(items, {
        title: "Manage Remote Servers",
        placeHolder: "Select a server to edit or remove"
    })

    if (!selected) {
        return
    }

    const action = await vscode.window.showQuickPick(
        [
            { label: "$(trash) Delete Server", action: "delete" },
            { label: "$(edit) Edit Name & URL", action: "edit" }
        ],
        {
            title: `Manage: ${selected.server_name}`,
            placeHolder: "Choose an action"
        }
    )

    if (!action) {
        return
    }

    if (action.action === "delete") {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete server "${selected.server_name}"?`,
            "Delete",
            "Cancel"
        )
        if (confirm === "Delete") {
            await server_manager.remove_server(selected.server_id)
            void vscode.window.showInformationMessage(`Deleted server "${selected.server_name}".`)
        }
    } else if (action.action === "edit") {
        const existing = servers.find((s) => s.id === selected.server_id)
        if (!existing) return

        const new_name = await vscode.window.showInputBox({
            prompt: "Server Name",
            value: existing.name
        })
        if (!new_name) return

        const new_url = await vscode.window.showInputBox({
            prompt: "Hub URL",
            value: existing.hub_url
        })
        if (!new_url) return

        const new_token = await vscode.window.showInputBox({
            prompt: "Auth Token (leave empty to keep unchanged)",
            password: true
        })

        await server_manager.update_server(selected.server_id, {
            name: new_name.trim(),
            hub_url: new_url.trim(),
            ...(new_token && new_token.trim() ? { token: new_token.trim() } : {})
        })
        void vscode.window.showInformationMessage(`Updated server "${new_name}".`)
    }
}

export async function prompt_forward_port(
    server_manager: ServerManager,
    state_manager: StateManager,
    forward_manager: ForwardManager
): Promise<void> {
    const server = server_manager.get_active_server()
    if (!server || !server.hub_url || !server.token) {
        void vscode.window.showWarningMessage("No remote server selected. Please configure a server first.")
        void vscode.commands.executeCommand("rexec.addServer")
        return
    }

    const status = state_manager.get_current_status()
    if (status.status !== "connected") {
        const proceed = await vscode.window.showWarningMessage(
            "Agent appears to be offline. Forwarding may fail if the remote port is unreachable.",
            "Forward Anyway",
            "Cancel"
        )
        if (proceed !== "Forward Anyway") {
            return
        }
    }

    const remote_port_str = await vscode.window.showInputBox({
        title: `Rexec Port Forward [${server.name}]`,
        prompt: "Enter remote agent port to connect to (e.g. 8080, 3000)",
        placeHolder: "8080",
        validateInput: (val) => {
            const num = parseInt(val.trim(), 10)
            if (isNaN(num) || num < 1 || num > 65535) {
                return "Port must be an integer between 1 and 65535"
            }
            return null
        }
    })

    if (!remote_port_str) {
        return
    }
    const remote_port = parseInt(remote_port_str.trim(), 10)

    const local_port_str = await vscode.window.showInputBox({
        title: `Rexec Port Forward [${server.name}]`,
        prompt: "Enter local port to listen on (127.0.0.1)",
        value: String(remote_port),
        validateInput: (val) => {
            const num = parseInt(val.trim(), 10)
            if (isNaN(num) || num < 1 || num > 65535) {
                return "Port must be an integer between 1 and 65535"
            }
            return null
        }
    })

    if (!local_port_str) {
        return
    }
    const local_port = parseInt(local_port_str.trim(), 10)

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Rexec: Opening tunnel 127.0.0.1:${local_port} -> agent:${remote_port}...`,
                cancellable: false
            },
            async () => {
                await forward_manager.start_forward(server.hub_url, server.token, local_port, remote_port)
            }
        )

        const action = await vscode.window.showInformationMessage(
            `Forwarding 127.0.0.1:${local_port} -> agent:${remote_port}`,
            "Open in Browser",
            "Stop"
        )

        if (action === "Open in Browser") {
            void vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${local_port}`))
        } else if (action === "Stop") {
            await forward_manager.stop_forward(local_port)
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        void vscode.window.showErrorMessage(`Failed to forward port: ${msg}`)
    }
}

export async function prompt_stop_forward(forward_manager: ForwardManager): Promise<void> {
    const tunnels = forward_manager.get_active_tunnels()
    if (tunnels.length === 0) {
        void vscode.window.showInformationMessage("No active port forwards.")
        return
    }

    interface StopItem extends vscode.QuickPickItem {
        port?: number
        stop_all?: boolean
    }

    const items: StopItem[] = tunnels.map((t) => ({
        label: `$(plug) 127.0.0.1:${t.local_port} -> agent:${t.remote_port}`,
        description: `${t.active_connections} active socket(s)`,
        port: t.local_port
    }))

    if (tunnels.length > 1) {
        items.unshift({
            label: "$(trash) Stop All Tunnels",
            description: `Close all ${tunnels.length} active tunnels`,
            stop_all: true
        })
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select tunnel to stop"
    })

    if (!selected) {
        return
    }

    if (selected.stop_all) {
        await forward_manager.stop_all()
        void vscode.window.showInformationMessage("Stopped all Rexec forward tunnels.")
    } else if (selected.port) {
        await forward_manager.stop_forward(selected.port)
        void vscode.window.showInformationMessage(`Stopped forward tunnel on port ${selected.port}.`)
    }
}
