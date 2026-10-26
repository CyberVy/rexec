import { print_verdict, read_debug_config, record_history, run_rexec } from "./helpers"

async function run_basic_tests(): Promise<boolean> {
    const config = read_debug_config()
    let all_passed = true

    // 1. Health Status Test
    const test_1 = "test:hub_health"
    try {
        const res = await fetch(`${config.hub_url}/health`)
        const data = (await res.json()) as { status: string; agent_connected: boolean }
        const passed = res.ok && data.status === "ok" && data.agent_connected === true
        print_verdict(test_1, passed, passed ? undefined : JSON.stringify(data))
        record_history({
            test_name: test_1,
            command: "GET /health",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.status,
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
        const res = await fetch(`${config.hub_url}/ws`)
        const passed = res.status === 401 || res.status === 400
        print_verdict(test_4, passed, `status: ${res.status} (expected 401)`)
        record_history({
            test_name: test_4,
            command: "GET /ws (no token)",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.status,
            duration_ms: 0
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_4, false, (err as Error).message)
        record_history({
            test_name: test_4,
            command: "GET /ws (no token)",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 5. Verify Authorization Header Accepted on /ws
    const test_5 = "test:auth_header_accepted_for_ws"
    try {
        // A GET /ws with Authorization header passes the auth barrier (fails with 426 Upgrade Required, NOT 401)
        const res = await fetch(`${config.hub_url}/ws`, {
            headers: { Authorization: `Bearer test-token` }
        })
        const passed = res.status === 426
        print_verdict(test_5, passed, `status: ${res.status} (expected 426 Upgrade Required)`)
        record_history({
            test_name: test_5,
            command: "GET /ws (with Authorization header)",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.status,
            duration_ms: 0
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_5, false, (err as Error).message)
        record_history({
            test_name: test_5,
            command: "GET /ws (with Authorization header)",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 6. Token Session Takeover Test (Preemption / Last Write Wins)
    const test_6 = "test:token_session_takeover"
    try {
        const takeover_token = "rexec-takeover-token"
        const ws_base = `${config.hub_url.replace(/^http/, "ws")}/ws?token=${takeover_token}&node_id=initial-node`
        const ws1 = new WebSocket(ws_base)
        await new Promise<void>((resolve, reject) => {
            ws1.addEventListener("open", () => resolve())
            ws1.addEventListener("error", (e) => reject(e))
        })

        let ws1_closed_cleanly = false
        ws1.addEventListener("close", (e) => {
            if (e.code === 1000) ws1_closed_cleanly = true
        })

        const ws2_base = `${config.hub_url.replace(/^http/, "ws")}/ws?token=${takeover_token}&node_id=reconnected-node`
        const ws2 = new WebSocket(ws2_base)
        const ws2_opened = await new Promise<boolean>((resolve) => {
            ws2.addEventListener("open", () => resolve(true))
            ws2.addEventListener("error", () => resolve(false))
            setTimeout(() => resolve(false), 3000)
        })

        await new Promise((resolve) => setTimeout(resolve, 200))

        const passed = ws2_opened && ws1_closed_cleanly
        print_verdict(test_6, passed, `ws2_opened: ${ws2_opened}, ws1_closed_cleanly: ${ws1_closed_cleanly}`)
        record_history({
            test_name: test_6,
            command: "Token session takeover (last write wins)",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: passed ? 0 : 1,
            duration_ms: 0
        })
        if (!passed) all_passed = false
        ws2.close()
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
