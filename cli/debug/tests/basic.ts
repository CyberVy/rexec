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
