import { execFileSync, spawn } from "node:child_process"
import { RexecCaller } from "@/caller"
import { DEBUG_TOKEN, print_verdict, read_debug_config, record_history } from "./helpers"

function leaked(marker: string): string[] {
    const out = execFileSync("ps", ["-eo", "stat,args"], { encoding: "utf8" })
    return out.split("\n").filter((line) => {
        if (!line.includes(marker)) return false
        if (line.includes("bash") || line.includes("sh -c") || line.includes("node") || line.includes("tsx"))
            return false
        const stat = line.trim().split(/\s+/, 1)[0] ?? ""
        return !stat.startsWith("Z")
    })
}

async function wait_until(predicate: () => boolean, timeout_ms: number): Promise<boolean> {
    const started = Date.now()
    while (Date.now() - started < timeout_ms) {
        if (predicate()) return true
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return predicate()
}

async function run(): Promise<void> {
    const config = read_debug_config()
    const caller = new RexecCaller({ hub_url: config.hub_url, token: DEBUG_TOKEN })
    const started = Date.now()
    const failures: string[] = []

    const exec_marker = "rx-orphan-ex"
    try {
        console.log("[test:orphan] Aborting an exec command...")
        const abort_controller = new AbortController()
        const pending = caller.exec(
            { cmd: `bash -c 'exec -a ${exec_marker} sleep 120'`, signal: abort_controller.signal },
            () => {}
        )
        const appeared = await wait_until(() => leaked(exec_marker).length > 0, 8000)
        if (!appeared) throw new Error(`exec marker did not start: ${exec_marker}`)
        abort_controller.abort()
        await pending.catch(() => {})
        const gone = await wait_until(() => leaked(exec_marker).length === 0, 4000)
        if (!gone) throw new Error(`exec process still running:\n${leaked(exec_marker).join("\n")}`)
        console.log("✓ exec process exited after caller abort")
    } catch (err) {
        failures.push(`exec: ${(err as Error).message}`)
    }

    const pty_marker = "rx-orphan-pty"
    try {
        console.log("[test:orphan] Closing a PTY session...")
        const session = await caller.open_pty({
            file: "bash",
            args: ["-c", `exec -a ${pty_marker} sleep 120 & wait`]
        })
        const appeared = await wait_until(() => leaked(pty_marker).length > 0, 20000)
        if (!appeared) throw new Error(`pty marker did not start: ${pty_marker}`)
        session.close()
        const gone = await wait_until(() => leaked(pty_marker).length === 0, 4000)
        if (!gone) throw new Error(`pty process still running:\n${leaked(pty_marker).join("\n")}`)
        console.log("✓ pty process exited after caller close")
    } catch (err) {
        failures.push(`pty: ${(err as Error).message}`)
    }

    const hold_marker = "rx-orphan-die"
    try {
        console.log("[test:orphan] Killing the caller process without a close frame...")
        const hub_ws = config.hub_url.replace(/^http/, "ws")
        const pty_url = `${hub_ws}/ws/pty?token=${DEBUG_TOKEN}`
        const child = spawn(
            process.execPath,
            [
                "--experimental-websocket",
                "-e",
                `
                    const ws = new WebSocket(${JSON.stringify(pty_url)})
                    ws.onmessage = (ev) => {
                        if (typeof ev.data !== "string") return
                        const msg = JSON.parse(ev.data)
                        if (msg.type !== "pty:ready") return
                        ws.send(JSON.stringify({
                            type: "pty:open",
                            session_id: msg.session_id,
                            file: "bash",
                            args: ["-c", ${JSON.stringify(`exec -a ${hold_marker} sleep 120 & wait`)}],
                            cols: 80,
                            rows: 24
                        }))
                        console.log("HELD")
                    }
                    setInterval(() => {}, 1 << 30)
                `
            ],
            { stdio: ["ignore", "pipe", "pipe"] }
        )
        let held = false
        let child_log = ""
        let child_exit: number | null = null
        child.on("close", (code) => {
            child_exit = code ?? 0
        })
        child.stdout.on("data", (chunk: Buffer) => {
            child_log += chunk.toString("utf8")
            if (child_log.includes("HELD")) held = true
        })
        child.stderr.on("data", (chunk: Buffer) => {
            child_log += chunk.toString("utf8")
        })
        const ready = await wait_until(() => held && leaked(hold_marker).length > 0, 20000)
        if (!ready) throw new Error(`held pty did not start\n${child_log}`)
        child.kill("SIGKILL")
        const exited = await wait_until(() => child_exit !== null, 3000)
        if (!exited) throw new Error("caller process did not die")
        const gone = await wait_until(() => leaked(hold_marker).length === 0, 4000)
        if (!gone)
            throw new Error(`pty process still running after caller was killed:\n${leaked(hold_marker).join("\n")}`)
        console.log("✓ pty process exited after caller process was killed")
    } catch (err) {
        failures.push(`pty-kill: ${(err as Error).message}`)
    }

    const passed = failures.length === 0
    print_verdict("test:orphan", passed, failures.join(" | "))
    record_history({
        test_name: "test:orphan",
        command: "caller exit reaps agent processes",
        verdict: passed ? "PASS" : "FAIL",
        exit_code: passed ? 0 : 1,
        duration_ms: Date.now() - started,
        error_message: failures.join(" | ") || undefined
    })
    process.exit(passed ? 0 : 1)
}

run().catch((err) => {
    console.error("[orphan test fatal]", err)
    process.exit(1)
})
