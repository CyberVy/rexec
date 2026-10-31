import http from "node:http"
import { RexecCaller } from "@/caller"
import { run_port_forward } from "@/caller/terminal/forward"
import { DEBUG_TOKEN, read_debug_config, record_history } from "./helpers"

async function run(): Promise<void> {
    const config = read_debug_config()
    const caller = new RexecCaller({ hub_url: config.hub_url, token: DEBUG_TOKEN })

    const REMOTE_PORT = 18989
    const LOCAL_PORT = 19898

    console.log(`[test:forward] Starting mock target HTTP server on port ${REMOTE_PORT}...`)
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
        res.end(JSON.stringify({ status: "ok", url: req.url }))
    })

    await new Promise<void>((resolve) => {
        target_server.listen(REMOTE_PORT, "127.0.0.1", () => resolve())
    })

    const abort_controller = new AbortController()
    console.log(`[test:forward] Launching port forward ${LOCAL_PORT} -> ${REMOTE_PORT}...`)

    const forward_promise = run_port_forward(caller, LOCAL_PORT, REMOTE_PORT, {
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

        console.log(`[test:forward] Testing concurrent requests (10 parallel fetches)...`)
        const concurrent_reqs = Array.from({ length: 10 }, async (_, i) => {
            const r = await fetch(`http://127.0.0.1:${LOCAL_PORT}/concurrent-${i}`)
            const json = (await r.json()) as { url: string }
            if (json.url !== `/concurrent-${i}`) {
                throw new Error(`Concurrency mismatch: ${JSON.stringify(json)}`)
            }
        })
        await Promise.all(concurrent_reqs)
        console.log(`✓ 10 concurrent requests successfully multiplexed!`)

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
        await forward_promise.catch(() => {})
        process.exit(0)
    }
}

run().catch((err) => {
    console.error(`[test:forward fatal]`, err)
    process.exit(1)
})
