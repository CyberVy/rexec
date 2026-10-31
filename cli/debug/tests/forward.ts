import http from "node:http"
import { RexecCaller } from "@/caller"
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

    const abort_controller = new AbortController()
    console.log(
        `[test:forward] Launching port forwards ${LOCAL_PORT} -> ${REMOTE_PORT} & ${LOCAL_PORT_2} -> ${REMOTE_PORT_2}...`
    )

    const forward_promise = run_port_forward(caller, LOCAL_PORT, REMOTE_PORT, {
        signal: abort_controller.signal
    })
    const forward_promise_2 = run_port_forward(caller, LOCAL_PORT_2, REMOTE_PORT_2, {
        signal: abort_controller.signal
    })

    // Wait a moment for forward server to bind
    await new Promise((r) => setTimeout(r, 800))

    try {
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

        record_history({
            test_name: "port_forward",
            command: `rexec forward ${LOCAL_PORT}:${REMOTE_PORT}`,
            verdict: "PASS",
            exit_code: 0,
            duration_ms: 1200
        })

        console.log("\n======================================================")
        console.log("ALL PORT FORWARD TESTS PASSED!")
        console.log("======================================================\n")
    } catch (err) {
        record_history({
            test_name: "port_forward",
            command: `rexec forward ${LOCAL_PORT}:${REMOTE_PORT}`,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 1200,
            error_message: (err as Error).message
        })
        console.error(`[test:forward failed]`, err)
        process.exit(1)
    } finally {
        abort_controller.abort()
        target_server.close()
        target_server_2.close()
        await Promise.allSettled([forward_promise, forward_promise_2])
        process.exit(0)
    }
}

run().catch((err) => {
    console.error(`[test:forward fatal]`, err)
    process.exit(1)
})
