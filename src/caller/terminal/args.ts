export type TtyAction = "run" | "list" | "attach" | "kill" | "persist"

export interface ParsedCli {
    subcommand: "status" | "pull" | "push" | "run" | "forward" | "tty"
    hub_url: string
    token: string
    cwd?: string
    timeout_ms: number
    force: boolean
    recursive: boolean
    persistent: boolean
    help: boolean
    tty_action: TtyAction
    args: string[]
}

export function print_usage(): void {
    console.log(`rexec - Ultra-lightweight edge-routed remote execution engine

Usage:
  rexec [options] <command...>        Execute remote command (default fallback)
  rexec run [options] <command...>    Explicitly execute remote command
  rexec forward [options] <port...>   Forward local port to remote agent port
  rexec tty [options] [command...]    Open a remote PTY (default login shell) and attach
  rexec tty list                      List remote PTY sessions
  rexec tty attach <session>          Attach to a session by id or unique prefix
  rexec tty kill <session>            Kill a remote PTY session
  rexec tty persist <session> on|off  Keep a session after detach, or restore orphan TTL
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
  --persistent       Keep a new PTY session after the local client detaches
  -h, --help         Show this help message

Leaving a PTY detaches the local client. The remote process keeps running.
Press Ctrl-] to detach. Exit the remote command to end the session.

Examples:
  rexec "nvidia-smi"
  rexec run python main.py --epochs 10
  rexec tty                          # Open the remote default login shell
  rexec tty codex                    # Interactive command (argv, not a shell string)
  rexec tty bash
  rexec tty --persistent bash
  rexec tty list
  rexec tty attach a1b2c3d4
  rexec tty kill a1b2c3d4
  rexec tty persist a1b2c3d4 on
  rexec tty -- list                  # Run a remote command named 'list'
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
    let persistent = false
    let help = false

    const tokens: string[] = []
    let has_double_dash = false
    const after_double_dash: string[] = []
    let subcommand_hint: ParsedCli["subcommand"] | null = null
    let pass_through = false
    let tty_verb_seen = false

    const finish = (fields: Pick<ParsedCli, "subcommand" | "tty_action" | "args">): ParsedCli => ({
        hub_url,
        token,
        cwd,
        timeout_ms,
        force,
        recursive,
        persistent,
        help,
        ...fields
    })

    for (let i = 0; i < raw_args.length; i++) {
        const arg = raw_args[i]
        if (has_double_dash) {
            after_double_dash.push(arg)
            continue
        }
        if (pass_through) {
            tokens.push(arg)
            continue
        }
        if (arg === "--") {
            has_double_dash = true
            continue
        }
        if (arg === "-h" || arg === "--help") {
            help = true
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
        } else if (arg === "--persistent") {
            persistent = true
        } else {
            tokens.push(arg)
            if (subcommand_hint === null) {
                subcommand_hint = resolve_subcommand_hint(arg)
                if (subcommand_hint === null) {
                    subcommand_hint = "run"
                    pass_through = true
                }
            } else if (subcommand_hint === "run") {
                pass_through = true
            } else if (subcommand_hint === "tty" && !tty_verb_seen) {
                if (is_tty_verb(arg)) {
                    tty_verb_seen = true
                } else {
                    pass_through = true
                }
            }
        }
    }

    const first_token = tokens[0]
    if (has_double_dash && first_token !== "tty") {
        return finish({
            subcommand: "run",
            tty_action: "run",
            args: [...tokens, ...after_double_dash]
        })
    }

    if (first_token === "status") {
        return finish({ subcommand: "status", tty_action: "run", args: tokens.slice(1) })
    }
    if (first_token === "forward") {
        return finish({ subcommand: "forward", tty_action: "run", args: tokens.slice(1) })
    }
    if (first_token === "tty") {
        return finish({ subcommand: "tty", ...classify_tty(tokens.slice(1), has_double_dash, after_double_dash) })
    }
    if (first_token === "pull") {
        return finish({ subcommand: "pull", tty_action: "run", args: tokens.slice(1) })
    }
    if (first_token === "push") {
        return finish({ subcommand: "push", tty_action: "run", args: tokens.slice(1) })
    }
    if (first_token === "run" || first_token === "exec") {
        return finish({ subcommand: "run", tty_action: "run", args: tokens.slice(1) })
    }

    return finish({ subcommand: "run", tty_action: "run", args: tokens })
}

function resolve_subcommand_hint(token: string): ParsedCli["subcommand"] | null {
    if (token === "status" || token === "forward" || token === "tty" || token === "pull" || token === "push") {
        return token
    }
    if (token === "run" || token === "exec") {
        return "run"
    }
    return null
}

function classify_tty(
    operands: string[],
    escaped: boolean,
    escaped_args: string[]
): Pick<ParsedCli, "tty_action" | "args"> {
    if (escaped && operands.length === 0) {
        return { tty_action: "run", args: escaped_args }
    }
    const verb = operands[0]
    if (verb && is_tty_verb(verb)) {
        return { tty_action: verb, args: [...operands.slice(1), ...escaped_args] }
    }
    return { tty_action: "run", args: [...operands, ...escaped_args] }
}

function is_tty_verb(value: string): value is Exclude<TtyAction, "run"> {
    return value === "list" || value === "attach" || value === "kill" || value === "persist"
}
