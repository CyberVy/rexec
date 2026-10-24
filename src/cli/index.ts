import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ExecRequestPayload } from "@/protocol"

interface CliConfig {
    hub_url: string
    token: string
    cwd?: string
    timeout_ms?: number
}

function load_config_file(): Partial<CliConfig> {
    const locations = [
        path.join(process.cwd(), ".rexec.json"),
        path.join(os.homedir(), ".rexec.json"),
        path.join(os.homedir(), ".config", "rexec", "config.json")
    ]

    for (const loc of locations) {
        if (fs.existsSync(loc)) {
            try {
                const content = fs.readFileSync(loc, "utf-8")
                return JSON.parse(content) as Partial<CliConfig>
            } catch {
                // Ignore parse errors from invalid config files
            }
        }
    }
    return {}
}

function print_usage(): void {
    console.log(`rexec - Ultra-lightweight edge-routed remote execution engine

Usage:
  rexec [options] <command...>
  rexec status

Options:
  --hub <url>        Hub URL (or via REXEC_HUB env var or ~/.rexec.json)
  --token <secret>   Auth Token (or via REXEC_TOKEN env var or ~/.rexec.json)
  --cwd <dir>        Remote working directory relative to remote workspace
  --timeout <ms>     Command execution timeout in milliseconds (default: 300000)
  -h, --help         Show this help message

Examples:
  rexec "nvidia-smi"
  rexec python main.py --port 8000
  rexec --cwd backend "pytest tests/"
  rexec status
`)
}

async function check_status(hub_url: string, token: string): Promise<void> {
    const url = new URL(hub_url)
    url.pathname = "/health"
    try {
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) {
            console.error(`Error querying hub: HTTP ${res.status} ${res.statusText}`)
            process.exit(1)
        }
        const data = (await res.json()) as { status: string; agent_connected: boolean; active_tasks: number }
        console.log(`Hub Status: ${data.status}`)
        console.log(`Agent Connected: ${data.agent_connected ? "YES (Online)" : "NO (Offline)"}`)
        console.log(`Active Tasks: ${data.active_tasks}`)
        process.exit(data.agent_connected ? 0 : 1)
    } catch (err) {
        console.error(`Failed to connect to Hub: ${(err as Error).message}`)
        process.exit(1)
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
        print_usage()
        process.exit(0)
    }

    const file_config = load_config_file()

    let hub_url = process.env.REXEC_HUB || file_config.hub_url || ""
    let token = process.env.REXEC_TOKEN || file_config.token || ""
    let cwd = file_config.cwd
    let timeout_ms = file_config.timeout_ms || 300000

    const command_parts: string[] = []

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "--hub" && i + 1 < args.length) {
            hub_url = args[++i]
        } else if (arg === "--token" && i + 1 < args.length) {
            token = args[++i]
        } else if (arg === "--cwd" && i + 1 < args.length) {
            cwd = args[++i]
        } else if (arg === "--timeout" && i + 1 < args.length) {
            timeout_ms = Number.parseInt(args[++i], 10) || timeout_ms
        } else if (arg === "status") {
            if (!hub_url || !token) {
                console.error("Error: --hub and --token must be provided or configured to check status.")
                process.exit(1)
            }
            await check_status(hub_url, token)
            return
        } else if (arg === "--") {
            command_parts.push(...args.slice(i + 1))
            break
        } else {
            command_parts.push(arg)
        }
    }

    if (!hub_url) {
        console.error("Error: Missing Hub URL. Provide --hub <url>, REXEC_HUB env var, or ~/.rexec.json")
        process.exit(1)
    }

    if (!token) {
        console.error("Error: Missing Auth Token. Provide --token <secret>, REXEC_TOKEN env var, or ~/.rexec.json")
        process.exit(1)
    }

    const cmd = command_parts.join(" ").trim()
    if (!cmd) {
        console.error("Error: No command provided to execute.")
        process.exit(1)
    }

    let http_url = hub_url.trim()
    if (http_url.startsWith("wss://")) {
        http_url = "https://" + http_url.slice(6)
    } else if (http_url.startsWith("ws://")) {
        http_url = "http://" + http_url.slice(5)
    } else if (!http_url.startsWith("https://") && !http_url.startsWith("http://")) {
        http_url = "https://" + http_url
    }

    const exec_url = new URL(http_url)
    exec_url.pathname = "/exec"

    const payload: ExecRequestPayload = {
        cmd,
        cwd,
        timeout_ms
    }

    const abort_controller = new AbortController()
    let is_interrupted = false

    process.on("SIGINT", () => {
        is_interrupted = true
        abort_controller.abort()
        process.stderr.write("\n[rexec] Interrupt received, terminating remote task...\n")
        setTimeout(() => process.exit(130), 1000)
    })

    let res: Response
    try {
        res = await fetch(exec_url.toString(), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: abort_controller.signal
        })
    } catch (err) {
        if (is_interrupted) return
        console.error(`[rexec] Connection failed: ${(err as Error).message}`)
        process.exit(1)
    }

    if (!res.ok) {
        const error_text = await res.text()
        console.error(`[rexec] Server returned error ${res.status}: ${error_text}`)
        process.exit(1)
    }

    if (!res.body) {
        console.error(`[rexec] No response body received from server`)
        process.exit(1)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            let current_event = ""
            for (const line of lines) {
                if (line.startsWith("event: ")) {
                    current_event = line.slice(7).trim()
                } else if (line.startsWith("data: ")) {
                    const data_raw = line.slice(6)
                    handle_sse_event(current_event, data_raw)
                    current_event = ""
                }
            }
        }
    } catch (err) {
        if (!is_interrupted) {
            console.error(`\n[rexec] Stream error: ${(err as Error).message}`)
            process.exit(1)
        }
    }
}

function handle_sse_event(event: string, data_raw: string): void {
    try {
        const parsed = JSON.parse(data_raw)
        if (event === "chunk") {
            if (parsed.stream === "stdout") {
                process.stdout.write(parsed.data)
            } else if (parsed.stream === "stderr") {
                process.stderr.write(parsed.data)
            }
        } else if (event === "exit") {
            process.exit(parsed.code ?? 0)
        } else if (event === "error") {
            process.stderr.write(`[rexec error] ${parsed.message}\n`)
            process.exit(1)
        }
    } catch {
        // Fallback for plain text data
        if (event === "chunk") {
            process.stdout.write(data_raw)
        }
    }
}

main().catch((err) => {
    console.error(`[rexec fatal]`, err)
    process.exit(1)
})
