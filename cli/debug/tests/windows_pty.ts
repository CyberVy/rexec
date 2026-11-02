import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PtyManager } from "@/agent/pty_manager"
import type { AgentToHubMessage } from "@/protocol"
import { decode_pty_frame } from "@/transport"

const MARKER = "rexec-pty-ok"
const repo_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

async function run(): Promise<void> {
    if (process.platform !== "win32") {
        if (process.env.REXEC_REQUIRE_WINDOWS_PTY === "1") {
            throw new Error("Windows ConPTY test was required, but this runner is not Windows")
        }
        console.log("[test:windows-pty] skipped: this machine is not Windows")
        return
    }

    const platform_key = `${process.platform}-${process.arch}`
    const vendor_dir = path.join(repo_root, "vendor", "node-pty", "1.2.0-beta.17", platform_key)
    if (!fs.existsSync(path.join(vendor_dir, "conpty.node"))) {
        throw new Error(`Missing ConPTY prebuild for ${platform_key} at ${vendor_dir}`)
    }

    const cache_dir = fs.mkdtempSync(path.join(os.tmpdir(), "rexec-windows-pty-"))
    fs.cpSync(vendor_dir, cache_dir, { recursive: true })
    process.env.REXEC_PTY_CACHE = cache_dir

    const session_id = "windows-pty-ci"
    const chunks: Buffer[] = []
    const messages: AgentToHubMessage[] = []
    const manager = new PtyManager("http://127.0.0.1")

    try {
        manager.open(
            {
                type: "pty:open",
                session_id,
                file: "/bin/bash",
                cols: 100,
                rows: 30,
                term: "xterm-256color"
            },
            os.tmpdir(),
            (message) => {
                messages.push(message)
            },
            (frame) => {
                const decoded = decode_pty_frame(frame)
                if (decoded) chunks.push(Buffer.from(decoded.payload))
            }
        )

        await wait_for(
            () => shell_error(messages),
            () => has_prompt(chunks),
            15000,
            "shell prompt",
            chunks
        )
        const command = manager.list().find((session) => session.session_id === session_id)?.command ?? ""
        if (!command.toLowerCase().includes("cmd.exe")) {
            throw new Error(`Expected /bin/bash to become COMSPEC, got command ${command || "(missing)"}`)
        }
        console.log(`[test:windows-pty] shell: ${command}`)

        manager.write(session_id, Buffer.from(`echo ${MARKER}\r\n`))
        await wait_for(
            () => shell_error(messages),
            () => Buffer.concat(chunks).includes(MARKER),
            10000,
            "command output",
            chunks
        )
        console.log("[test:windows-pty] command output received")

        manager.resize({ type: "pty:resize", session_id, cols: 40, rows: 12 })
        manager.write(session_id, Buffer.from("exit\r\n"))
        await wait_for(
            () => shell_error(messages),
            () => exit_code(messages) !== null,
            10000,
            "shell exit",
            chunks
        )
        const code = exit_code(messages)
        if (code !== 0) {
            throw new Error(`Expected exit code 0, got ${code}\n${output_text(chunks)}`)
        }
        console.log("[test:windows-pty] passed")
    } finally {
        manager.abort_all()
        fs.rmSync(cache_dir, { recursive: true, force: true })
    }
}

function has_prompt(chunks: Buffer[]): boolean {
    return Buffer.concat(chunks).includes(0x3e)
}

function shell_error(messages: AgentToHubMessage[]): Error | null {
    const failure = messages.find((message) => message.type === "pty:error")
    if (!failure || failure.type !== "pty:error") return null
    return new Error(failure.error)
}

function exit_code(messages: AgentToHubMessage[]): number | null {
    const exited = messages.find((message) => message.type === "pty:exit")
    if (!exited || exited.type !== "pty:exit") return null
    return exited.code
}

function output_text(chunks: Buffer[]): string {
    return Buffer.concat(chunks).toString("utf8")
}

async function wait_for(
    failure: () => Error | null,
    ready: () => boolean,
    timeout_ms: number,
    label: string,
    chunks: Buffer[]
): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < timeout_ms) {
        const error = failure()
        if (error) throw error
        if (ready()) return
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const error = failure()
    if (error) throw error
    throw new Error(`Timed out waiting for ${label} after ${timeout_ms}ms\n${output_text(chunks)}`)
}

run().catch((err: Error) => {
    console.error(`[test:windows-pty] ${err.message}`)
    process.exit(1)
})
