import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { RexecCaller } from "@/caller"
import { create_node_sink, create_node_source } from "@/file/adapters/node"
import { parse_cli_args, print_usage } from "./args"
import { run_port_forward } from "./forward"
import { format_bytes, render_progress } from "./ui"

async function handle_status(caller: RexecCaller): Promise<void> {
    try {
        const data = await caller.get_status()
        console.log(`Hub Status: ${data.status}`)
        if (data.node_id) {
            console.log(`Node ID: ${data.node_id}`)
        }
        console.log(`Agent Connected: ${data.agent_connected ? "YES (Online)" : "NO (Offline)"}`)
        if (typeof data.last_seen_age_ms === "number") {
            console.log(`Last Seen: ${Math.max(0, Math.round(data.last_seen_age_ms / 1000))}s ago`)
        }
        console.log(`Active Tasks: ${data.active_tasks}`)
        process.exit(data.agent_connected ? 0 : 1)
    } catch (err) {
        console.error(`Failed to connect to Hub: ${(err as Error).message}`)
        process.exit(1)
    }
}

async function handle_pull(
    caller: RexecCaller,
    remote_path: string,
    local_path: string | undefined,
    force: boolean,
    recursive: boolean
): Promise<void> {
    if (!remote_path) {
        console.error("Error: Missing remote file path. Usage: rexec pull <remote_path> [local_path]")
        process.exit(1)
    }

    let target_local = local_path || path.basename(remote_path)
    if (!recursive) {
        if (
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
    }

    const sink = create_node_sink(target_local, recursive)
    const hash = crypto.createHash("sha256")

    try {
        const res = await caller.pull(remote_path, sink, {
            recursive,
            on_progress(info, chunk) {
                hash.update(chunk)
                render_progress(recursive ? "Pulling directory" : "Pulling", info)
            }
        })

        if (process.stderr.isTTY) {
            process.stderr.write("\r" + " ".repeat(80) + "\r")
        }

        if (res.is_directory) {
            console.log(
                `✓ Downloaded directory '${remote_path}' -> '${target_local}' (${format_bytes(res.transferred)})`
            )
        } else {
            const sha256 = hash.digest("hex")
            console.log(
                `✓ Downloaded '${remote_path}' -> '${target_local}' (${format_bytes(res.transferred)}, sha256: ${sha256.slice(0, 12)}...)`
            )
        }
    } catch (err) {
        sink.cleanup?.()
        if (process.stderr.isTTY) {
            process.stderr.write("\r" + " ".repeat(80) + "\r")
        }
        console.error(`[rexec pull error] ${(err as Error).message}`)
        process.exit(1)
    }
}

async function handle_push(
    caller: RexecCaller,
    local_path: string,
    remote_path: string | undefined,
    recursive: boolean
): Promise<void> {
    if (!local_path) {
        console.error("Error: Missing local file path. Usage: rexec push <local_path> [remote_path]")
        process.exit(1)
    }

    let source: ReturnType<typeof create_node_source>
    try {
        source = create_node_source(local_path, recursive)
    } catch (err) {
        console.error(`Error: ${(err as Error).message}`)
        process.exit(1)
    }

    let target_remote = remote_path || path.basename(local_path)
    if (target_remote.endsWith("/") || target_remote.endsWith("\\")) {
        target_remote = path.posix.join(target_remote, path.basename(local_path))
    }

    const hash = crypto.createHash("sha256")
    try {
        const res = await caller.push(source, target_remote, {
            on_progress(info, chunk) {
                hash.update(chunk)
                render_progress(source.is_directory ? "Pushing directory" : "Pushing", info)
            }
        })

        if (process.stderr.isTTY) {
            process.stderr.write("\r" + " ".repeat(80) + "\r")
        }

        if (res.is_directory) {
            console.log(`✓ Pushed directory '${local_path}' -> '${target_remote}' (${format_bytes(res.transferred)})`)
        } else {
            const local_sha256 = hash.digest("hex")
            const sha256 = res.sha256 || local_sha256
            console.log(
                `✓ Pushed '${local_path}' -> '${target_remote}' (${format_bytes(res.transferred)}, sha256: ${sha256.slice(0, 12)}...)`
            )
        }
    } catch (err) {
        source.cleanup?.()
        if (process.stderr.isTTY) {
            process.stderr.write("\r" + " ".repeat(80) + "\r")
        }
        console.error(`[rexec push error] ${(err as Error).message}`)
        process.exit(1)
    }
}

async function handle_exec(
    caller: RexecCaller,
    command_parts: string[],
    cwd?: string,
    timeout_ms = 300000
): Promise<void> {
    const cmd = command_parts.join(" ").trim()
    if (!cmd) {
        console.error("Error: No command provided to execute.")
        process.exit(1)
    }

    const abort_controller = new AbortController()
    let is_interrupted = false

    process.on("SIGINT", () => {
        is_interrupted = true
        abort_controller.abort()
        process.stderr.write("\n[rexec] Interrupt received, terminating remote task...\n")
        setTimeout(() => process.exit(130), 1000)
    })

    try {
        const exit_code = await caller.exec(
            { cmd, cwd, timeout_ms, signal: abort_controller.signal },
            (stream, data) => {
                if (stream === "stdout") process.stdout.write(data)
                else process.stderr.write(data)
            }
        )
        process.exitCode = exit_code
    } catch (err) {
        if (!is_interrupted) {
            console.error(`\n[rexec error] ${(err as Error).message}`)
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

    const caller = new RexecCaller({ hub_url: parsed.hub_url, token: parsed.token })

    if (parsed.subcommand === "status") {
        await handle_status(caller)
        return
    }

    if (parsed.subcommand === "pull") {
        await handle_pull(caller, parsed.args[0], parsed.args[1], parsed.force, parsed.recursive)
        return
    }

    if (parsed.subcommand === "push") {
        await handle_push(caller, parsed.args[0], parsed.args[1], parsed.recursive)
        return
    }

    if (parsed.subcommand === "forward") {
        await handle_forward(caller, parsed.args[0], parsed.args[1])
        return
    }

    // Default or "run" subcommand
    await handle_exec(caller, parsed.args, parsed.cwd, parsed.timeout_ms)
}

async function handle_forward(caller: RexecCaller, port_arg: string | undefined, second_arg?: string): Promise<void> {
    if (!port_arg) {
        console.error("Error: Missing port configuration. Usage: rexec forward [local_port:]remote_port")
        process.exit(1)
    }

    let local_port: number
    let remote_port: number

    if (port_arg.includes(":")) {
        const parts = port_arg.split(":")
        local_port = Number.parseInt(parts[0], 10)
        remote_port = Number.parseInt(parts[1], 10)
    } else if (second_arg) {
        local_port = Number.parseInt(port_arg, 10)
        remote_port = Number.parseInt(second_arg, 10)
    } else {
        local_port = Number.parseInt(port_arg, 10)
        remote_port = local_port
    }

    if (!local_port || !remote_port || Number.isNaN(local_port) || Number.isNaN(remote_port)) {
        console.error(`Error: Invalid port numbers: local=${local_port}, remote=${remote_port}`)
        process.exit(1)
    }

    try {
        await run_port_forward(caller, local_port, remote_port)
    } catch (err) {
        console.error(`[rexec forward error] ${(err as Error).message}`)
        process.exit(1)
    }
}

main().catch((err) => {
    console.error(`[rexec fatal]`, err)
    process.exit(1)
})
