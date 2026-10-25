import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DEBUG_DIR, print_verdict, record_history, run_rexec, run_rexec_cli } from "./helpers"

async function run_file_transfer_tests(): Promise<boolean> {
    let all_passed = true
    const tmp_test_dir = path.join(DEBUG_DIR, "transfer_test")
    fs.mkdirSync(tmp_test_dir, { recursive: true })

    // 1. Text File Push Test
    const test_1 = "test:file_push_text"
    const local_text_file = path.join(tmp_test_dir, "test_input.txt")
    const remote_text_filename = "remote_test_input.txt"
    const sample_text = "rexec file transfer test payload - line 1\nline 2 with utf8: 🚀 测试"
    fs.writeFileSync(local_text_file, sample_text, "utf-8")

    try {
        const res = await run_rexec_cli(["push", local_text_file, remote_text_filename])
        const verify_res = await run_rexec(`cat ${remote_text_filename}`)
        const passed = res.exit_code === 0 && verify_res.stdout === sample_text
        print_verdict(test_1, passed, passed ? undefined : `push code: ${res.exit_code}, content: ${verify_res.stdout}`)
        record_history({
            test_name: test_1,
            command: `rexec push ${local_text_file} ${remote_text_filename}`,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_1, false, (err as Error).message)
        all_passed = false
    }

    // 2. Text File Pull Test
    const test_2 = "test:file_pull_text"
    const downloaded_text_file = path.join(tmp_test_dir, "downloaded_test.txt")
    try {
        const res = await run_rexec_cli(["pull", remote_text_filename, downloaded_text_file, "-f"])
        const downloaded_content = fs.existsSync(downloaded_text_file)
            ? fs.readFileSync(downloaded_text_file, "utf-8")
            : ""
        const passed = res.exit_code === 0 && downloaded_content === sample_text
        print_verdict(test_2, passed, passed ? undefined : `pull code: ${res.exit_code}`)
        record_history({
            test_name: test_2,
            command: `rexec pull ${remote_text_filename} ${downloaded_text_file}`,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_2, false, (err as Error).message)
        all_passed = false
    }

    // 2b. Pull Into Non-Existent Nested Directory Test
    const test_2b = "test:file_pull_nested_nonexistent_dir"
    const nested_dest_file = path.join(tmp_test_dir, "nested_dir_1", "nested_dir_2", "nested_file.txt")
    try {
        const res = await run_rexec_cli(["pull", remote_text_filename, nested_dest_file, "-f"])
        const downloaded_content = fs.existsSync(nested_dest_file) ? fs.readFileSync(nested_dest_file, "utf-8") : ""
        const passed = res.exit_code === 0 && downloaded_content === sample_text
        print_verdict(test_2b, passed, passed ? undefined : `pull code: ${res.exit_code}`)
        record_history({
            test_name: test_2b,
            command: `rexec pull ${remote_text_filename} ${nested_dest_file}`,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_2b, false, (err as Error).message)
        all_passed = false
    }

    // 3. Binary File Push Test (512 KB random raw bytes)
    const test_3 = "test:file_push_binary"
    const local_bin_file = path.join(tmp_test_dir, "test_binary.dat")
    const remote_bin_filename = "remote_binary.dat"
    const binary_data = crypto.randomBytes(512 * 1024)
    fs.writeFileSync(local_bin_file, binary_data)
    const original_sha256 = crypto.createHash("sha256").update(binary_data).digest("hex")

    try {
        const res = await run_rexec_cli(["push", local_bin_file, remote_bin_filename])
        const verify_res = await run_rexec(`node -e "
            const fs = require('fs');
            const crypto = require('crypto');
            const buf = fs.readFileSync('${remote_bin_filename}');
            const hash = crypto.createHash('sha256').update(buf).digest('hex');
            process.stdout.write(hash);
        "`)
        const remote_sha256 = verify_res.stdout.trim()
        const passed = res.exit_code === 0 && remote_sha256 === original_sha256
        print_verdict(test_3, passed, passed ? undefined : `local: ${original_sha256}, remote: ${remote_sha256}`)
        record_history({
            test_name: test_3,
            command: `rexec push ${local_bin_file} ${remote_bin_filename}`,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_3, false, (err as Error).message)
        all_passed = false
    }

    // 4. Binary File Pull Test
    const test_4 = "test:file_pull_binary"
    const downloaded_bin_file = path.join(tmp_test_dir, "downloaded_binary.dat")
    try {
        const res = await run_rexec_cli(["pull", remote_bin_filename, downloaded_bin_file, "-f"])
        const downloaded_buf = fs.existsSync(downloaded_bin_file)
            ? fs.readFileSync(downloaded_bin_file)
            : Buffer.alloc(0)
        const downloaded_sha256 = crypto.createHash("sha256").update(downloaded_buf).digest("hex")
        const passed = res.exit_code === 0 && downloaded_sha256 === original_sha256
        print_verdict(test_4, passed, passed ? undefined : `expected: ${original_sha256}, got: ${downloaded_sha256}`)
        record_history({
            test_name: test_4,
            command: `rexec pull ${remote_bin_filename} ${downloaded_bin_file}`,
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_4, false, (err as Error).message)
        all_passed = false
    }

    // 5. Pull Non-Existent File Error Test
    const test_5 = "test:file_pull_not_found"
    try {
        const res = await run_rexec_cli(["pull", "non_existent_file_xyz_123.tmp"])
        const passed = res.exit_code === 1 && res.stderr.includes("File not found")
        print_verdict(test_5, passed, `exit_code: ${res.exit_code}, stderr: ${res.stderr.trim()}`)
        record_history({
            test_name: test_5,
            command: "rexec pull non_existent_file_xyz_123.tmp",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_5, false, (err as Error).message)
        all_passed = false
    }

    // 6. Double Dash Escape Test
    const test_6 = "test:double_dash_escape"
    try {
        const res = await run_rexec_cli(["--", "echo", "escaped_arg_1"])
        const passed = res.exit_code === 0 && res.stdout.includes("escaped_arg_1")
        print_verdict(test_6, passed, `exit_code: ${res.exit_code}, stdout: ${res.stdout.trim()}`)
        record_history({
            test_name: test_6,
            command: "rexec -- echo escaped_arg_1",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_6, false, (err as Error).message)
        all_passed = false
    }

    // 7. Explicit "run" Subcommand Test
    const test_7 = "test:explicit_run_command"
    try {
        const res = await run_rexec_cli(["run", "echo", "explicit_run_succeeded"])
        const passed = res.exit_code === 0 && res.stdout.includes("explicit_run_succeeded")
        print_verdict(test_7, passed, `exit_code: ${res.exit_code}, stdout: ${res.stdout.trim()}`)
        record_history({
            test_name: test_7,
            command: "rexec run echo explicit_run_succeeded",
            verdict: passed ? "PASS" : "FAIL",
            exit_code: res.exit_code,
            duration_ms: res.duration_ms
        })
        if (!passed) all_passed = false
    } catch (err) {
        print_verdict(test_7, false, (err as Error).message)
        all_passed = false
    }

    // Cleanup remote test files
    await run_rexec(`rm -f ${remote_text_filename} ${remote_bin_filename}`)
    fs.rmSync(tmp_test_dir, { recursive: true, force: true })

    return all_passed
}

run_file_transfer_tests().then((passed) => {
    process.exit(passed ? 0 : 1)
})
