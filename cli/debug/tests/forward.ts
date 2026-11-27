import crypto from "node:crypto"
import http from "node:http"
import type { Socket } from "node:net"
import { ForwardMuxClient, open_forward_tunnel, RexecCaller } from "@/caller"
import { run_port_forward } from "@/caller/terminal/forward"
import { DEBUG_TOKEN, read_debug_config, record_history } from "./helpers"

async function run(): Promise<void> {
    const config = read_debug_config()
    const caller = new RexecCaller({ hub_url: config.hub_url, token: DEBUG_TOKEN })

    const REMOTE_PORT = 18989
    const LOCAL_PORT = 19898
    const REMOTE_PORT_2 = 18990
    const LOCAL_PORT_2 = 19899

    console.log(`[test:forward] Starting mock target HTTP servers on ports ${REMOTE_PORT} & ${REMOTE_PORT_2}...`)
    const target_server = http.createServer((req, res) => {
        if (req.url === "/echo") {
            let body = ""
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString()
            })
            req.on("end", () => {
                res.writeHead(200, { "Content-Type": "text/plain" })
                res.end(`echo:${body}`)
            })
            return
        }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", server: 1, url: req.url }))
    })

    const target_server_2 = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", server: 2, url: req.url }))
    })

    await Promise.all([
        new Promise<void>((resolve) => target_server.listen(REMOTE_PORT, "127.0.0.1", () => resolve())),
        new Promise<void>((resolve) => target_server_2.listen(REMOTE_PORT_2, "127.0.0.1", () => resolve()))
    ])

    const started_at = Date.now()
    const abort_controller = new AbortController()
    console.log(
        `[test:forward] Launching port forwards ${LOCAL_PORT} -> ${REMOTE_PORT} & ${LOCAL_PORT_2} -> ${REMOTE_PORT_2}...`
    )

    let mark_ready_1!: () => void
    let mark_ready_2!: () => void
    const ready_1 = new Promise<void>((resolve) => {
        mark_ready_1 = resolve
    })
    const ready_2 = new Promise<void>((resolve) => {
        mark_ready_2 = resolve
    })

    const forward_promise = run_port_forward(caller, LOCAL_PORT, REMOTE_PORT, {
        signal: abort_controller.signal,
        on_ready: () => mark_ready_1()
    })
    const forward_promise_2 = run_port_forward(caller, LOCAL_PORT_2, REMOTE_PORT_2, {
        signal: abort_controller.signal,
        on_ready: () => mark_ready_2()
    })
    forward_promise.catch(() => {})
    forward_promise_2.catch(() => {})

    let exit_code = 0
    try {
        const startup_timeout_ms = 15_000
        let startup_timer: ReturnType<typeof setTimeout> | null = null
        try {
            await Promise.race([
                Promise.all([ready_1, ready_2]),
                forward_promise.then(() => {
                    throw new Error("Forward tunnel 1 exited before becoming ready")
                }),
                forward_promise_2.then(() => {
                    throw new Error("Forward tunnel 2 exited before becoming ready")
                }),
                new Promise<never>((_, reject) => {
                    startup_timer = setTimeout(
                        () =>
                            reject(
                                new Error(`Timed out waiting for forward servers to bind after ${startup_timeout_ms}ms`)
                            ),
                        startup_timeout_ms
                    )
                })
            ])
        } finally {
            if (startup_timer) clearTimeout(startup_timer)
        }

        console.log(`[test:forward] Testing GET http://127.0.0.1:${LOCAL_PORT}/hello...`)
        const res1 = await fetch(`http://127.0.0.1:${LOCAL_PORT}/hello`)
        if (!res1.ok) {
            throw new Error(`Expected HTTP 200, got ${res1.status}`)
        }
        const data1 = (await res1.json()) as { status: string; url: string }
        if (data1.status !== "ok" || data1.url !== "/hello") {
            throw new Error(`Unexpected payload: ${JSON.stringify(data1)}`)
        }
        console.log(`✓ GET request succeeded: ${JSON.stringify(data1)}`)

        console.log(`[test:forward] Testing POST http://127.0.0.1:${LOCAL_PORT}/echo...`)
        const test_body = "rexec-full-duplex-streaming-test-12345"
        const res2 = await fetch(`http://127.0.0.1:${LOCAL_PORT}/echo`, {
            method: "POST",
            body: test_body
        })
        const text2 = await res2.text()
        if (text2 !== `echo:${test_body}`) {
            throw new Error(`Unexpected echo response: '${text2}'`)
        }
        console.log(`✓ POST request succeeded: '${text2}'`)

        console.log(`[test:forward] Testing concurrent requests across two simultaneous tunnels...`)
        const concurrent_reqs = Array.from({ length: 10 }, async (_, i) => {
            const [r1, r2] = await Promise.all([
                fetch(`http://127.0.0.1:${LOCAL_PORT}/concurrent-${i}`),
                fetch(`http://127.0.0.1:${LOCAL_PORT_2}/concurrent-${i}`)
            ])
            const json1 = (await r1.json()) as { server: number; url: string }
            const json2 = (await r2.json()) as { server: number; url: string }
            if (json1.server !== 1 || json1.url !== `/concurrent-${i}`) {
                throw new Error(`Tunnel 1 mismatch: ${JSON.stringify(json1)}`)
            }
            if (json2.server !== 2 || json2.url !== `/concurrent-${i}`) {
                throw new Error(`Tunnel 2 mismatch: ${JSON.stringify(json2)}`)
            }
        })
        await Promise.all(concurrent_reqs)
        console.log(`✓ 20 concurrent requests across 2 simultaneous tunnels successfully multiplexed!`)

        console.log(`[test:forward] Dropping shared caller forward socket and verifying reconnect...`)
        const hub = hub_port(config.hub_url)
        const dropped = drop_hub_sockets(hub)
        if (dropped !== 1) {
            throw new Error(`Expected 1 shared forward socket on hub port ${hub}, dropped ${dropped}`)
        }
        await wait_for_hub_sockets(hub, (count) => count === 0)
        await wait_for_hub_sockets(hub, (count) => count === 1)
        await wait_until_forward_responds(LOCAL_PORT, "/reconnect-check")
        await wait_until_forward_responds(LOCAL_PORT_2, "/reconnect-check")
        console.log(`✓ Both tunnels shared 1 WS and recovered after WebSocket drop`)

        abort_controller.abort()
        await Promise.allSettled([forward_promise, forward_promise_2])
        await wait_for_hub_sockets(hub, (count) => count === 0)

        console.log(`[test:forward] Verifying ensure_connected during backoff keeps a single Hub socket...`)
        await verify_backoff_single_socket(config.hub_url, hub, REMOTE_PORT)
        console.log(`✓ Reconnecting during backoff kept exactly 1 shared Hub socket`)

        console.log(`[test:forward] Verifying timeout when Hub omits initial hub:status...`)
        await verify_missing_status_timeout()
        console.log(`✓ Forward connect timed out cleanly when hub:status was never received`)

        record_history({
            test_name: "port_forward",
            command: `rexec forward ${LOCAL_PORT}:${REMOTE_PORT}`,
            verdict: "PASS",
            exit_code: 0,
            duration_ms: Date.now() - started_at
        })

        console.log("\n======================================================")
        console.log("ALL PORT FORWARD TESTS PASSED!")
        console.log("======================================================\n")
    } catch (err) {
        exit_code = 1
        record_history({
            test_name: "port_forward",
            command: `rexec forward ${LOCAL_PORT}:${REMOTE_PORT}`,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: Date.now() - started_at,
            error_message: (err as Error).message
        })
        console.error(`[test:forward failed]`, err)
    } finally {
        abort_controller.abort()
        target_server.close()
        target_server_2.close()
        await Promise.allSettled([forward_promise, forward_promise_2])
        process.exit(exit_code)
    }
}

