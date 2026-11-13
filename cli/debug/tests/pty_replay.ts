import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PtyManager } from "@/agent/pty_manager"
import { PtyRingBuffer } from "@/agent/ring_buffer"
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
const AFTER_DETACH_MARKER = "AFTER_DETACH_MARKER"

function test_ring_buffer_incremental_slices(): void {
    const rb = new PtyRingBuffer(10)
    rb.write(Buffer.from("abcd")) // total=4, buf="abcd"
    rb.write(Buffer.from("efgh")) // total=8, buf="abcdefgh"

    // Exact caught-up
    const caught_up = rb.read_from(8)
    if (caught_up.reset || caught_up.bytes !== 0 || caught_up.offset !== 8 || caught_up.chunks.length !== 0) {
        throw new Error(`Expected empty incremental slice at offset 8, got ${JSON.stringify(caught_up)}`)
    }

    // Mid-buffer offset spanning across chunk boundary
    const mid = rb.read_from(2)
    const mid_text = Buffer.concat(mid.chunks).toString("utf8")
    if (mid.reset || mid.offset !== 2 || mid.bytes !== 6 || mid_text !== "cdefgh") {
        throw new Error(
            `Unexpected mid slice: reset=${mid.reset} offset=${mid.offset} bytes=${mid.bytes} text=${mid_text}`
        )
    }

    // Overflow past capacity (10 bytes): writes "ijkl" -> total=12, head=2, buf="cdefghijkl"
    rb.write(Buffer.from("ijkl"))
    const missed = rb.read_from(1)
    const missed_text = Buffer.concat(missed.chunks).toString("utf8")
    if (!missed.reset || missed.offset !== 2 || missed.bytes !== 10 || missed_text !== "cdefghijkl") {
        throw new Error(
            `Unexpected overflow fallback: reset=${missed.reset} offset=${missed.offset} bytes=${missed.bytes} text=${missed_text}`
        )
    }

    // Hit right at new head_offset
    const at_head = rb.read_from(2)
    const at_head_text = Buffer.concat(at_head.chunks).toString("utf8")
    if (at_head.reset || at_head.offset !== 2 || at_head.bytes !== 10 || at_head_text !== "cdefghijkl") {
        throw new Error(
            `Unexpected head slice: reset=${at_head.reset} offset=${at_head.offset} bytes=${at_head.bytes} text=${at_head_text}`
        )
    }

    // Out-of-range future offset falls back to reset
    const future = rb.read_from(999)
    if (!future.reset || future.offset !== 2 || future.bytes !== 10) {
        throw new Error(`Unexpected future offset fallback: ${JSON.stringify(future)}`)
    }

    console.log("[test:pty-replay] PtyRingBuffer incremental read_from checks passed")
}

async function run(): Promise<void> {
    test_ring_buffer_incremental_slices()

    const platform_key = `${process.platform}-${process.arch}`
    const vendor_dir = path.join(repo_root, "vendor", "node-pty", "1.2.0-beta.17", platform_key)
    const native_name = process.platform === "win32" ? "conpty.node" : "pty.node"
    if (!fs.existsSync(path.join(vendor_dir, native_name))) {
        console.log(`[test:pty-replay] skipped PTY spawn checks: no PTY prebuild for ${platform_key}`)
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
                    `printf '\\033[c\\033[?2026$p\\033[?2027$p\\033]11;?\\007\\033[?25h\\033]11;rgb:0000/0000/0000\\007${MARKER}\\n'; IFS= read -r _line; printf '${AFTER_DETACH_MARKER}\\n'; sleep 2`
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

        await wait_for(
            () => {
                const text = Buffer.concat(live_chunks).toString("utf8")
                const idx = text.indexOf(MARKER)
                return idx !== -1 && text.slice(idx + MARKER.length).includes("\n")
            },
            8000,
            "marker"
        )
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
        const header = messages.find((message) => message.type === "pty:replay")
        if (!header || header.type !== "pty:replay" || header.bytes !== replay.byteLength) {
            throw new Error(`Replay was not framed: ${JSON.stringify(messages)} bytes=${replay.byteLength}`)
        }
        if (header.reset !== true || header.offset !== 0) {
            throw new Error(`Expected cold attach reset=true offset=0, got ${JSON.stringify(header)}`)
        }
        for (const query of QUERIES) {
            if (!replay.includes(query)) {
                throw new Error(`Replay dropped ${JSON.stringify(query.toString("utf8"))}`)
            }
        }
        if (!replay.includes(COLOR_SET) || !replay.includes(CURSOR_VISIBLE) || !replay.includes(MARKER)) {
            throw new Error(`Replay dropped screen state: ${JSON.stringify(replay.toString("utf8"))}`)
        }
        if (messages.some((message) => message.type === "pty:error")) {
            throw new Error(`Attach failed: ${JSON.stringify(messages)}`)
        }

        // Incremental resume with no new bytes since attach
        const resume_offset = (header.offset ?? 0) + header.bytes
        manager.detach(SESSION_ID)
        const empty_messages: AgentToHubMessage[] = []
        const empty_frames: Buffer[] = []
        manager.attach(
            { type: "pty:attach", session_id: SESSION_ID, cols: 80, rows: 24, offset: resume_offset },
            (message) => empty_messages.push(message),
            (frame) => {
                const decoded = decode_pty_frame(frame)
                if (decoded) empty_frames.push(Buffer.from(decoded.payload))
            }
        )
        const empty_header = empty_messages.find((message) => message.type === "pty:replay")
        if (
            !empty_header ||
            empty_header.type !== "pty:replay" ||
            empty_header.reset !== false ||
            empty_header.bytes !== 0 ||
            empty_header.offset !== resume_offset ||
            empty_frames.length !== 0
        ) {
            throw new Error(`Expected 0-byte incremental replay, got ${JSON.stringify(empty_messages)}`)
        }

        // Incremental resume with delta output emitted while detached
        manager.detach(SESSION_ID)
        manager.write(SESSION_ID, Buffer.from("go\n"))
        await wait_for(
            () => (manager.list().find((s) => s.session_id === SESSION_ID)?.buffered_bytes ?? 0) > resume_offset,
            5000,
            "detached output"
        )
        const delta_messages: AgentToHubMessage[] = []
        const delta_frames: Buffer[] = []
        manager.attach(
            { type: "pty:attach", session_id: SESSION_ID, cols: 80, rows: 24, offset: resume_offset },
            (message) => delta_messages.push(message),
            (frame) => {
                const decoded = decode_pty_frame(frame)
                if (decoded) delta_frames.push(Buffer.from(decoded.payload))
            }
        )
        const delta_replay = Buffer.concat(delta_frames)
        const delta_header = delta_messages.find((message) => message.type === "pty:replay")
        if (
            !delta_header ||
            delta_header.type !== "pty:replay" ||
            delta_header.reset !== false ||
            delta_header.offset !== resume_offset ||
            delta_header.bytes !== delta_replay.byteLength ||
            delta_replay.byteLength === 0
        ) {
            throw new Error(
                `Expected delta incremental replay, got header=${JSON.stringify(delta_header)} len=${delta_replay.byteLength}`
            )
        }
        if (!delta_replay.includes(AFTER_DETACH_MARKER) || delta_replay.includes(MARKER)) {
            throw new Error(
                `Delta replay included unexpected content: ${JSON.stringify(delta_replay.toString("utf8"))}`
            )
        }

        console.log(
            `[test:pty-replay] framed ${header.bytes} cold bytes + 0-byte no-op resume + ${delta_header.bytes} delta bytes`
        )
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
