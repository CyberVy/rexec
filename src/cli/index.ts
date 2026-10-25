import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import type { ExecRequestPayload } from "@/protocol"

interface ParsedCli {
    subcommand: "status" | "pull" | "push" | "run"
    hub_url: string
    token: string
    cwd?: string
    timeout_ms: number
    force: boolean
    recursive: boolean
    args: string[]
}

function print_usage(): void {
    console.log(`rexec - Ultra-lightweight edge-routed remote execution engine

Usage:
  rexec [options] <command...>        Execute remote command (default fallback)
  rexec run [options] <command...>    Explicitly execute remote command
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
  rexec pull /content/loss.png ./loss.png
  rexec pull -r /content/sample_data ./sample_data
  rexec push ./dataset.zip /content/dataset.zip
  rexec push -r ./my_module /content/my_module
  rexec status
  rexec -- status       # Run a remote command named 'status'
  rexec -- pull foo     # Run a remote command named 'pull'
`)
}

function format_bytes(bytes: number): string {
    if (bytes <= 0) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function render_progress(label: string, transferred: number, total: number, start_time: number): void {
    const elapsed_s = (Date.now() - start_time) / 1000
    const speed = elapsed_s > 0 ? transferred / elapsed_s : 0
    const speed_str = `${format_bytes(speed)}/s`

    if (total > 0) {
        const percent = Math.min(100, Math.floor((transferred / total) * 100))
        const bar_length = 20
        const filled = Math.min(bar_length, Math.floor((percent / 100) * bar_length))
        const bar =
            "=".repeat(filled) + (filled < bar_length ? ">" : "") + " ".repeat(Math.max(0, bar_length - filled - 1))
        process.stderr.write(
            `\r[rexec] ${label}: [${bar}] ${percent}% (${format_bytes(transferred)} / ${format_bytes(total)}) ${speed_str} `
        )
    } else {
        process.stderr.write(`\r[rexec] ${label}: ${format_bytes(transferred)} (${speed_str}) `)
    }
}

function format_http_url(url_str: string): string {
    let http_url = url_str.trim()
    if (http_url.startsWith("wss://")) {
        http_url = "https://" + http_url.slice(6)
    } else if (http_url.startsWith("ws://")) {
        http_url = "http://" + http_url.slice(5)
    } else if (!http_url.startsWith("https://") && !http_url.startsWith("http://")) {
        http_url = "https://" + http_url
    }
    return http_url
}

function parse_cli_args(raw_args: string[]): ParsedCli {
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

async function check_status(hub_url: string, token: string): Promise<void> {
    const url = new URL(format_http_url(hub_url))
    url.pathname = "/health"
    if (token) {
        url.searchParams.set("token", token)
    }
    try {
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) {
            console.error(`Error querying hub: HTTP ${res.status} ${res.statusText}`)
            process.exit(1)
        }
        const data = (await res.json()) as {
            status: string
            agent_connected: boolean
            node_id?: string
            active_tasks: number
        }
        console.log(`Hub Status: ${data.status}`)
        if (data.node_id) {
            console.log(`Node ID: ${data.node_id}`)
        }
        console.log(`Agent Connected: ${data.agent_connected ? "YES (Online)" : "NO (Offline)"}`)
        console.log(`Active Tasks: ${data.active_tasks}`)
        process.exit(data.agent_connected ? 0 : 1)
    } catch (err) {
        console.error(`Failed to connect to Hub: ${(err as Error).message}`)
        process.exit(1)
    }
}

async function handle_pull(
    hub_url: string,
    token: string,
    remote_path: string,
    local_path: string | undefined,
    force: boolean,
    recursive: boolean
): Promise<void> {
    if (!remote_path) {
        console.error("Error: Missing remote file path. Usage: rexec pull <remote_path> [local_path]")
        process.exit(1)
    }

    const pull_url = new URL(format_http_url(hub_url))
    pull_url.pathname = "/file/pull"
    pull_url.searchParams.set("path", remote_path)
    pull_url.searchParams.set("token", token)
    if (recursive) {
        pull_url.searchParams.set("recursive", "1")
    }

    let res: Response
    try {
        res = await fetch(pull_url.toString(), {
            headers: {
                Authorization: `Bearer ${token}`
            }
        })
    } catch (err) {
        console.error(`[rexec pull] Connection failed: ${(err as Error).message}`)
        process.exit(1)
    }

    if (!res.ok) {
        const error_data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
        console.error(`[rexec pull error] ${error_data.error || res.statusText}`)
        process.exit(1)
    }

    if (!res.body) {
        console.error(`[rexec pull error] Empty response body`)
        process.exit(1)
    }

    const is_directory = res.headers.get("X-Is-Directory") === "1" || recursive
    if (is_directory) {
        const target_local = local_path || path.basename(remote_path)
        fs.mkdirSync(target_local, { recursive: true })

        const tar_proc = spawn("tar", ["-xf", "-", "-C", target_local], {
            stdio: ["pipe", "ignore", "pipe"]
        })
        let tar_stderr = ""
        tar_proc.stderr?.on("data", (chunk: Buffer) => {
            tar_stderr += chunk.toString("utf-8")
        })

        const start_time = Date.now()
        let transferred = 0
        const reader = res.body.getReader()
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                tar_proc.stdin.write(value)
                transferred += value.length
                if (process.stderr.isTTY) {
                    render_progress("Pulling directory", transferred, 0, start_time)
                }
            }
            await new Promise<void>((resolve, reject) => {
                tar_proc.stdin.end(() => {})
                tar_proc.on("close", (code) => {
                    if (code === 0) resolve()
                    else reject(new Error(tar_stderr || `tar exit code ${code}`))
                })
                tar_proc.on("error", reject)
            })
        } catch (err) {
            tar_proc.kill("SIGTERM")
            console.error(`\n[rexec pull error] Directory download failed: ${(err as Error).message}`)
            process.exit(1)
        }

        if (process.stderr.isTTY) {
            process.stderr.write("\r" + " ".repeat(80) + "\r")
        }
        console.log(`✓ Downloaded directory '${remote_path}' -> '${target_local}' (${format_bytes(transferred)})`)
        return
    }

    let target_local = local_path
    if (!target_local) {
        target_local = path.basename(remote_path)
    } else if (
        target_local.endsWith("/") ||
        target_local.endsWith("\\") ||
        (fs.existsSync(target_local) && fs.statSync(target_local).isDirectory())
    ) {
        target_local = path.join(target_local, path.basename(remote_path))
    }

    if (fs.existsSync(target_local) && !force) {
        console.error(`Error: Local file '${target_local}' already exists. Use -f or --force to overwrite.`)
        process.exit(1)
    }

    // Automatically ensure the destination parent directory exists
    const parent_dir = path.dirname(path.resolve(target_local))
    fs.mkdirSync(parent_dir, { recursive: true })

    const total_size = Number(res.headers.get("Content-Length") || 0)
    const write_stream = fs.createWriteStream(target_local)
    let stream_error: Error | null = null
    write_stream.on("error", (err) => {
        stream_error = err
    })

    const hash = crypto.createHash("sha256")
    const start_time = Date.now()
    let transferred = 0

    const reader = res.body.getReader()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (stream_error) throw stream_error
            hash.update(value)
            write_stream.write(value)
            transferred += value.length
            if (process.stderr.isTTY) {
                render_progress("Pulling", transferred, total_size, start_time)
            }
        }
        await new Promise<void>((resolve, reject) => {
            if (stream_error) return reject(stream_error)
            write_stream.on("error", reject)
            write_stream.end(() => {
                if (stream_error) reject(stream_error)
                else resolve()
            })
        })
    } catch (err) {
        write_stream.destroy()
        try {
            fs.unlinkSync(target_local)
        } catch {
            // Ignore
        }
        console.error(`\n[rexec pull error] Download interrupted: ${(err as Error).message}`)
        process.exit(1)
    }

    if (process.stderr.isTTY) {
        process.stderr.write("\r" + " ".repeat(80) + "\r")
    }

    const sha256 = hash.digest("hex")
    console.log(
        `✓ Downloaded '${remote_path}' -> '${target_local}' (${format_bytes(transferred)}, sha256: ${sha256.slice(0, 12)}...)`
    )
}

