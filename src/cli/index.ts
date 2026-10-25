import type { ExecRequestPayload } from "@/protocol"

function print_usage(): void {
    console.log(`rexec - Ultra-lightweight edge-routed remote execution engine

Usage:
  rexec [options] <command...>
  rexec status

Options:
  --hub <url>        Hub URL (or via REXEC_HUB env var)
  --token <secret>   Auth Token (or via REXEC_TOKEN env var)
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

    let hub_url = process.env.REXEC_HUB || ""
    let token = process.env.REXEC_TOKEN || ""
    let cwd: string | undefined
    let timeout_ms = 300000

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
        console.error("Error: Missing Hub URL. Provide --hub <url> or set REXEC_HUB env var.")
        process.exit(1)
    }

    if (!token) {
        console.error("Error: Missing Auth Token. Provide --token <secret> or set REXEC_TOKEN env var.")
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
    let current_event = "chunk"

    const process_line = (raw_line: string): boolean => {
        let line = raw_line
        if (line.endsWith("\r")) {
            line = line.slice(0, -1)
        }
        if (line.startsWith("event: ")) {
            current_event = line.slice(7).trim()
        } else if (line.startsWith("data: ")) {
            const data_raw = line.slice(6)
            const should_exit = handle_sse_event(current_event, data_raw)
            current_event = "chunk"
            if (should_exit) return true
        }
        return false
    }

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                buffer += decoder.decode()
                if (buffer.length > 0) {
                    const lines = buffer.split("\n")
                    for (const line of lines) {
                        process_line(line)
                    }
                }
                break
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            let should_exit = false
            for (const line of lines) {
                if (process_line(line)) {
                    should_exit = true
                    break
                }
            }
            if (should_exit) {
                await reader.cancel().catch(() => {})
                break
            }
        }
    } catch (err) {
        if (!is_interrupted) {
            console.error(`\n[rexec] Stream error: ${(err as Error).message}`)
            process.exit(1)
        }
    }
}

function handle_sse_event(event: string, data_raw: string): boolean {
    try {
        const parsed = JSON.parse(data_raw)
        if (event === "chunk") {
            if (parsed.stream === "stdout") {
                process.stdout.write(parsed.data)
            } else if (parsed.stream === "stderr") {
                process.stderr.write(parsed.data)
            }
        } else if (event === "exit") {
            process.exitCode = parsed.code ?? 0
            return true
        } else if (event === "error") {
            process.stderr.write(`[rexec error] ${parsed.message}\n`)
            process.exitCode = 1
            return true
        }
    } catch {
        if (event === "chunk") {
            process.stdout.write(data_raw)
        }
    }
    return false
}

main().catch((err) => {
    console.error(`[rexec fatal]`, err)
    process.exit(1)
})
