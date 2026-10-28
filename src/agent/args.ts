import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"
import type { AgentOptions } from "./types"

export function print_usage(): void {
    console.log(`rexec-agent - Remote worker node daemon for rexec

Usage:
  rexec-agent [options]

Options:
  --hub <url>          Hub WebSocket/HTTP URL (or via REXEC_HUB env var)
  --token <secret>     Auth Token (auto-generated if omitted, or via REXEC_TOKEN env var)
  --workspace <dir>    Base workspace directory (default: current working directory)
  --node-id <id>       Worker node identifier (default: hostname)
  -h, --help           Show this help message

Environment (milliseconds, 0 disables that check):
  REXEC_HEARTBEAT_INTERVAL_MS   Application ping interval (default 5000)
  REXEC_HEARTBEAT_TIMEOUT_MS    Reconnect when no hub frame arrives (default 15000,
                                or 3x the ping interval when only the interval is set)
  REXEC_RECONNECT_DELAY_MS      Delay before the next connection attempt (default 3000)
  REXEC_CONNECT_TIMEOUT_MS      Handshake deadline for every attempt (default 10000)

A half-open proxy socket can stay OPEN after the Hub has dropped the session.
The agent treats an unanswered application ping as dead: if no Hub frame arrives
within the idle timeout, or the socket sticks in CLOSING, it reconnects with the
same hub, token, workspace, and node id. Hub GET /health is for callers and ops;
the agent does not poll it.

Examples:
  rexec-agent --hub wss://hub.example.com
  rexec-agent --hub http://127.0.0.1:8787 --token my-custom-secret --workspace ./workspace
`)
}

export function parse_args(): AgentOptions {
    const args = process.argv.slice(2)
    if (args.includes("-h") || args.includes("--help")) {
        print_usage()
        process.exit(0)
    }

    let hub_url = ""
    let token = ""
    let workspace = process.cwd()
    let node_id = os.hostname()

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "--hub" && i + 1 < args.length) {
            hub_url = args[++i]
        } else if (arg.startsWith("--hub=")) {
            hub_url = arg.slice("--hub=".length)
        } else if (arg === "--token" && i + 1 < args.length) {
            token = args[++i]
        } else if (arg.startsWith("--token=")) {
            token = arg.slice("--token=".length)
        } else if (arg === "--workspace" && i + 1 < args.length) {
            workspace = path.resolve(args[++i])
        } else if (arg.startsWith("--workspace=")) {
            workspace = path.resolve(arg.slice("--workspace=".length))
        } else if (arg === "--node-id" && i + 1 < args.length) {
            node_id = args[++i]
        } else if (arg.startsWith("--node-id=")) {
            node_id = arg.slice("--node-id=".length)
        }
    }

    hub_url = hub_url || process.env.REXEC_HUB || ""
    token = token || process.env.REXEC_TOKEN || ""

    if (!hub_url) {
        console.error("Error: Missing Hub URL. Provide --hub <url> or set REXEC_HUB env var.")
        process.exit(1)
    }

    let is_auto_generated = false
    if (!token) {
        token = `rexec_sec_${crypto.randomBytes(16).toString("hex")}`
        is_auto_generated = true
    }

    return { hub_url, token, workspace, node_id, is_auto_generated }
}
