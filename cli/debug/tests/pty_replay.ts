import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PtyManager } from "@/agent/pty_manager"
import type { AgentToHubMessage } from "@/protocol"
import { decode_pty_frame } from "@/transport"

const repo_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const SESSION_ID = "pty-replay-test"
const QUERIES = [
    Buffer.from("\x1b[c"),
    Buffer.from("\x1b[?2026$p"),
    Buffer.from("\x1b[?2027$p"),
    Buffer.from("\x1b]11;?\x07")
]
const CURSOR_VISIBLE = Buffer.from("\x1b[?25h")
const COLOR_SET = Buffer.from("\x1b]11;rgb:0000/0000/0000\x07")
const MARKER = "REPLAY_MARKER"

async function run(): Promise<void> {
    const platform_key = `${process.platform}-${process.arch}`
    const vendor_dir = path.join(repo_root, "vendor", "node-pty", "1.2.0-beta.17", platform_key)
    const native_name = process.platform === "win32" ? "conpty.node" : "pty.node"
    if (!fs.existsSync(path.join(vendor_dir, native_name))) {
        console.log(`[test:pty-replay] skipped: no PTY prebuild for ${platform_key}`)
        return
    }

    const cache_dir = fs.mkdtempSync(path.join(os.tmpdir(), "rexec-pty-replay-"))
    fs.cpSync(vendor_dir, cache_dir, { recursive: true })
    process.env.REXEC_PTY_CACHE = cache_dir

    const manager = new PtyManager("http://127.0.0.1")
    const live_chunks: Buffer[] = []
    try {
        manager.open(
            {
                type: "pty:open",
                session_id: SESSION_ID,
                file: "sh",
                args: [
                    "-c",
                    `printf '\\033[c\\033[?2026$p\\033[?2027$p\\033]11;?\\007\\033[?25h\\033]11;rgb:0000/0000/0000\\007${MARKER}\\n'; sleep 2`
                ],
                cols: 80,
                rows: 24,
                term: "xterm-256color",
                persistent: true
            },
            os.tmpdir(),
            () => {},
            (frame) => {
                const decoded = decode_pty_frame(frame)
                if (decoded) live_chunks.push(Buffer.from(decoded.payload))
            }
        )

        await wait_for(() => Buffer.concat(live_chunks).includes(MARKER), 8000, "marker")
        manager.detach(SESSION_ID)

        const messages: AgentToHubMessage[] = []
        const replay_frames: Buffer[] = []
        manager.attach(
            { type: "pty:attach", session_id: SESSION_ID, cols: 80, rows: 24 },
            (message) => {
                messages.push(message)
            },
            (frame) => {
                const decoded = decode_pty_frame(frame)
                if (decoded) replay_frames.push(Buffer.from(decoded.payload))
            }
        )

        const replay = Buffer.concat(replay_frames)
        for (const query of QUERIES) {
            if (replay.includes(query)) {
                throw new Error(`Replay still contains ${JSON.stringify(query.toString("utf8"))}`)
            }
        }
        if (!replay.includes(COLOR_SET) || !replay.includes(CURSOR_VISIBLE) || !replay.includes(MARKER)) {
            throw new Error(`Replay dropped screen state: ${JSON.stringify(replay.toString("utf8"))}`)
        }
        if (messages.some((message) => message.type === "pty:error")) {
            throw new Error(`Attach failed: ${JSON.stringify(messages)}`)
        }
        console.log(`[test:pty-replay] replayed ${replay.byteLength} bytes without the color query`)
    } finally {
        manager.close({ type: "pty:close", session_id: SESSION_ID })
        fs.rmSync(cache_dir, { recursive: true, force: true })
    }
}

async function wait_for(ready: () => boolean, timeout_ms: number, label: string): Promise<void> {
    const started = Date.now()
    while (!ready()) {
        if (Date.now() - started > timeout_ms) {
            throw new Error(`Timed out waiting for ${label}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
}

run().catch((err) => {
    console.error("[test:pty-replay]", err)
    process.exit(1)
})
