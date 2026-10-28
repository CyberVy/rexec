import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo, Socket } from "node:net"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { WsLifecycle } from "../../../src/transport/lifecycle"
import { print_verdict, record_history } from "./helpers"

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const script_dir = path.dirname(fileURLToPath(import.meta.url))
const repo_root = path.resolve(script_dir, "../../..")
const tsx_bin = path.join(repo_root, "node_modules", ".bin", "tsx")

type PeerMode = "silent" | "pong" | "close_hold" | "replaced"

function encode_text(text: string): Buffer {
    const payload = Buffer.from(text)
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
}

function encode_close(code: number, reason = ""): Buffer {
    const reason_buf = Buffer.from(reason)
    const payload = Buffer.alloc(2 + reason_buf.length)
    payload.writeUInt16BE(code, 0)
    reason_buf.copy(payload, 2)
    return Buffer.concat([Buffer.from([0x88, payload.length]), payload])
}

function consume_client_frames(
    buffer: Buffer<ArrayBufferLike>,
    on_text: (text: string) => void
): Buffer<ArrayBufferLike> {
    let offset = 0
    while (offset + 2 <= buffer.length) {
        const byte1 = buffer[offset + 1]
        const opcode = buffer[offset] & 0x0f
        const masked = (byte1 & 0x80) !== 0
        const length = byte1 & 0x7f
        if (length >= 126) break
        const frame_len = 2 + (masked ? 4 : 0) + length
        if (offset + frame_len > buffer.length) break
        if (opcode === 0x1) {
            const payload = Buffer.from(buffer.subarray(offset + 2 + (masked ? 4 : 0), offset + frame_len))
            if (masked) {
                const mask = buffer.subarray(offset + 2, offset + 6)
                for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
            }
            on_text(payload.toString("utf8"))
        }
        offset += frame_len
    }
    return buffer.subarray(offset)
}

interface Peer {
    connections: number
    ended: number
    close: () => Promise<void>
}

async function listen_peer(mode: PeerMode): Promise<{ peer: Peer; port: number }> {
    const sockets = new Set<Socket>()
    let connections = 0
    let ended = 0

    const server = http.createServer((_req, res) => {
        res.writeHead(404)
        res.end()
    })
    server.timeout = 0
    server.requestTimeout = 0

    server.on("upgrade", (req, duplex) => {
        const socket = duplex as Socket
        connections++
        sockets.add(socket)
        socket.on("close", () => {
            sockets.delete(socket)
            ended++
        })
        socket.on("error", () => {})
        socket.setTimeout(0)
        const key = req.headers["sec-websocket-key"]
        if (typeof key !== "string") {
            socket.destroy()
            return
        }
        const accept = crypto
            .createHash("sha1")
            .update(key + WS_GUID)
            .digest("base64")
        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        )
        if (mode === "close_hold") {
            socket.write(encode_close(1000))
            return
        }
        if (mode === "replaced") {
            socket.write(encode_close(1000, "Replaced by new connection"))
            socket.end()
            return
        }
        let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
        socket.on("data", (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk])
            buffer = consume_client_frames(buffer, (text) => {
                if (mode !== "pong") return
                try {
                    const msg = JSON.parse(text) as { type?: string }
                    if (msg.type === "ping") socket.write(encode_text('{"type":"pong"}'))
                } catch {
                    // Ignore the register frame.
                }
            })
        })
    })

    const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address() as AddressInfo
            resolve(address.port)
        })
    })

    return {
        port,
        peer: {
            get connections() {
                return connections
            },
            get ended() {
                return ended
            },
            close: () =>
                new Promise<void>((resolve) => {
                    for (const socket of sockets) socket.destroy()
                    server.close(() => resolve())
                })
        }
    }
}

function spawn_agent(port: number, env: Record<string, string>): ChildProcess {
    return spawn(
        tsx_bin,
        ["src/agent/index.ts", "--hub", `http://127.0.0.1:${port}`, "--token", "heartbeat-token", "--node-id", "hb"],
        {
            cwd: repo_root,
            env: { ...process.env, ...env },
            stdio: ["ignore", "pipe", "pipe"]
        }
    )
}

async function wait_for(deadline_ms: number, ready: () => boolean): Promise<void> {
    const start = Date.now()
    while (!ready() && Date.now() - start < deadline_ms) {
        await new Promise((resolve) => setTimeout(resolve, 30))
    }
}