function hub_port(hub_url: string): number {
    const url = new URL(hub_url)
    if (url.port) return Number(url.port)
    return url.protocol === "https:" ? 443 : 80
}

function hub_sockets(port: number): Socket[] {
    const getter = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles
    if (!getter) return []
    const found: Socket[] = []
    for (const handle of getter()) {
        if (!handle || typeof handle !== "object") continue
        const socket = handle as Socket
        if (typeof socket.destroy !== "function" || socket.destroyed || socket.remotePort !== port) continue
        found.push(socket)
    }
    return found
}

function drop_hub_sockets(port: number): number {
    const sockets = hub_sockets(port)
    for (const socket of sockets) socket.destroy()
    return sockets.length
}

async function wait_for_hub_sockets(port: number, ready: (count: number) => boolean): Promise<void> {
    const deadline = Date.now() + 15_000
    let last_count = hub_sockets(port).length
    while (Date.now() < deadline) {
        last_count = hub_sockets(port).length
        if (ready(last_count)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Hub port ${port} socket count stayed at ${last_count}`)
}

async function wait_until_forward_responds(local_port: number, path: string): Promise<void> {
    const deadline = Date.now() + 15_000
    let last_error = "no attempt"
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://127.0.0.1:${local_port}${path}`, { signal: AbortSignal.timeout(2000) })
            const data = (await res.json()) as { status?: string; url?: string }
            if (res.ok && data.status === "ok" && data.url === path) return
            last_error = `HTTP ${res.status} ${JSON.stringify(data)}`
        } catch (err) {
            last_error = (err as Error).message
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`Tunnel on port ${local_port} did not recover after reconnect: ${last_error}`)
}

