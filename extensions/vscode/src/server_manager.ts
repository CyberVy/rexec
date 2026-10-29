import * as vscode from "vscode"
import { detect_env_from_workspace } from "./env"
import type { RemoteServer } from "./types"

const GLOBAL_SERVERS_KEY = "rexec.server_profiles"
const WORKSPACE_ACTIVE_SERVER_KEY = "rexec.active_server_id"
export const WORKSPACE_ENV_SERVER_ID = "__workspace_env__"

export class ServerManager implements vscode.Disposable {
    private readonly on_active_change_emitter = new vscode.EventEmitter<RemoteServer | null>()
    public readonly on_did_change_active_server = this.on_active_change_emitter.event

    public constructor(private readonly context: vscode.ExtensionContext) {
        this.migrate_legacy_config()
    }

    private migrate_legacy_config(): void {
        const existing = this.context.globalState.get<RemoteServer[]>(GLOBAL_SERVERS_KEY)
        if (existing && existing.length > 0) {
            return
        }

        const ws_config = vscode.workspace.getConfiguration("rexec")
        const hub_url = (ws_config.get<string>("hubUrl") || "").trim()
        const token = (ws_config.get<string>("token") || "").trim()

        if (hub_url && token) {
            const default_server: RemoteServer = {
                id: "server-primary",
                name: "Primary Server",
                hub_url,
                token,
                created_at: Date.now()
            }
            void this.context.globalState.update(GLOBAL_SERVERS_KEY, [default_server])
            void this.context.workspaceState.update(WORKSPACE_ACTIVE_SERVER_KEY, default_server.id)
        }
    }

    public get_servers(): RemoteServer[] {
        const global_servers = this.context.globalState.get<RemoteServer[]>(GLOBAL_SERVERS_KEY) || []
        const servers = [...global_servers]

        const workspace_roots = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
        const env_detected = detect_env_from_workspace(workspace_roots)
        if (env_detected.hub_url && env_detected.token) {
            servers.push({
                id: WORKSPACE_ENV_SERVER_ID,
                name: "Workspace (.env)",
                hub_url: env_detected.hub_url,
                token: env_detected.token,
                created_at: 0
            })
        }

        return servers
    }

    public get_active_server(): RemoteServer | null {
        const servers = this.get_servers()
        if (servers.length === 0) {
            return null
        }

        const active_id = this.context.workspaceState.get<string>(WORKSPACE_ACTIVE_SERVER_KEY)
        if (active_id) {
            const found = servers.find((s) => s.id === active_id)
            if (found) {
                return found
            }
        }

        return servers[0]
    }

    public async set_active_server(server_id: string): Promise<void> {
        await this.context.workspaceState.update(WORKSPACE_ACTIVE_SERVER_KEY, server_id)
        this.on_active_change_emitter.fire(this.get_active_server())
    }

    public async add_server(name: string, hub_url: string, token: string): Promise<RemoteServer> {
        const global_servers = this.context.globalState.get<RemoteServer[]>(GLOBAL_SERVERS_KEY) || []
        const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
        const id = `${slug || "server"}-${Date.now().toString(36)}`

        const new_server: RemoteServer = {
            id,
            name: name.trim(),
            hub_url: hub_url.trim(),
            token: token.trim(),
            created_at: Date.now()
        }

        const updated = [...global_servers, new_server]
        await this.context.globalState.update(GLOBAL_SERVERS_KEY, updated)
        await this.set_active_server(new_server.id)
        return new_server
    }

    public async remove_server(server_id: string): Promise<boolean> {
        const global_servers = this.context.globalState.get<RemoteServer[]>(GLOBAL_SERVERS_KEY) || []
        const updated = global_servers.filter((s) => s.id !== server_id)
        if (updated.length === global_servers.length) {
            return false
        }

        await this.context.globalState.update(GLOBAL_SERVERS_KEY, updated)

        const active_id = this.context.workspaceState.get<string>(WORKSPACE_ACTIVE_SERVER_KEY)
        if (active_id === server_id) {
            const next = this.get_servers()[0]
            await this.context.workspaceState.update(WORKSPACE_ACTIVE_SERVER_KEY, next ? next.id : undefined)
            this.on_active_change_emitter.fire(this.get_active_server())
        }
        return true
    }

    public async update_server(
        server_id: string,
        updates: Partial<Omit<RemoteServer, "id" | "created_at">>
    ): Promise<boolean> {
        const global_servers = this.context.globalState.get<RemoteServer[]>(GLOBAL_SERVERS_KEY) || []
        const index = global_servers.findIndex((s) => s.id === server_id)
        if (index === -1) {
            return false
        }

        const existing = global_servers[index]
        global_servers[index] = {
            ...existing,
            ...updates,
            name: updates.name ? updates.name.trim() : existing.name,
            hub_url: updates.hub_url ? updates.hub_url.trim() : existing.hub_url,
            token: updates.token ? updates.token.trim() : existing.token
        }

        await this.context.globalState.update(GLOBAL_SERVERS_KEY, global_servers)

        const active = this.get_active_server()
        if (active?.id === server_id) {
            this.on_active_change_emitter.fire(this.get_active_server())
        }
        return true
    }

    public dispose(): void {
        this.on_active_change_emitter.dispose()
    }
}
