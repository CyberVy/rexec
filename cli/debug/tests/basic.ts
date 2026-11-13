import { DEBUG_TOKEN, print_verdict, read_debug_config, record_history, run_rexec } from "./helpers"

async function run_basic_tests(): Promise<boolean> {
    const config = read_debug_config()
    let all_passed = true

    // 1. Health Status Test
    const test_1 = "test:hub_health"
    try {
        const [res_global, res_token] = await Promise.all([
            fetch(`${config.hub_url}/health`),
            fetch(`${config.hub_url}/health?token=${encodeURIComponent(DEBUG_TOKEN)}`)
        ])
        const data_global = (await res_global.json()) as { status: string; agent_connected: boolean }
        const data_token = (await res_token.json()) as {
            status: string
            agent_connected: boolean
            channels?: { pty: boolean; forward: boolean; exec: boolean; file: boolean }
        }
        const passed =
            res_global.ok &&
            res_token.ok &&
            data_global.status === "ok" &&
            data_global.agent_connected === true &&
            data_token.agent_connected === true &&
            data_token.channels?.pty === true &&
            data_token.channels?.forward === true &&
            data_token.channels?.exec === true &&
            data_token.channels?.file === true
        print_verdict(test_1, passed, passed ? undefined : JSON.stringify({ data_global, data_token }))
        record_history({
            test_name: test_1,
            command: "GET /health",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res_token.status,
            duration_ms: 0
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_1, false, (err as Error).message)
        record_history({
            test_name: test_1,
            command: "GET /health",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 2. Stdout Echo Test
    const test_2 = "test:stdout_echo"
    const cmd_2 = `echo "rexec test message"`
    try {
        const res = await run_rexec(cmd_2)
        const passed = res.exit_code === 0 && res.stdout.includes("rexec test message")
        print_verdict(test_2, passed, `received: "${res.stdout.trim()}" (code: ${res.exit_code})`)
        record_history({
            test_name: test_2,
            command: cmd_2,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_2, false, (err as Error).message)
        record_history({
            test_name: test_2,
            command: cmd_2,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 3. Stderr & Non-zero Exit Code Test
    const test_3 = "test:stderr_and_exit_code"
    const cmd_3 = `node -e 'process.stderr.write("critical remote error\\n"); process.exit(42)'`
    try {
        const res = await run_rexec(cmd_3)
        const passed = res.exit_code === 42 && res.stderr.includes("critical remote error")
        print_verdict(test_3, passed, `code: ${res.exit_code}, stderr: "${res.stderr.trim()}"`)
        record_history({
            test_name: test_3,
            command: cmd_3,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_3, false, (err as Error).message)
        record_history({
            test_name: test_3,
            command: cmd_3,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 4. Reject Unauthenticated Registration Test
    const test_4 = "test:reject_unauthenticated_registration"
    try {
        const res = await fetch(`${config.hub_url}/ws/agent/pty`)
        const passed = res.status === 401 || res.status === 400
        print_verdict(test_4, passed, `status: ${res.status} (expected 401)`)
        record_history({
            test_name: test_4,
            command: "GET /ws/agent/pty (no token)",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.status,
            duration_ms: 0
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_4, false, (err as Error).message)
        record_history({
            test_name: test_4,
            command: "GET /ws/agent/pty (no token)",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 5. Verify Authorization Header Accepted on /ws/agent/pty
    const test_5 = "test:auth_header_accepted_for_ws"
    try {
        const res = await fetch(`${config.hub_url}/ws/agent/pty`, {
            headers: { Authorization: `Bearer test-token` }
        })
        const passed = res.status === 426
        print_verdict(test_5, passed, `status: ${res.status} (expected 426 Upgrade Required)`)
        record_history({
            test_name: test_5,
            command: "GET /ws/agent/pty (with Authorization header)",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.status,
            duration_ms: 0
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_5, false, (err as Error).message)
        record_history({
            test_name: test_5,
            command: "GET /ws/agent/pty (with Authorization header)",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 6. Token Session Takeover Test (instance_id preemption + same-instance multi-channel)
    const test_6 = "test:token_session_takeover"
    try {
        const takeover_token = "rexec-takeover-token"
        const ws_origin = config.hub_url.replace(/^http/, "ws")
        const open_ws = (url: string) =>
            new Promise<WebSocket>((resolve, reject) => {
                const ws = new WebSocket(url)
                ws.addEventListener("open", () => resolve(ws))
                ws.addEventListener("error", (e) => reject(e))
            })

        const ws1_pty = await open_ws(
            `${ws_origin}/ws/agent/pty?token=${takeover_token}&node_id=initial-node&instance_id=inst-1`
        )
        const ws1_exec = await open_ws(
            `${ws_origin}/ws/agent/exec?token=${takeover_token}&node_id=initial-node&instance_id=inst-1`
        )

        let ws1_pty_closed = false
        let ws1_exec_closed = false
        ws1_pty.addEventListener("close", (e) => {
            if (e.code === 1000) ws1_pty_closed = true
        })
        ws1_exec.addEventListener("close", (e) => {
            if (e.code === 1000) ws1_exec_closed = true
        })

        const ws2_pty = await open_ws(
            `${ws_origin}/ws/agent/pty?token=${takeover_token}&node_id=reconnected-node&instance_id=inst-2`
        )
        const ws2_forward = await open_ws(
            `${ws_origin}/ws/agent/forward?token=${takeover_token}&node_id=reconnected-node&instance_id=inst-2`
        )

        await new Promise((resolve) => setTimeout(resolve, 200))

        const health_res = await fetch(`${config.hub_url}/health?token=${takeover_token}`)
        const health = (await health_res.json()) as {
            channels?: { pty: boolean; forward: boolean; exec: boolean; file: boolean }
        }
        const passed =
            ws2_pty.readyState === WebSocket.OPEN &&
            ws2_forward.readyState === WebSocket.OPEN &&
            ws1_pty_closed &&
            ws1_exec_closed &&
            health.channels?.pty === true &&
            health.channels?.forward === true &&
            health.channels?.exec === false
        print_verdict(
            test_6,
            passed,
            `ws1_pty_closed=${ws1_pty_closed}, ws1_exec_closed=${ws1_exec_closed}, channels=${JSON.stringify(health.channels)}`
        )
        record_history({
            test_name: test_6,
            command: "Token session takeover (instance_id isolation)",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: passed ? 0 : 1,
            duration_ms: 0
        })
        if (!passed) all_passed = false
        ws2_pty.close()
        ws2_forward.close()
    } catch (err) {
        print_verdict(test_6, false, (err as Error).message)
        record_history({
            test_name: test_6,
            command: "Token session takeover (last write wins)",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 7. CORS Preflight & Headers Test
    const test_7 = "test:cors_support"
    try {
        const test_origin = "http://localhost:5173"
        const res_options = await fetch(`${config.hub_url}/exec`, {
            method: "OPTIONS",
            headers: {
                Origin: test_origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, content-type"
            }
        })
        const origin_header = res_options.headers.get("access-control-allow-origin")
        const methods_header = res_options.headers.get("access-control-allow-methods")
        const passed =
            res_options.status === 204 && origin_header === test_origin && methods_header?.includes("POST") === true
        print_verdict(test_7, passed, `status: ${res_options.status}, origin: ${origin_header}`)
        record_history({
            test_name: test_7,
            command: "OPTIONS /exec (CORS preflight)",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res_options.status,
            duration_ms: 0
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_7, false, (err as Error).message)
        record_history({
            test_name: test_7,
            command: "OPTIONS /exec (CORS preflight)",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    return all_passed
}

run_basic_tests()
    .then((passed) => {
        process.exit(passed ? 0 : 1)
    })
    .catch((err) => {
        console.error("[basic test fatal]", err)
        process.exit(1)
    })
