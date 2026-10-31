import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { read_debug_config } from "./helpers"

const script_dir = path.dirname(fileURLToPath(import.meta.url))

const TEST_FILES = [
    "basic.ts",
    "env_cwd.ts",
    "abort.ts",
    "orphan.ts",
    "large_output.ts",
    "file_transfer.ts",
    "forward.ts",
    "tty.ts",
    "heartbeat.ts",
    "vscode_extension.ts"
]

async function run_test_suite(file_name: string): Promise<boolean> {
    const file_path = path.join(script_dir, file_name)
    const child = spawn("npx", ["tsx", file_path], {
        stdio: "inherit"
    })

    return new Promise<boolean>((resolve) => {
        child.on("close", (code) => {
            resolve(code === 0)
        })
    })
}

async function main(): Promise<void> {
    // Check if server is running
    read_debug_config()

    console.log(`\n======================================================`)
    console.log(`Running Rexec Automated Test Matrix`)
    console.log(`======================================================\n`)

    let total_passed = 0
    let total_failed = 0

    for (const test_file of TEST_FILES) {
        console.log(`--- Running suite: ${test_file} ---`)
        const passed = await run_test_suite(test_file)
        if (passed) {
            total_passed++
        } else {
            total_failed++
        }
        console.log("")
    }

    console.log(`======================================================`)
    console.log(`Test Summary: ${total_passed} Passed, ${total_failed} Failed`)
    console.log(`History Log : .debug/engine/history.jsonl`)
    console.log(`======================================================\n`)

    process.exit(total_failed === 0 ? 0 : 1)
}

main().catch((err) => {
    console.error("[run_all fatal]", (err as Error).message)
    process.exit(1)
})
