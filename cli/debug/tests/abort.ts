import { print_verdict, record_history, run_rexec } from "./helpers"

async function run_abort_tests(): Promise<boolean> {
    const test_name = "test:sigint_abort"
    const cmd = "node -e 'setTimeout(() => console.log(\"should_not_reach\"), 10000)'"

    try {
        const res = await run_rexec(cmd, { abort_after_ms: 500 })
        // When client aborts with SIGINT, exit code should be 130 and duration should be well under 10000ms
        const passed = res.duration_ms < 3000 && !res.stdout.includes("should_not_reach")
        print_verdict(
            test_name,
            passed,
            `duration: ${res.duration_ms}ms, exit_code: ${res.exit_code}, stdout: "${res.stdout.trim()}"`
        )

        record_history({
            test_name,
            command: `${cmd} (aborted after 500ms)`,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })

        return passed
    } catch (err) {
        print_verdict(test_name, false, (err as Error).message)
        record_history({
            test_name,
            command: cmd,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        return false
    }
}

run_abort_tests()
    .then((passed) => {
        process.exit(passed ? 0 : 1)
    })
    .catch((err) => {
        console.error("[abort test fatal]", err)
        process.exit(1)
    })
