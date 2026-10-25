import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import { stripVTControlCharacters } from "node:util"

const script_dir = path.dirname(fileURLToPath(import.meta.url))
const repo_root = path.resolve(script_dir, "../..")

const DEBUG_DIR = path.join(repo_root, ".debug")
const CONFIG_FILE = path.join(DEBUG_DIR, "config.json")
const WORKER_LOG_FILE = path.join(DEBUG_DIR, "worker.jsonl")
const AGENT_LOG_FILE = path.join(DEBUG_DIR, "agent.jsonl")
const AGENT_BUNDLE = path.join(repo_root, "dist", "rexec-agent.mjs")
const DEFAULT_PORT = 8787

export const DEBUG_TOKEN = "rexec-debug-token"

interface ServeOptions {
    port: number
    ip: string
}

function parse_args(): ServeOptions {
    const args = process.argv.slice(2)
    let port = DEFAULT_PORT
    let ip = "127.0.0.1"

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "--port" && i + 1 < args.length) {
            port = Number.parseInt(args[++i], 10) || DEFAULT_PORT
        } else if (arg === "--ip" && i + 1 < args.length) {
            ip = args[++i]
        }
    }

    return { port, ip }
}

async function wait_for_hub_ready(url: string, timeout_ms = 15000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeout_ms) {
        try {
            const res = await fetch(`${url}/health`)
            if (res.ok) return true
        } catch {
            // Wait and retry
        }
        await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return false
}

async function run(): Promise<void> {
    const options = parse_args()

    fs.mkdirSync(DEBUG_DIR, { recursive: true })

    if (!fs.existsSync(AGENT_BUNDLE)) {
        console.log("[debug:serve] Building agent bundle first...")
        const build_proc = spawn("npm", ["run", "build:agent"], { cwd: repo_root, stdio: "inherit" })
        await new Promise<void>((resolve, reject) => {
            build_proc.on("close", (code) => {
                if (code === 0) resolve()
                else reject(new Error(`Failed to build agent bundle (exit code ${code})`))
            })
        })
    }

    const worker_log_stream = fs.createWriteStream(WORKER_LOG_FILE, { flags: "a" })
    const write_worker_log = (stream: string, line: string) => {
        worker_log_stream.write(
            `${JSON.stringify({ time: new Date().toISOString(), stream, line: stripVTControlCharacters(line) })}\n`
        )
    }

    const agent_log_stream = fs.createWriteStream(AGENT_LOG_FILE, { flags: "a" })
    const write_agent_log = (stream: string, line: string) => {
        agent_log_stream.write(
            `${JSON.stringify({ time: new Date().toISOString(), stream, line: stripVTControlCharacters(line) })}\n`
        )
    }

    console.log(`[debug:serve] Starting Cloudflare Worker Hub on http://${options.ip}:${options.port}...`)

    const wrangler_child = spawn(
        "npx",
        ["wrangler", "dev", "--ip", options.ip, "--port", String(options.port), "--show-interactive-dev-session=false"],
        {
            cwd: repo_root,
            env: { ...process.env, FORCE_COLOR: "0" }
        }
    )

    pipe_logs(wrangler_child, "[worker]", write_worker_log)

    const hub_http_url = `http://${options.ip}:${options.port}`
    const is_ready = await wait_for_hub_ready(hub_http_url)

    if (!is_ready) {
        wrangler_child.kill("SIGTERM")
        throw new Error(`Worker failed to become ready at ${hub_http_url} within 15s`)
    }

    console.log(`[debug:serve] Hub is ready at ${hub_http_url}! Starting local Agent...`)

    const agent_child = spawn(
        "node",
        [
            AGENT_BUNDLE,
            "--hub",
            `ws://${options.ip}:${options.port}`,
            "--token",
            DEBUG_TOKEN,
            "--node-id",
            "local-debug-agent",
            "--workspace",
            path.join(DEBUG_DIR, "workspace")
        ],
        {
            cwd: repo_root,
            env: { ...process.env, FORCE_COLOR: "0" }
        }
    )

    pipe_logs(agent_child, "[agent]", write_agent_log)

    fs.mkdirSync(path.join(DEBUG_DIR, "workspace"), { recursive: true })

    const config_payload = {
        hub_url: hub_http_url
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config_payload, null, 2) + "\n")

    console.log(`\n======================================================`)
    console.log(`🚀 [rexec debug channel ready]`)
    console.log(`   Hub URL   : ${hub_http_url}`)
    console.log(`   Token     : ${DEBUG_TOKEN}`)
    console.log(`   Config    : ${CONFIG_FILE}`)
    console.log(`   Run Tests : npm run debug:test`)
    console.log(`======================================================\n`)

    const cleanup = () => {
        console.log("\n[debug:serve] Stopping worker and agent...")
        fs.rmSync(CONFIG_FILE, { force: true })
        try {
            agent_child.kill("SIGTERM")
        } catch {}
        try {
            wrangler_child.kill("SIGTERM")
        } catch {}
        worker_log_stream.end()
        agent_log_stream.end()
        process.exit(0)
    }

    process.on("SIGINT", cleanup)
    process.on("SIGTERM", cleanup)
}

function pipe_logs(child: ChildProcess, prefix: string, log_writer: (stream: string, line: string) => void): void {
    if (child.stdout) {
        readline.createInterface({ input: child.stdout }).on("line", (line) => {
            console.log(`${prefix} ${line}`)
            log_writer("stdout", line)
        })
    }
    if (child.stderr) {
        readline.createInterface({ input: child.stderr }).on("line", (line) => {
            console.error(`${prefix} ${line}`)
            log_writer("stderr", line)
        })
    }
}

run().catch((err) => {
    console.error("[debug:serve error]", err)
    process.exit(1)
})
