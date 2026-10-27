import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import net from "node:net"
import path from "node:path"
import { HubWsClient } from "../../../src/transport/ws"
import { print_verdict, read_debug_config, record_history, repo_root } from "./helpers"

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const TSX_BIN = path.join(repo_root, "node_modules", ".bin", "tsx")

type SocketMode = "pong" | "blackhole" | "reset"

interface MockHub {
    url: string
    port: number
    connection_count: number
    open_count: number
    close(): Promise<void>
}

function encode_server_text(text: string): Buffer {
    const payload = Buffer.from(text)
    if (payload.length < 126) {
        return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
    }
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
    return Buffer.concat([header, payload])
}

function consume_client_frames(buffer: Buffer, on_text: (text: string) => void): Buffer {
    let offset = 0
    while (offset + 2 <= buffer.length) {
        const byte0 = buffer[offset]
        const byte1 = buffer[offset + 1]
        const opcode = byte0 & 0x0f
        const masked = (byte1 & 0x80) !== 0
        let length = byte1 & 0x7f
        let header_len = 2
        if (length === 126) {
            if (offset + 4 > buffer.length) break
            length = buffer.readUInt16BE(offset + 2)
            header_len = 4
        } else if (length === 127) {
            if (offset + 10 > buffer.length) break
            const wide = buffer.readBigUInt64BE(offset + 2)
            if (wide > BigInt(Number.MAX_SAFE_INTEGER)) break
            length = Number(wide)
            header_len = 10
        }
        const mask_len = masked ? 4 : 0
        const frame_len = header_len + mask_len + length
        if (offset + frame_len > buffer.length) break
        if (opcode === 0x1) {
            const payload = Buffer.from(buffer.subarray(offset + header_len + mask_len, offset + frame_len))
            if (masked) {
                const mask = buffer.subarray(offset + header_len, offset + header_len + 4)
                for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
            }
            on_text(payload.toString("utf8"))
        }
        offset += frame_len
    }
    return Buffer.from(buffer.subarray(offset))
}

function start_mock_hub(mode_for: (connection_index: number) => SocketMode): Promise<MockHub> {
    let connection_count = 0
    const sockets = new Set<net.Socket>()

    const server = net.createServer((socket) => {
        connection_count++
        const connection_index = connection_count
        const mode = mode_for(connection_index)
        sockets.add(socket)
        socket.setNoDelay(true)
        socket.on("close", () => sockets.delete(socket))
        socket.on("error", () => {})

        let buffer: Buffer = Buffer.alloc(0)
        let upgraded = false

        const take_text = (text: string) => {
            if (mode !== "pong") return
            try {
                const msg = JSON.parse(text) as { type?: string }
                if (msg.type === "ping") socket.write(encode_server_text('{"type":"pong"}'))
            } catch {
                // Ignore non-JSON text frames.
            }
        }

        socket.on("data", (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk])
            if (!upgraded) {
                const header_end = buffer.indexOf("\r\n\r\n")
                if (header_end < 0) return
                const header = buffer.subarray(0, header_end).toString("latin1")
                const key = header.match(/Sec-WebSocket-Key:\s*(\S+)/i)?.[1]
                if (!key) {
                    socket.destroy()
                    return
                }
                const accept = crypto
                    .createHash("sha1")
                    .update(key + WS_GUID)
                    .digest("base64")
                socket.write(
                    "HTTP/1.1 101 Switching Protocols\r\n" +
                        "Upgrade: websocket\r\n" +
                        "Connection: Upgrade\r\n" +
                        `Sec-WebSocket-Accept: ${accept}\r\n` +
                        "\r\n"
                )
                buffer = Buffer.from(buffer.subarray(header_end + 4))
                upgraded = true
                if (mode === "reset") {
                    socket.destroy()
                    return
                }
            }
            if (mode === "blackhole") {
                buffer = Buffer.alloc(0)
                return
            }
            buffer = consume_client_frames(buffer, take_text)
        })
    })

    return new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            if (!address || typeof address === "string") {
                reject(new Error("mock hub failed to bind"))
                return
            }
            resolve({
                url: `ws://127.0.0.1:${address.port}`,
                port: address.port,
                get connection_count() {
                    return connection_count
                },
                get open_count() {
                    return sockets.size
                },
                close: () =>
                    new Promise<void>((done) => {
                        for (const socket of sockets) socket.destroy()
                        server.close(() => done())
                    })
            })
        })
    })
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function wait_until(label: string, predicate: () => boolean, timeout_ms: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeout_ms) {
        if (predicate()) return
        await delay(20)
    }
    throw new Error(`timed out waiting for ${label}`)
}