async function handle_push(
    hub_url: string,
    token: string,
    local_path: string,
    remote_path: string | undefined,
    recursive: boolean
): Promise<void> {
    if (!local_path) {
        console.error("Error: Missing local file path. Usage: rexec push <local_path> [remote_path]")
        process.exit(1)
    }

    if (!fs.existsSync(local_path)) {
        console.error(`Error: Local file or directory '${local_path}' does not exist.`)
        process.exit(1)
    }

    const stat = fs.statSync(local_path)
    if (stat.isDirectory()) {
        if (!recursive) {
            console.error(`Error: '${local_path}' is a directory. Use -r or --recursive to transfer directories.`)
            process.exit(1)
        }

        let target_remote = remote_path || path.basename(local_path)
        if (target_remote.endsWith("/") || target_remote.endsWith("\\")) {
            target_remote = path.posix.join(target_remote, path.basename(local_path))
        }

        const push_url = new URL(format_http_url(hub_url))
        push_url.pathname = "/file/push"
        push_url.searchParams.set("path", target_remote)
        push_url.searchParams.set("token", token)
        push_url.searchParams.set("recursive", "1")

        const tar_proc = spawn("tar", ["-cf", "-", "-C", local_path, "."], {
            stdio: ["ignore", "pipe", "pipe"]
        })
        let tar_stderr = ""
        tar_proc.stderr?.on("data", (chunk: Buffer) => {
            tar_stderr += chunk.toString("utf-8")
        })

        const start_time = Date.now()
        let transferred = 0
        const tracker = new Transform({
            transform(chunk, _encoding, callback) {
                transferred += chunk.length
                if (process.stderr.isTTY) {
                    render_progress("Pushing directory", transferred, 0, start_time)
                }
                callback(null, chunk)
            }
        })
        const stream = tar_proc.stdout.pipe(tracker)

        let res: Response
        try {
            res = await fetch(push_url.toString(), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/octet-stream"
                },
                body: Readable.toWeb(stream) as unknown as BodyInit,
                // @ts-expect-error Node fetch requires duplex: 'half' for streaming request bodies
                duplex: "half"
            })
        } catch (err) {
            tar_proc.kill("SIGTERM")
            console.error(`\n[rexec push] Upload failed: ${(err as Error).message}`)
            process.exit(1)
        }

        if (process.stderr.isTTY) {
            process.stderr.write("\r" + " ".repeat(80) + "\r")
        }

        if (!res.ok) {
            const error_data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
            console.error(`[rexec push error] ${error_data.error || res.statusText}`)
            process.exit(1)
        }

        console.log(`✓ Pushed directory '${local_path}' -> '${target_remote}' (${format_bytes(transferred)})`)
        return
    }

    let target_remote = remote_path || path.basename(local_path)
    if (target_remote.endsWith("/") || target_remote.endsWith("\\")) {
        target_remote = path.posix.join(target_remote, path.basename(local_path))
    }
    const push_url = new URL(format_http_url(hub_url))
    push_url.pathname = "/file/push"
    push_url.searchParams.set("path", target_remote)
    push_url.searchParams.set("token", token)
    push_url.searchParams.set("size", String(stat.size))

    const hash = crypto.createHash("sha256")
    const start_time = Date.now()
    let transferred = 0

    const file_stream = fs.createReadStream(local_path)
    const tracker = new Transform({
        transform(chunk, _encoding, callback) {
            transferred += chunk.length
            hash.update(chunk)
            if (process.stderr.isTTY) {
                render_progress("Pushing", transferred, stat.size, start_time)
            }
            callback(null, chunk)
        }
    })

    const stream = file_stream.pipe(tracker)

    let res: Response
    try {
        res = await fetch(push_url.toString(), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/octet-stream",
                "Content-Length": String(stat.size)
            },
            body: Readable.toWeb(stream) as unknown as BodyInit,
            // @ts-expect-error Node fetch requires duplex: 'half' for streaming request bodies
            duplex: "half"
        })
    } catch (err) {
        console.error(`\n[rexec push] Upload failed: ${(err as Error).message}`)
        process.exit(1)
    }

    if (process.stderr.isTTY) {
        process.stderr.write("\r" + " ".repeat(80) + "\r")
    }

    if (!res.ok) {
        const error_data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
        console.error(`[rexec push error] ${error_data.error || res.statusText}`)
        process.exit(1)
    }

    const result = (await res.json().catch(() => ({}))) as { sha256?: string }
    const local_sha256 = hash.digest("hex")
    const remote_sha256 = result.sha256 || local_sha256
    console.log(
        `✓ Pushed '${local_path}' -> '${target_remote}' (${format_bytes(stat.size)}, sha256: ${remote_sha256.slice(0, 12)}...)`
    )
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

