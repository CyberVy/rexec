import * as vscode from "vscode"
import type { ServerManager } from "./server_manager"

export function open_rexec_terminal(server_manager: ServerManager): void {
    const server = server_manager.get_active_server()
    if (!server || !server.hub_url) {
        void vscode.window
            .showWarningMessage("No remote server selected. Please add or select a server first.", "Add Server")
            .then((choice) => {
                if (choice === "Add Server") {
                    void vscode.commands.executeCommand("rexec.addServer")
                }
            })
        return
    }

    const term_name = `Rexec: ${server.name}`
    const existing_terminal = vscode.window.terminals.find((t) => t.name === term_name || t.name === "Rexec")
    if (existing_terminal) {
        existing_terminal.show()
        return
    }

    const terminal = vscode.window.createTerminal({
        name: term_name,
        env: {
            REXEC_HUB: server.hub_url,
            REXEC_TOKEN: server.token
        }
    })

    terminal.show()
}
