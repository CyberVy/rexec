export interface ParsedCli {
    subcommand: "status" | "pull" | "push" | "run" | "forward"
    hub_url: string
    token: string
    cwd?: string
    timeout_ms: number
    force: boolean
    recursive: boolean
    args: string[]
}

export function print_usage(): void {
    console.log(`rexec - Ultra-lightweight edge-routed remote execution engine

Usage:
  rexec [options] <command...>        Execute remote command (default fallback)
  rexec run [options] <command...>    Explicitly execute remote command
  rexec forward [options] <port...>   Forward local port to remote agent port
  rexec pull [options] <remote> [loc] Download a file or directory from remote agent
  rexec push [options] <loc> [remote] Upload a file or directory to remote agent
  rexec status [options]              Check connection and agent status
  rexec -- [options] <command...>     Escape command collisions with subcommands

Options:
  --hub <url>        Hub URL (or via REXEC_HUB env var)
  --token <secret>   Auth Token (or via REXEC_TOKEN env var)
  --cwd <dir>        Remote working directory relative to remote workspace
  --timeout <ms>     Command execution timeout in milliseconds (default: 300000)
  -r, --recursive    Transfer directories recursively via streaming tar
  -f, --force        Overwrite local target file when pulling
  -h, --help         Show this help message

Examples:
  rexec "nvidia-smi"
  rexec run python main.py --epochs 10
  rexec forward 8080                 # Forward localhost:8080 -> agent:8080
  rexec forward 9000:8000            # Forward localhost:9000 -> agent:8000
  rexec pull /content/loss.png ./loss.png
  rexec pull -r /content/sample_data ./sample_data
  rexec push ./dataset.zip /content/dataset.zip
  rexec push -r ./my_module /content/my_module
  rexec status
  rexec -- status       # Run a remote command named 'status'
  rexec -- pull foo     # Run a remote command named 'pull'
`)
}

export function parse_cli_args(raw_args: string[]): ParsedCli {
    let hub_url = process.env.REXEC_HUB || ""
    let token = process.env.REXEC_TOKEN || ""
    let cwd: string | undefined
    let timeout_ms = 300000
    let force = false
    let recursive = false

    const tokens: string[] = []
    let has_double_dash = false
    const after_double_dash: string[] = []

    for (let i = 0; i < raw_args.length; i++) {
        const arg = raw_args[i]
        if (has_double_dash) {
            after_double_dash.push(arg)
            continue
        }
        if (arg === "--") {
            has_double_dash = true
            continue
        }
        if (arg === "--hub" && i + 1 < raw_args.length) {
            hub_url = raw_args[++i]
        } else if (arg.startsWith("--hub=")) {
            hub_url = arg.slice("--hub=".length)
        } else if (arg === "--token" && i + 1 < raw_args.length) {
            token = raw_args[++i]
        } else if (arg.startsWith("--token=")) {
            token = arg.slice("--token=".length)
        } else if (arg === "--cwd" && i + 1 < raw_args.length) {
            cwd = raw_args[++i]
        } else if (arg.startsWith("--cwd=")) {
            cwd = arg.slice("--cwd=".length)
        } else if (arg === "--timeout" && i + 1 < raw_args.length) {
            timeout_ms = Number.parseInt(raw_args[++i], 10) || timeout_ms
        } else if (arg.startsWith("--timeout=")) {
            timeout_ms = Number.parseInt(arg.slice("--timeout=".length), 10) || timeout_ms
        } else if (arg === "-f" || arg === "--force") {
            force = true
        } else if (arg === "-r" || arg === "--recursive") {
            recursive = true
        } else {
            tokens.push(arg)
        }
    }

    if (has_double_dash) {
        return {
            subcommand: "run",
            hub_url,
            token,
            cwd,
            timeout_ms,
            force,
            recursive,
            args: [...tokens, ...after_double_dash]
        }
    }

    const first_token = tokens[0]
    if (first_token === "status") {
        return { subcommand: "status", hub_url, token, cwd, timeout_ms, force, recursive, args: tokens.slice(1) }
    }
    if (first_token === "forward") {
        return { subcommand: "forward", hub_url, token, cwd, timeout_ms, force, recursive, args: tokens.slice(1) }
    }
    if (first_token === "pull") {
        return { subcommand: "pull", hub_url, token, cwd, timeout_ms, force, recursive, args: tokens.slice(1) }
    }
    if (first_token === "push") {
        return { subcommand: "push", hub_url, token, cwd, timeout_ms, force, recursive, args: tokens.slice(1) }
    }
    if (first_token === "run" || first_token === "exec") {
        return { subcommand: "run", hub_url, token, cwd, timeout_ms, force, recursive, args: tokens.slice(1) }
    }

    return { subcommand: "run", hub_url, token, cwd, timeout_ms, force, recursive, args: tokens }
}
