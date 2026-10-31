import { spawn } from "node:child_process"
import { RexecCaller } from "@/caller"
import { CLI_BIN, DEBUG_TOKEN, read_debug_config, record_history } from "./helpers"

async function run_cli(
    args: string[],
    timeout_ms: number
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
    const config = read_debug_config()
    const child = spawn("node", [CLI_BIN, "--hub", config.hub_url, "--token", DEBUG_TOKEN, ...args], {
        cwd: process.cwd()
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8")
    })

    const exit_code = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill("SIGKILL")
            reject(new Error(`timed out after ${timeout_ms}ms\nstdout=${stdout}\nstderr=${stderr}`))
        }, timeout_ms)
        child.on("close", (code) => {
            clearTimeout(timer)
            resolve(code ?? 0)
        })
    })
    return { stdout, stderr, exit_code }
}

async function run(): Promise<void> {
    const config = read_debug_config()
    const caller = new RexecCaller({ hub_url: config.hub_url, token: DEBUG_TOKEN })
    const started = Date.now()

    try {
        console.log("[test:tty] Checking the remote command sees a TTY...")
        const cli = await run_cli(
            ["tty", "sh", "-c", "if [ -t 0 ]; then echo tty-yes; else echo tty-no; fi; exit 7"],
            20000
        )
        if (!cli.stdout.includes("tty-yes")) {
            throw new Error(`Expected tty-yes, got ${JSON.stringify(cli.stdout)} stderr=${cli.stderr}`)
        }
        if (cli.exit_code !== 7) {
            throw new Error(`Expected exit 7, got ${cli.exit_code} stderr=${cli.stderr}`)
        }
        console.log("✓ tty-yes and exit code 7")

        console.log("[test:tty] Checking input and resize...")
        const session = await caller.open_pty({
            file: "sh",
            args: ["-c", "read line; printf 'got:%s\\n' \"$line\"; sleep 0.4; stty size"],
            cols: 80,
            rows: 24,
            term: "xterm-256color"
        })
        let output = ""
        session.on_data((data) => {
            output += Buffer.from(data).toString("utf-8")
        })
        session.send(new TextEncoder().encode("abc\n"))
        await new Promise((resolve) => setTimeout(resolve, 150))
        session.resize(100, 40)

        const status = await Promise.race([
            session.exited,
            new Promise<never>((_, reject) => {
                setTimeout(
                    () => reject(new Error(`timed out waiting for exit\noutput=${JSON.stringify(output)}`)),
                    10000
                )
            })
        ])
        session.close()

        if (!output.includes("got:abc")) {
            throw new Error(`Expected got:abc, got ${JSON.stringify(output)}`)
        }
        if (!output.includes("40 100")) {
            throw new Error(`Expected resized tty size 40 100, got ${JSON.stringify(output)}`)
        }
        if (status.code !== 0 || status.signal !== 0) {
            throw new Error(`Expected clean exit, got code=${status.code} signal=${status.signal}`)
        }
        console.log("✓ input and resize")

        console.log("[test:tty] Checking detach, RingBuffer buffering and re-attach...")
        const session1 = await caller.open_pty({
            file: "sh",
            args: ["-c", "echo 'INITIAL_LINE'; sleep 0.6; echo 'DISCONNECTED_LINE'; sleep 0.6; echo 'FINAL_LINE'"],
            cols: 80,
            rows: 24,
            orphan_ttl_ms: 10000
        })
        let s1_output = ""
        session1.on_data((data) => {
            s1_output += Buffer.from(data).toString("utf-8")
        })

        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Timeout waiting for INITIAL_LINE")), 5000)
            const check = setInterval(() => {
                if (s1_output.includes("INITIAL_LINE")) {
                    clearTimeout(timer)
                    clearInterval(check)
                    resolve()
                }
            }, 100)
        })

        const saved_session_id = session1.session_id
        session1.detach()

        // Wait while disconnected so DISCONNECTED_LINE is emitted to RingBuffer
        await new Promise((resolve) => setTimeout(resolve, 800))

        console.log(`[test:tty] Re-attaching to session ${saved_session_id}...`)
        const session2 = await caller.open_pty({
            session_id: saved_session_id,
            cols: 80,
            rows: 24
        })

        let s2_output = ""
        session2.on_data((data) => {
            s2_output += Buffer.from(data).toString("utf-8")
        })

        const s2_status = await Promise.race([
            session2.exited,
            new Promise<never>((_, reject) => {
                setTimeout(
                    () =>
                        reject(
                            new Error(`timed out waiting for re-attached exit\ns2_output=${JSON.stringify(s2_output)}`)
                        ),
                    10000
                )
            })
        ])
        session2.close()

        if (!s2_output.includes("INITIAL_LINE")) {
            throw new Error(`Expected replayed INITIAL_LINE in re-attached session, got: ${JSON.stringify(s2_output)}`)
        }
        if (!s2_output.includes("DISCONNECTED_LINE")) {
            throw new Error(
                `Expected replayed DISCONNECTED_LINE in re-attached session, got: ${JSON.stringify(s2_output)}`
            )
        }
        if (!s2_output.includes("FINAL_LINE")) {
            throw new Error(`Expected FINAL_LINE in re-attached session, got: ${JSON.stringify(s2_output)}`)
        }
        if (s2_status.code !== 0) {
            throw new Error(`Expected clean exit on re-attached session, got code=${s2_status.code}`)
        }
        console.log("✓ detach, ring buffer replay and re-attach passed")

        record_history({
            test_name: "tty",
            command: "rexec tty",
            verdict: "PASS",
            exit_code: 0,
            duration_ms: Date.now() - started
        })
        console.log("✓ tty test passed")
        process.exit(0)
    } catch (err) {
        record_history({
            test_name: "tty",
            command: "rexec tty",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: Date.now() - started,
            error_message: (err as Error).message
        })
        console.error(`✗ tty test failed: ${(err as Error).message}`)
        process.exit(1)
    }
}

run().catch((err) => {
    console.error("[test:tty fatal]", err)
    process.exit(1)
})
