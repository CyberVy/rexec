import { print_verdict, record_history, run_rexec } from "./helpers"

async function run_large_output_test(): Promise<boolean> {
    const test_name = "test:large_chunked_output"
    const line_count = 1000
    const cmd = `node -e 'for (let i = 1; i <= ${line_count}; i++) console.log("line_" + i);'`

    try {
        const res = await run_rexec(cmd)
        const lines = res.stdout
            .trim()
            .split("\n")
            .filter((l) => l.startsWith("line_"))

        const is_complete = lines.length === line_count
        const is_ordered = lines[0] === "line_1" && lines[line_count - 1] === `line_${line_count}`
        const passed = res.exit_code === 0 && is_complete && is_ordered

        print_verdict(
            test_name,
            passed,
            `lines received: ${lines.length}/${line_count}, duration: ${res.duration_ms}ms, exit_code: ${res.exit_code}`
        )

        record_history({
            test_name,
            command: cmd,
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

run_large_output_test()
    .then((passed) => {
        process.exit(passed ? 0 : 1)
    })
    .catch((err) => {
        console.error("[large_output test fatal]", err)
        process.exit(1)
    })
