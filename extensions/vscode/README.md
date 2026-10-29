# Rexec for Visual Studio Code

Official VS Code extension for [Rexec](https://github.com/rexec), providing remote server status monitoring, persistent HTTP/2 connection pooling, port forwarding, and integrated terminal sessions directly in your editor status bar.

## Features

### Real-Time Server & Agent Status
- Displays active server connectivity directly on the bottom-left status bar:
  - `$(vm-active) rexec: <server_name>`: Server online and idle
  - `$(sync~spin) rexec: <server_name> (N tasks)`: Server online and actively executing tasks
  - `$(vm-outline) rexec: <server_name> (offline)`: Hub reachable, but agent daemon is disconnected
  - `$(error) rexec: <server_name> (error)`: Hub connection error
  - `$(vm) rexec: add server`: No remote server configured
- Hover tooltip displays detailed metrics: Server Name, Hub URL, Node ID, active tasks, active port tunnels, and last check timestamp.
- Backed by persistent HTTP/2 stream multiplexing with zero connection churn.
- Automatically pauses polling when the VS Code window loses focus to eliminate unnecessary network traffic.

### Global Server Pool & Workspace Switching
- Manage multiple remote servers (e.g. Colab, GPU clusters, cloud instances) in a global profile pool shared across all your projects.
- Each workspace independently selects its active remote server without writing sensitive authentication tokens into `.vscode/settings.json`.
- Automatic detection of workspace `.env` files (`REXEC_HUB`, `REXEC_TOKEN`) as dynamic workspace server profiles.

### Multiplexed Port Forwarding
- Forward remote server ports to `127.0.0.1:<local_port>` with a single click.
- Fully multiplexed over the edge Rexec Hub WebSocket tunnel.
- Active tunnel status indicator badge in the status bar (`[Tunnels: N]`).
- Quick actions to open forwarded ports in your default browser or terminate active tunnels.

### Integrated Rexec Terminal
- Launch a terminal pre-configured with the active server's `REXEC_HUB` and `REXEC_TOKEN` environment variables.
- Execute remote commands seamlessly with the `rexec` CLI.

## Extension Settings

* `rexec.refreshInterval`: Health check polling interval in seconds (default: `15`, automatically pauses when window is unfocused).
* `rexec.hubUrl`: Optional fallback Rexec Hub URL (legacy fallback).
* `rexec.token`: Optional fallback Rexec Auth Token (legacy fallback).
* `rexec.autoDetectEnv`: Automatically detect `REXEC_HUB` and `REXEC_TOKEN` from workspace `.env` files (default: `true`).

## Commands

* `rexec.showMenu`: Show Rexec action menu (Status Bar click).
* `rexec.switchServer`: Switch active remote server for the current workspace.
* `rexec.addServer`: Register a new remote server into your global server pool.
* `rexec.manageServers`: Edit or delete servers from your global server pool.
* `rexec.refresh`: Manually refresh agent health status.
* `rexec.openTerminal`: Open a terminal with active server credentials set.
* `rexec.forwardPort`: Forward a remote port to localhost.
* `rexec.stopForward`: Stop active port forward tunnels.
