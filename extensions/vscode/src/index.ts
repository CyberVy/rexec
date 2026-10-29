import * as vscode from "vscode"
import { is_updating_config } from "./config"
import { ForwardManager } from "./forward_manager"
import {
    prompt_add_server,
    prompt_forward_port,
    prompt_manage_servers,
    prompt_stop_forward,
    prompt_switch_server,
    show_rexec_menu
} from "./menu"
import { ServerManager } from "./server_manager"
import { StateManager } from "./state_manager"
import { StatusBarController } from "./status_bar"
import { open_rexec_terminal } from "./terminal"

export function activate(context: vscode.ExtensionContext): void {
    const server_manager = new ServerManager(context)
    const state_manager = new StateManager(server_manager)
    const forward_manager = new ForwardManager()
    const status_bar = new StatusBarController(state_manager, forward_manager)

    const env_watcher = vscode.workspace.createFileSystemWatcher("**/.env")
    const on_env_change = () => {
        void state_manager.refresh()
    }
    env_watcher.onDidChange(on_env_change)
    env_watcher.onDidCreate(on_env_change)
    env_watcher.onDidDelete(on_env_change)

    const on_config_change = vscode.workspace.onDidChangeConfiguration((e) => {
        if (is_updating_config()) {
            return
        }
        if (e.affectsConfiguration("rexec")) {
            void state_manager.refresh()
        }
    })

    context.subscriptions.push(
        server_manager,
        state_manager,
        forward_manager,
        status_bar,
        env_watcher,
        on_config_change,
        vscode.commands.registerCommand("rexec.refresh", () => state_manager.refresh()),
        vscode.commands.registerCommand("rexec.showMenu", () =>
            show_rexec_menu(server_manager, state_manager, forward_manager)
        ),
        vscode.commands.registerCommand("rexec.switchServer", () =>
            prompt_switch_server(server_manager, state_manager)
        ),
        vscode.commands.registerCommand("rexec.addServer", () => prompt_add_server(server_manager)),
        vscode.commands.registerCommand("rexec.manageServers", () => prompt_manage_servers(server_manager)),
        vscode.commands.registerCommand("rexec.openTerminal", () => open_rexec_terminal(server_manager)),
        vscode.commands.registerCommand("rexec.forwardPort", () =>
            prompt_forward_port(server_manager, state_manager, forward_manager)
        ),
        vscode.commands.registerCommand("rexec.stopForward", () => prompt_stop_forward(forward_manager))
    )

    state_manager.start()
}

export function deactivate(): void {
    // Disposables registered in context.subscriptions are automatically disposed
}
