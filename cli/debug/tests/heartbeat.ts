import crypto from "node:crypto"
import net from "node:net"
import { HubWsClient } from "../../../src/transport/ws"
import { print_verdict, record_history } from "./helpers"

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function encode_server_text(text: string): Buffer {
    const payload = Buffer.from(text)
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
}

function consume_client_frames(buffer: Buffer, on_text: (text: string) => void): Buffer {
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
    return Buffer.from(buffer.subarray(offset))
}

async function test_half_open_reconnects(): Promise<boolean> {
    const test_name = "test:heartbeat_half_open_reconnects"
    const command = "peer ACKs but never pongs"
    let connection_count = 0
    const sockets = new Set<net.Socket>()
    const closes: string[] = []

    const server = net.createServer((socket) => {
        connection_count++
        const reply = connection_count > 1
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        socket.on("error", () => {})
        let buffer: Buffer = Buffer.alloc(0)
        let upgraded = false
        socket.on("data", (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk])
            if (!upgraded) {
                const header_end = buffer.indexOf("\r\n\r\n")
                if (header_end < 0) return
                const key = buffer
                    .subarray(0, header_end)
                    .toString("latin1")
                    .match(/Sec-WebSocket-Key:\s*(\S+)/i)?.[1]
                if (!key) {
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
                buffer = Buffer.from(buffer.subarray(header_end + 4))
                upgraded = true
            }
            if (!reply) {
                buffer = Buffer.alloc(0)
                return
            }
            buffer = consume_client_frames(buffer, (text) => {
                if (text === '{"type":"ping"}') socket.write(encode_server_text('{"type":"pong"}'))
            })
        })
    })

    const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            if (!address || typeof address === "string") reject(new Error("failed to bind"))
            else resolve(address.port)
        })
    })

    const client = new HubWsClient({
        hub_url: `ws://127.0.0.1:${port}`,
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

    const finish = async () => {
        client.close(1000, "test done")
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    try {
        await client.connect()
        const start = Date.now()
        while (Date.now() - start < 3000 && !(connection_count >= 2 && client.is_open)) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        await new Promise((resolve) => setTimeout(resolve, 800))
        const passed =
            closes.length === 1 &&
            closes[0].includes("heartbeat pong timeout") &&
            connection_count === 2 &&
            sockets.size === 1 &&
            client.is_open
        const details = `closes=${closes.join(",") || "none"} connections=${connection_count} open=${sockets.size}`
        print_verdict(test_name, passed, details)
        record_history({
            test_name,
            command,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: passed ? 0 : 1,
            duration_ms: Date.now() - start,
            error_message: passed ? undefined : details
        })
        return passed
    } catch (err) {
        print_verdict(test_name, false, (err as Error).message)
        record_history({
            test_name,
            command,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        return false
    } finally {
        await finish()
    }
}

test_half_open_reconnects()
    .then((passed) => process.exit(passed ? 0 : 1))
    .catch((err) => {
        console.error("[heartbeat test fatal]", err)
        process.exit(1)
    })
