import * as vscode from "vscode"
import { detect_env_from_workspace } from "./env"
import type { RexecConfig } from "./types"

export { parse_env_file, detect_env_from_workspace } from "./env"

let is_saving_config = false

export function is_updating_config(): boolean {
    return is_saving_config
}

const DEFAULT_REFRESH_INTERVAL_SEC = 15

export function get_rexec_config(): RexecConfig {
    const ws_config = vscode.workspace.getConfiguration("rexec")
    let hub_url = (ws_config.get<string>("hubUrl") || "").trim()
    let token = (ws_config.get<string>("token") || "").trim()
    const refresh_interval_sec = ws_config.get<number>("refreshInterval") || DEFAULT_REFRESH_INTERVAL_SEC
    const auto_detect_env = ws_config.get<boolean>("autoDetectEnv", true)

    if (auto_detect_env && (!hub_url || !token)) {
        const workspace_roots = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
        const detected = detect_env_from_workspace(workspace_roots)
        if (!hub_url && detected.hub_url) {
            hub_url = detected.hub_url
        }
        if (!token && detected.token) {
            token = detected.token
        }
    }

    return {
        hub_url,
        token,
        refresh_interval_sec,
        auto_detect_env
    }
}

export async function update_rexec_config(
    hub_url: string,
    token: string,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
    is_saving_config = true
    try {
        const ws_config = vscode.workspace.getConfiguration("rexec")

        await ws_config.update("hubUrl", hub_url, target)
        await ws_config.update("token", token, target)

        // When saving to Global (User Settings), clean up any workspace-level overrides
        // so credentials don't linger in .vscode/settings.json
        if (target === vscode.ConfigurationTarget.Global) {
            const inspect_hub = ws_config.inspect<string>("hubUrl")
            if (inspect_hub?.workspaceValue !== undefined) {
                await ws_config.update("hubUrl", undefined, vscode.ConfigurationTarget.Workspace)
            }
            const inspect_token = ws_config.inspect<string>("token")
            if (inspect_token?.workspaceValue !== undefined) {
                await ws_config.update("token", undefined, vscode.ConfigurationTarget.Workspace)
            }
        }
    } finally {
        is_saving_config = false
    }
}