function record(test_name: string, command: string, passed: boolean, details?: string): void {
    print_verdict(test_name, passed, details)
    record_history({
        test_name,
        command,
        verdict: passed ? "PASS" : "FAIL",
        exit_code: passed ? 0 : 1,
        duration_ms: 0,
        error_message: passed ? undefined : details
    })
}

async function test_pong_holds_connection(): Promise<boolean> {
    const test_name = "test:heartbeat_pong_holds_connection"
    const hub = await start_mock_hub(() => "pong")
    const closes: string[] = []
    const client = new HubWsClient({
        hub_url: hub.url,
        path: "/ws",
        token: "heartbeat",
        heartbeat_interval_ms: 200,
        heartbeat_timeout_ms: 400,
        reconnect_delay_ms: 100,
        reconnect: true,
        on_close: (event) => {
            closes.push(`${event.code}:${event.reason}`)
        }
    })
    try {
        await client.connect()
        await delay(1000)
        const passed = closes.length === 0 && hub.connection_count === 1 && hub.open_count === 1 && client.is_open
        record(
            test_name,
            "ping/pong for 1s",
            passed,
            `closes=${closes.join(",") || "none"} connections=${hub.connection_count} open=${hub.open_count}`
        )
        return passed
    } catch (err) {
        record(test_name, "ping/pong for 1s", false, (err as Error).message)
        return false
    } finally {
        client.close(1000, "test done")
        await hub.close()
    }
}

async function test_half_open_reconnects(): Promise<boolean> {
    const test_name = "test:heartbeat_half_open_reconnects"
    const hub = await start_mock_hub((index) => (index === 1 ? "blackhole" : "pong"))
    const closes: string[] = []
    const client = new HubWsClient({
        hub_url: hub.url,
        path: "/ws",
        token: "heartbeat",
        heartbeat_interval_ms: 200,
        heartbeat_timeout_ms: 300,
        reconnect_delay_ms: 100,
        reconnect: true,
        on_close: (event) => {
            closes.push(`${event.code}:${event.reason}`)
        }
    })
    try {
        await client.connect()
        await wait_until("reconnect after missing pong", () => hub.connection_count >= 2 && client.is_open, 3000)
        await delay(800)
        const saw_timeout = closes.some((entry) => entry.includes("heartbeat pong timeout"))
        const passed =
            saw_timeout && hub.connection_count === 2 && hub.open_count === 1 && client.is_open && closes.length === 1
        record(
            test_name,
            "blackhole peer, expect forced reconnect",
            passed,
            `closes=${closes.join(",") || "none"} connections=${hub.connection_count} open=${hub.open_count}`
        )
        return passed
    } catch (err) {
        record(
            test_name,
            "blackhole peer, expect forced reconnect",
            false,
            `${(err as Error).message}; closes=${closes.join(",") || "none"} connections=${hub.connection_count}`
        )
        return false
    } finally {
        client.close(1000, "test done")
        await hub.close()
    }
}

async function test_tcp_reset_reconnects(): Promise<boolean> {
    const test_name = "test:heartbeat_tcp_reset_reconnects"
    const hub = await start_mock_hub((index) => (index === 1 ? "reset" : "pong"))
    const closes: string[] = []
    const client = new HubWsClient({
        hub_url: hub.url,
        path: "/ws",
        token: "heartbeat",
        heartbeat_interval_ms: 0,
        reconnect_delay_ms: 100,
        reconnect: true,
        on_close: (event) => {
            closes.push(`${event.code}:${event.reason}`)
        }
    })
    try {
        const connect_result = client.connect().then(
            () => "opened" as const,
            () => "closed_before_open" as const
        )
        await wait_until("reconnect after tcp reset", () => hub.connection_count >= 2 && client.is_open, 3000)
        await delay(400)
        const saw_reset = closes.some((entry) => entry.startsWith("1006:"))
        const passed = saw_reset && hub.connection_count === 2 && hub.open_count === 1 && client.is_open
        record(
            test_name,
            "peer destroys TCP, heartbeat disabled",
            passed,
            `closes=${closes.join(",") || "none"} connections=${hub.connection_count} initial=${await connect_result}`
        )
        return passed
    } catch (err) {
        record(
            test_name,
            "peer destroys TCP, heartbeat disabled",
            false,
            `${(err as Error).message}; closes=${closes.join(",") || "none"} connections=${hub.connection_count}`
        )
        return false
    } finally {
        client.close(1000, "test done")
        await hub.close()
    }
}