async function run_case(
    test_name: string,
    mode: PeerMode,
    env: Record<string, string>,
    expect: (peer: Peer, child: ChildProcess) => boolean,
    hold_ms = 0
): Promise<boolean> {
    const started = Date.now()
    const { peer, port } = await listen_peer(mode)
    const child = spawn_agent(port, env)
    let output = ""
    child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8")
    })

    try {
        await wait_for(8000, () => expect(peer, child))
        if (hold_ms > 0 && expect(peer, child)) {
            await new Promise((resolve) => setTimeout(resolve, hold_ms))
        }
        const passed = expect(peer, child)
        const details = `connections=${peer.connections} ended=${peer.ended} exit=${child.exitCode} ${output.trim().slice(-500)}`
        print_verdict(test_name, passed, passed ? `connections=${peer.connections} ended=${peer.ended}` : details)
        record_history({
            test_name,
            command: mode,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: passed ? 0 : 1,
            duration_ms: Date.now() - started,
            error_message: passed ? undefined : details
        })
        return passed
    } catch (err) {
        print_verdict(test_name, false, (err as Error).message)
        record_history({
            test_name,
            command: mode,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: Date.now() - started,
            error_message: (err as Error).message
        })
        return false
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        await peer.close()
    }
}

interface HeartbeatCase {
    name: string
    mode: PeerMode
    env: Record<string, string>
    hold_ms?: number
    pass: (peer: Peer, child: ChildProcess) => boolean
}

const FAST = {
    REXEC_RECONNECT_DELAY_MS: "50",
    REXEC_CONNECT_TIMEOUT_MS: "1000"
}

/** Scaled 5s/15s defaults: one ping interval, idle at three intervals. */
const PING_MS = "100"
const IDLE_MS = "300"

const QUIET = {
    REXEC_HEARTBEAT_INTERVAL_MS: "60000",
    REXEC_HEARTBEAT_TIMEOUT_MS: "60000"
}

function reconnected(peer: Peer, child: ChildProcess): boolean {
    return child.exitCode === null && peer.connections >= 2 && peer.ended >= 1
}

const CASES: HeartbeatCase[] = [
    {
        name: "test:heartbeat_idle_timeout_reconnects",
        mode: "silent",
        env: { ...FAST, REXEC_HEARTBEAT_INTERVAL_MS: PING_MS, REXEC_HEARTBEAT_TIMEOUT_MS: IDLE_MS },
        pass: reconnected
    },
    {
        name: "test:heartbeat_close_frame_without_fin_reconnects",
        mode: "close_hold",
        env: { ...FAST, ...QUIET },
        pass: reconnected
    },
    {
        name: "test:heartbeat_live_pong_stays_connected",
        mode: "pong",
        env: { ...FAST, REXEC_HEARTBEAT_INTERVAL_MS: PING_MS, REXEC_HEARTBEAT_TIMEOUT_MS: IDLE_MS },
        hold_ms: 1000,
        pass: (peer, child) => child.exitCode === null && peer.connections === 1
    },
    {
        name: "test:heartbeat_token_takeover_exits",
        mode: "replaced",
        env: { ...FAST, ...QUIET },
        pass: (peer, child) => child.exitCode === 0 && peer.connections === 1
    }
]

async function run_lifecycle_idle(): Promise<boolean> {
    const test_name = "test:lifecycle_idle_timeout_reconnects"
    const started = Date.now()
    const { peer, port } = await listen_peer("silent")
    const life = new WsLifecycle({
        url: `ws://127.0.0.1:${port}/ws`,
        reconnect: true,
        reconnect_delay_ms: 50,
        ping_interval_ms: 100,
        idle_timeout_ms: 300,
        connect_timeout_ms: 1000
    })
    try {
        await life.start()
        await wait_for(8000, () => life.is_open && peer.connections >= 2 && peer.ended >= 1)
        const passed = life.is_open && peer.connections >= 2 && peer.ended >= 1
        const details = `connections=${peer.connections} ended=${peer.ended}`
        print_verdict(test_name, passed, passed ? details : details)
        record_history({
            test_name,
            command: "WsLifecycle silent",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: passed ? 0 : 1,
            duration_ms: Date.now() - started,
            error_message: passed ? undefined : details
        })
        return passed
    } catch (err) {
        print_verdict(test_name, false, (err as Error).message)
        record_history({
            test_name,
            command: "WsLifecycle silent",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: Date.now() - started,
            error_message: (err as Error).message
        })
        return false
    } finally {
        life.stop()
        await peer.close()
    }
}

async function main(): Promise<boolean> {
    let passed = await run_lifecycle_idle()
    for (const entry of CASES) {
        const ok = await run_case(entry.name, entry.mode, entry.env, entry.pass, entry.hold_ms ?? 0)
        passed = passed && ok
    }
    return passed
}

main()
    .then((passed) => process.exit(passed ? 0 : 1))
    .catch((err) => {
        console.error("[heartbeat test fatal]", err)
        process.exit(1)
    })
