import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const script_dir = path.dirname(fileURLToPath(import.meta.url))
export const repo_root = path.resolve(script_dir, "../../..")
export const DEBUG_DIR = path.join(repo_root, ".debug")
export const CONFIG_FILE = path.join(DEBUG_DIR, "config.json")
export const HISTORY_FILE = path.join(DEBUG_DIR, "history.jsonl")
export const CLI_BIN = path.join(repo_root, "dist", "rexec.mjs")
export const DEBUG_TOKEN = "rexec-debug-token"

export interface DebugConfig {
    hub_url: string
}

export interface ExecResult {
    stdout: string
    stderr: string
    exit_code: number
    duration_ms: number
}

export interface TestRecord {
    test_name: string
    command: string
    verdict: "PASS" | "FAIL"
    exit_code: number
    duration_ms: number
    error_message?: string
}

export function read_debug_config(): DebugConfig {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error(
            `Debug config not found at ${CONFIG_FILE}.\nMake sure you have started the debug server first:\n  npm run debug:serve`
        )
    }
    const content = fs.readFileSync(CONFIG_FILE, "utf-8")
    return JSON.parse(content) as DebugConfig
}

export function record_history(record: TestRecord): void {
    fs.mkdirSync(DEBUG_DIR, { recursive: true })
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...record }) + "\n"
    fs.appendFileSync(HISTORY_FILE, line)
}

export async function run_rexec(
    command_to_run: string,
    options: {
        cwd?: string
        timeout_ms?: number
        extra_env?: Record<string, string>
        abort_after_ms?: number
    } = {}
): Promise<ExecResult> {
    const config = read_debug_config()
    const start_time = Date.now()

    const cli_args = [CLI_BIN, "--hub", config.hub_url, "--token", DEBUG_TOKEN]

    if (options.cwd) {
        cli_args.push("--cwd", options.cwd)
    }
    if (options.timeout_ms) {
        cli_args.push("--timeout", String(options.timeout_ms))
    }

    cli_args.push(command_to_run)

    const child = spawn("node", cli_args, {
        cwd: repo_root,
        env: { ...process.env, ...options.extra_env }
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8")
    })

    if (options.abort_after_ms && options.abort_after_ms > 0) {
        setTimeout(() => {
            child.kill("SIGINT")
        }, options.abort_after_ms)
    }

    const exit_code = await new Promise<number>((resolve) => {
        child.on("close", (code) => {
            resolve(code ?? 0)
        })
    })

    const duration_ms = Date.now() - start_time
    return { stdout, stderr, exit_code, duration_ms }
}

export function print_verdict(test_name: string, passed: boolean, details?: string): void {
    if (passed) {
        console.log(`[PASS] ${test_name}`)
    } else {
        console.error(`[FAIL] ${test_name}${details ? ` -> ${details}` : ""}`)
    }
}