async function handle_exec(
    hub_url: string,
    token: string,
    command_parts: string[],
    cwd?: string,
    timeout_ms = 300000
): Promise<void> {
    const cmd = command_parts.join(" ").trim()
    if (!cmd) {
        console.error("Error: No command provided to execute.")
        process.exit(1)
    }

    const exec_url = new URL(format_http_url(hub_url))
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

async function main(): Promise<void> {
    const raw_args = process.argv.slice(2)
    if (raw_args.length === 0 || raw_args.includes("-h") || raw_args.includes("--help")) {
        print_usage()
        process.exit(0)
    }

    const parsed = parse_cli_args(raw_args)

    if (!parsed.hub_url) {
        console.error("Error: Missing Hub URL. Provide --hub <url> or set REXEC_HUB env var.")
        process.exit(1)
    }

    if (!parsed.token) {
        console.error(
            "Error: Missing Auth Token. Provide --token <secret> (printed when rexec-agent starts) or set REXEC_TOKEN env var."
        )
        process.exit(1)
    }

    if (parsed.subcommand === "status") {
        await check_status(parsed.hub_url, parsed.token)
        return
    }

    if (parsed.subcommand === "pull") {
        await handle_pull(parsed.hub_url, parsed.token, parsed.args[0], parsed.args[1], parsed.force, parsed.recursive)
        return
    }

    if (parsed.subcommand === "push") {
        await handle_push(parsed.hub_url, parsed.token, parsed.args[0], parsed.args[1], parsed.recursive)
        return
    }

    // Default or "run" subcommand
    await handle_exec(parsed.hub_url, parsed.token, parsed.args, parsed.cwd, parsed.timeout_ms)
}

main().catch((err) => {
    console.error(`[rexec fatal]`, err)
    process.exit(1)
})
