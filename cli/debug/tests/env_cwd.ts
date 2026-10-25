import fs from "node:fs"
import path from "node:path"
import { DEBUG_DIR, print_verdict, record_history, run_rexec } from "./helpers"

async function run_env_cwd_tests(): Promise<boolean> {
    let all_passed = true

    // Prepare a subfolder in the debug workspace
    const workspace_dir = path.join(DEBUG_DIR, "workspace")
    const sub_dir = path.join(workspace_dir, "test_subdir")
    fs.mkdirSync(sub_dir, { recursive: true })

    // 1. Working Directory Test
    const test_1 = "test:cwd_isolation"
    const cmd_1 = "node -e 'console.log(process.cwd())'"
    try {
        const res = await run_rexec(cmd_1, { cwd: "test_subdir" })
        const normalized_stdout = res.stdout.trim()
        const passed = res.exit_code === 0 && normalized_stdout.endsWith("test_subdir")
        print_verdict(test_1, passed, `resolved cwd: "${normalized_stdout}"`)
        record_history({
            test_name: test_1,
            command: `${cmd_1} (--cwd test_subdir)`,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_1, false, (err as Error).message)
        record_history({
            test_name: test_1,
            command: cmd_1,
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: 0,
            error_message: (err as Error).message
        })
        all_passed = false
    }

    // 2. Command Pipeline / Shell Expansion Test
    const test_2 = "test:shell_pipeline_and_quotes"
    const cmd_2 = `echo "part1" && echo "part2" | tr 'a-z' 'A-Z'`
    try {
        const res = await run_rexec(cmd_2)
        const passed = res.exit_code === 0 && res.stdout.includes("part1") && res.stdout.includes("PART2")
        print_verdict(test_2, passed, `received: "${res.stdout.replace(/\n/g, ", ")}"`)
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

    return all_passed
}

run_env_cwd_tests()
    .then((passed) => {
        process.exit(passed ? 0 : 1)
    })
    .catch((err) => {
        console.error("[env_cwd test fatal]", err)
        process.exit(1)
    })