function spawn_agent(hub_url: string): { child: ChildProcess; output: () => string } {
    let output = ""
    const child = spawn(
        TSX_BIN,
        ["src/agent/index.ts", "--hub", hub_url, "--token", "heartbeat-agent", "--node-id", "heartbeat-agent"],
        {
            cwd: repo_root,
            env: {
                ...process.env,
                FORCE_COLOR: "0",
                REXEC_HEARTBEAT_INTERVAL_MS: "200",
                REXEC_HEARTBEAT_TIMEOUT_MS: "300",
                REXEC_RECONNECT_DELAY_MS: "100"
            },
            stdio: ["ignore", "pipe", "pipe"]
        }
    )
    const append = (chunk: Buffer) => {
        output += chunk.toString("utf8")
    }
    child.stdout?.on("data", append)
    child.stderr?.on("data", append)
    return {
        child,
        output: () => output
    }
}

async function stop_agent(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGTERM")
    await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        delay(2000).then(() => {
            if (child.exitCode === null) child.kill("SIGKILL")
        })
    ])
}

async function test_agent_half_open_reconnects(): Promise<boolean> {
    const test_name = "test:agent_half_open_reconnects"
    const hub = await start_mock_hub((index) => (index === 1 ? "blackhole" : "pong"))
    const agent = spawn_agent(hub.url)
    try {
        await wait_until(
            "agent forced reconnect",
            () =>
                hub.connection_count >= 2 &&
                agent.output().includes("heartbeat pong timeout") &&
                agent.output().split("Connected to hub").length >= 3,
            4000
        )
        await delay(800)
        const output = agent.output()
        const connected_count = output.split("Connected to hub").length - 1
        const exited = agent.child.exitCode !== null
        const passed =
            !exited &&
            connected_count === 2 &&
            hub.connection_count === 2 &&
            hub.open_count === 1 &&
            output.includes("code: 4000")
        record(
            test_name,
            "rexec-agent against a blackhole peer",
            passed,
            `exited=${exited} connections=${hub.connection_count} open=${hub.open_count} connected_logs=${connected_count}`
        )
        if (!passed) console.error(output)
        return passed
    } catch (err) {
        record(test_name, "rexec-agent against a blackhole peer", false, `${(err as Error).message}\n${agent.output()}`)
        return false
    } finally {
        await stop_agent(agent.child)
        await hub.close()
    }
}

async function test_hub_answers_ping(): Promise<boolean> {
    const test_name = "test:hub_answers_ping"
    const command = "ping live debug hub"
    try {
        const config = read_debug_config()
        const token = "rexec-heartbeat-probe"
        const ws_url = `${config.hub_url.replace(/^http/, "ws")}/ws?token=${token}&node_id=heartbeat-probe`
        const ws = new WebSocket(ws_url)
        const opened = await new Promise<boolean>((resolve) => {
            ws.addEventListener("open", () => resolve(true))
            ws.addEventListener("error", () => resolve(false))
            setTimeout(() => resolve(false), 3000)
        })
        if (!opened) {
            record(test_name, command, false, "socket did not open")
            return false
        }
        const pong = await new Promise<boolean>((resolve) => {
            ws.addEventListener("message", (event) => {
                if (typeof event.data === "string" && event.data.includes('"pong"')) resolve(true)
            })
            ws.send(JSON.stringify({ type: "ping" }))
            setTimeout(() => resolve(false), 2000)
        })
        const health_res = await fetch(`${config.hub_url}/health?token=${token}`)
        const health = (await health_res.json()) as { agent_connected?: boolean; last_seen_age_ms?: number }
        ws.close(1000, "probe done")
        const age_ok = typeof health.last_seen_age_ms === "number" && health.last_seen_age_ms < 10_000
        const passed = pong && health_res.ok && health.agent_connected === true && age_ok
        record(
            test_name,
            command,
            passed,
            `pong=${pong} status=${health_res.status} connected=${health.agent_connected} age=${health.last_seen_age_ms}`
        )
        return passed
    } catch (err) {
        record(test_name, command, false, (err as Error).message)
        return false
    }
}

async function run_heartbeat_tests(): Promise<boolean> {
    const results = [
        await test_pong_holds_connection(),
        await test_half_open_reconnects(),
        await test_tcp_reset_reconnects(),
        await test_agent_half_open_reconnects(),
        await test_hub_answers_ping()
    ]
    return results.every(Boolean)
}

run_heartbeat_tests()
    .then((passed) => {
        process.exit(passed ? 0 : 1)
    })
    .catch((err) => {
        console.error("[heartbeat test fatal]", err)
        process.exit(1)
    })