async function verify_backoff_single_socket(hub_url: string, hub: number, remote_port: number): Promise<void> {
    const mux = new ForwardMuxClient({ hub_url, token: DEBUG_TOKEN })
    const t1 = await open_forward_tunnel({ hub_url, token: DEBUG_TOKEN, remote_port, transport: mux })
    try {
        await wait_for_hub_sockets(hub, (count) => count === 1)
        const dropped = drop_hub_sockets(hub)
        if (dropped !== 1) {
            throw new Error(`Expected 1 socket to drop for backoff check, dropped ${dropped}`)
        }

        // Wait until WsClient observes the close and enters backoff (mux.is_attached === false)
        const deadline = Date.now() + 5_000
        while (mux.is_attached && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
        if (mux.is_attached) {
            throw new Error("ForwardMuxClient did not detach after socket drop")
        }

        const t2 = await open_forward_tunnel({ hub_url, token: DEBUG_TOKEN, remote_port, transport: mux })
        try {
            await wait_for_hub_sockets(hub, (count) => count === 1)
        } finally {
            t2.close()
        }
    } finally {
        t1.close()
        mux.close()
    }
}

async function verify_missing_status_timeout(): Promise<void> {
    const sockets = new Set<Socket>()
    const silent_hub = http.createServer()
    silent_hub.on("upgrade", (req, socket: Socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        const key = req.headers["sec-websocket-key"]
        if (typeof key !== "string") {
            socket.destroy()
            return
        }
        const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")
        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        )
    })

    await new Promise<void>((resolve) => silent_hub.listen(0, "127.0.0.1", () => resolve()))
    const address = silent_hub.address()
    if (!address || typeof address === "string") {
        silent_hub.close()
        throw new Error("Failed to bind silent mock hub")
    }

    const silent_caller = new RexecCaller({
        hub_url: `http://127.0.0.1:${address.port}`,
        token: DEBUG_TOKEN
    })
    const started = Date.now()
    try {
        await silent_caller.forward(18989, { timeout_ms: 250 })
        throw new Error("Expected forward connect to time out without hub:status")
    } catch (err) {
        const message = (err as Error).message
        const elapsed = Date.now() - started
        if (!message.includes("hub:status")) {
            throw new Error(`Expected hub:status timeout error, got: ${message}`)
        }
        if (elapsed > 2000) {
            throw new Error(`Expected fast hub:status timeout, took ${elapsed}ms`)
        }
    } finally {
        silent_caller.close()
        for (const socket of sockets) socket.destroy()
        silent_hub.close()
    }
}

run().catch((err) => {
    console.error(`[test:forward fatal]`, err)
    process.exit(1)
})
