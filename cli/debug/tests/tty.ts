import { spawn } from "node:child_process"
import net from "node:net"
import path from "node:path"
import { RexecCaller } from "@/caller"
import { parse_cli_args } from "@/caller/terminal/args"
import { run_tty } from "@/caller/terminal/tty"
import { CLI_BIN, DEBUG_TOKEN, read_debug_config, record_history, repo_root } from "./helpers"

interface ActiveSocketHandle {
    remotePort?: number
    destroyed?: boolean
    destroy?: () => void
}

function get_active_handles(): ActiveSocketHandle[] {
    const proc = process as unknown as { _getActiveHandles?: () => ActiveSocketHandle[] }
    return proc._getActiveHandles?.() ?? []
}

async function get_closed_port(): Promise<number> {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address() as net.AddressInfo
    const port = address.port
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

async function run_cli(
    args: string[],
    timeout_ms: number,
    stdin_input?: string
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
    if (stdin_input !== undefined) {
        child.stdin.write(stdin_input)
        child.stdin.end()
    }

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

        console.log("[test:tty] Checking incremental resume via byte offset...")
        const inc_session1 = await caller.open_pty({
            file: "sh",
            args: ["-c", "echo 'INC_BEFORE'; sleep 0.6; echo 'INC_AFTER'; sleep 1"],
            cols: 80,
            rows: 24,
            orphan_ttl_ms: 10000
        })
        let inc_s1_bytes = 0
        let inc_s1_output = ""
        inc_session1.on_data((data) => {
            inc_s1_bytes += data.byteLength
            inc_s1_output += Buffer.from(data).toString("utf-8")
        })
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Timeout waiting for INC_BEFORE")), 5000)
            const check = setInterval(() => {
                if (inc_s1_output.includes("INC_BEFORE\r\n") || inc_s1_output.includes("INC_BEFORE\n")) {
                    clearTimeout(timer)
                    clearInterval(check)
                    resolve()
                }
            }, 50)
        })
        const inc_id = inc_session1.session_id
        const resume_offset = inc_s1_bytes
        inc_session1.detach()

        await new Promise((resolve) => setTimeout(resolve, 800))

        const inc_session2 = await caller.open_pty({
            session_id: inc_id,
            offset: resume_offset,
            cols: 80,
            rows: 24
        })
        let inc_replay: { bytes: number; reset: boolean; offset?: number } | null = null
        let inc_s2_output = ""
        inc_session2.on_replay((info) => {
            inc_replay = info
        })
        inc_session2.on_data((data) => {
            inc_s2_output += Buffer.from(data).toString("utf-8")
        })
        const inc_status = await Promise.race([
            inc_session2.exited,
            new Promise<never>((_, reject) => {
                setTimeout(
                    () => reject(new Error(`timed out waiting for incremental resume\ns2=${inc_s2_output}`)),
                    10000
                )
            })
        ])
        inc_session2.close()
        const resolved_replay = inc_replay as { bytes: number; reset: boolean; offset?: number } | null
        if (!resolved_replay || resolved_replay.reset !== false) {
            throw new Error(`Expected incremental resume with reset=false, got ${JSON.stringify(resolved_replay)}`)
        }
        if (resolved_replay.offset !== resume_offset) {
            throw new Error(`Expected replay offset=${resume_offset}, got ${JSON.stringify(resolved_replay)}`)
        }
        if (!inc_s2_output.includes("INC_AFTER") || inc_s2_output.includes("INC_BEFORE")) {
            throw new Error(`Expected only INC_AFTER in incremental resume, got: ${JSON.stringify(inc_s2_output)}`)
        }
        if (inc_status.code !== 0) {
            throw new Error(`Expected clean exit on incremental resume, got code=${inc_status.code}`)
        }
        console.log("✓ incremental resume via byte offset passed")

        console.log("[test:tty] Checking list_ptys and kill_pty...")
        const session3 = await caller.open_pty({
            file: "sh",
            args: ["-c", "echo 'SESSION3_READY'; sleep 60"],
            orphan_ttl_ms: 10000
        })
        let s3_ready = false
        session3.on_data((data) => {
            if (Buffer.from(data).toString("utf-8").includes("SESSION3_READY")) {
                s3_ready = true
            }
        })
        const ready_timer = Date.now()
        while (!s3_ready && Date.now() - ready_timer < 5000) {
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!s3_ready) throw new Error("Timed out waiting for session3 to start")
        session3.detach()

        const list_before = await caller.list_ptys()
        const found = list_before.find((s) => s.session_id === session3.session_id)
        if (!found) {
            throw new Error(`Expected session ${session3.session_id} in list_ptys, got: ${JSON.stringify(list_before)}`)
        }
        if (found.status !== "detached") {
            throw new Error(`Expected status 'detached', got: ${found.status}`)
        }
        if (found.persistent !== false) {
            throw new Error(`Expected initial persistent=false, got: ${found.persistent}`)
        }

        console.log("[test:tty] Toggling session persistence on...")
        await caller.set_pty_persistent(session3.session_id, true)
        await new Promise((resolve) => setTimeout(resolve, 300))

        const list_persistent = await caller.list_ptys()
        const found_persistent = list_persistent.find((s) => s.session_id === session3.session_id)
        if (!found_persistent || !found_persistent.persistent) {
            throw new Error(
                `Expected persistent=true after set_pty_persistent(true), got: ${JSON.stringify(found_persistent)}`
            )
        }
        if (found_persistent.remaining_ttl_ms !== undefined) {
            throw new Error(
                `Expected remaining_ttl_ms=undefined when persistent, got: ${found_persistent.remaining_ttl_ms}`
            )
        }
        console.log("✓ session persistence enabled (no TTL)")

        console.log("[test:tty] Toggling session persistence off...")
        await caller.set_pty_persistent(session3.session_id, false)
        await new Promise((resolve) => setTimeout(resolve, 300))

        const list_restored = await caller.list_ptys()
        const found_restored = list_restored.find((s) => s.session_id === session3.session_id)
        if (!found_restored || found_restored.persistent !== false) {
            throw new Error(
                `Expected persistent=false after set_pty_persistent(false), got: ${JSON.stringify(found_restored)}`
            )
        }
        if (typeof found_restored.remaining_ttl_ms !== "number") {
            throw new Error(
                `Expected number remaining_ttl_ms when not persistent, got: ${found_restored.remaining_ttl_ms}`
            )
        }
        console.log("✓ session persistence disabled (TTL restored)")

        // Kill the session
        await caller.kill_pty(session3.session_id)
        await new Promise((resolve) => setTimeout(resolve, 400))

        const list_after = await caller.list_ptys()
        const still_exists = list_after.find((s) => s.session_id === session3.session_id)
        if (still_exists) {
            throw new Error(`Session ${session3.session_id} still exists after kill_pty`)
        }
        console.log("✓ list_ptys and kill_pty passed")

        if (process.platform !== "win32") {
            console.log("[test:tty] Checking default login shell and color environment...")
            const session4 = await caller.open_pty({
                cols: 80,
                rows: 24,
                term: "xterm-256color"
            })
            let s4_output = ""
            session4.on_data((data) => {
                s4_output += Buffer.from(data).toString("utf-8")
            })

            let listed_command = ""
            const list_deadline = Date.now() + 5000
            while (Date.now() < list_deadline) {
                const sessions = await caller.list_ptys()
                const found4 = sessions.find((s) => s.session_id === session4.session_id)
                if (found4) {
                    listed_command = found4.command
                    break
                }
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
            if (!listed_command.endsWith(" -l")) {
                throw new Error(`Expected default shell to use login flag (-l), got command: ${listed_command}`)
            }

            session4.send(
                new TextEncoder().encode(
                    'sh -c \'printf "ENV_CHECK:%s:%s:%s:%s:%s\\n" "$TERM" "$COLORTERM" "$CLICOLOR" "${FORCE_COLOR:-unset}" "${NO_COLOR:-unset}"\'; exit\n'
                )
            )
            const s4_status = await Promise.race([
                session4.exited,
                new Promise<never>((_, reject) => {
                    setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `timed out waiting for default shell exit\ns4_output=${JSON.stringify(s4_output)}`
                                )
                            ),
                        10000
                    )
                })
            ])
            session4.close()

            const expected_env = "ENV_CHECK:xterm-256color:truecolor:1:unset:unset"
            if (!s4_output.includes(expected_env)) {
                throw new Error(`Expected ${expected_env}, got: ${JSON.stringify(s4_output)}`)
            }
            if (s4_status.code !== 0) {
                throw new Error(`Expected clean exit on default shell, got code=${s4_status.code}`)
            }
            console.log(`✓ default login shell (${listed_command}) and color environment passed`)
        }

        console.log("[test:tty] Checking CLI flag parsing and passthrough...")
        const parsed_tty_cmd = parse_cli_args(["tty", "--persistent", "--cwd", "sub", "tail", "-f", "-r", "--help"])
        if (
            parsed_tty_cmd.subcommand !== "tty" ||
            parsed_tty_cmd.tty_action !== "run" ||
            !parsed_tty_cmd.persistent ||
            parsed_tty_cmd.cwd !== "sub" ||
            parsed_tty_cmd.force ||
            parsed_tty_cmd.recursive ||
            parsed_tty_cmd.help ||
            parsed_tty_cmd.args.join(" ") !== "tail -f -r --help"
        ) {
            throw new Error(`Unexpected parse_cli_args for tty command: ${JSON.stringify(parsed_tty_cmd)}`)
        }
        const parsed_tty_help = parse_cli_args(["tty", "--help"])
        if (!parsed_tty_help.help || parsed_tty_help.subcommand !== "tty") {
            throw new Error(`Expected tty --help to set help=true: ${JSON.stringify(parsed_tty_help)}`)
        }
        const parsed_tty_default = parse_cli_args(["tty", "--persistent"])
        if (
            parsed_tty_default.subcommand !== "tty" ||
            parsed_tty_default.tty_action !== "run" ||
            parsed_tty_default.args.length !== 0
        ) {
            throw new Error(`Unexpected parse_cli_args for default tty: ${JSON.stringify(parsed_tty_default)}`)
        }
        const parsed_pull = parse_cli_args(["pull", "remote.txt", "local.txt", "-f"])
        if (
            parsed_pull.subcommand !== "pull" ||
            !parsed_pull.force ||
            parsed_pull.args.join(" ") !== "remote.txt local.txt"
        ) {
            throw new Error(`Unexpected parse_cli_args for pull: ${JSON.stringify(parsed_pull)}`)
        }

        const passthrough_cli = await run_cli(["tty", "echo", "-f", "-r", "--help"], 15000)
        if (passthrough_cli.exit_code !== 0 || !passthrough_cli.stdout.includes("-f -r --help")) {
            throw new Error(
                `Expected tty flag passthrough '-f -r --help', got code=${passthrough_cli.exit_code} stdout=${JSON.stringify(passthrough_cli.stdout)} stderr=${passthrough_cli.stderr}`
            )
        }
        console.log("✓ CLI flag passthrough passed")

        console.log("[test:tty] Checking explicit pty:error fails without reconnecting...")
        let missing_err = ""
        const missing_started = Date.now()
        try {
            await run_tty(caller, { session_id: "0000000000000000" })
        } catch (err) {
            missing_err = (err as Error).message
        }
        if (missing_err !== "PTY session not found or expired" || Date.now() - missing_started > 3000) {
            throw new Error(
                `Expected fast PtySessionError on missing session, got err=${JSON.stringify(missing_err)} elapsed=${Date.now() - missing_started}ms`
            )
        }
        console.log("✓ explicit pty:error failed cleanly")

        if (process.platform !== "win32") {
            console.log("[test:tty] Checking 'rexec tty' with no command opens default login shell...")
            const default_cli = await run_cli(["tty"], 15000, "printf 'DEFAULT_TTY_CLI_OK\\n'; exit 5\n")
            if (default_cli.exit_code !== 5 || !default_cli.stdout.includes("DEFAULT_TTY_CLI_OK")) {
                throw new Error(
                    `Expected default 'rexec tty' shell exit 5 with DEFAULT_TTY_CLI_OK, got code=${default_cli.exit_code} stdout=${JSON.stringify(default_cli.stdout)} stderr=${default_cli.stderr}`
                )
            }
            console.log("✓ default 'rexec tty' login shell passed")
        }

        console.log("[test:tty] Checking run_tty auto-reconnect with incremental resume...")
        const tsx_bin = path.join(repo_root, "node_modules", ".bin", "tsx")
        const reconnect_script = `
            import { RexecCaller } from "./src/caller"
            import { run_tty } from "./src/caller/terminal/tty"
            const caller = new RexecCaller({ hub_url: ${JSON.stringify(config.hub_url)}, token: ${JSON.stringify(DEBUG_TOKEN)} })
            const hub_port = Number(new URL(${JSON.stringify(config.hub_url)}).port || 80)
            let dropped = false
            const orig_write = process.stdout.write.bind(process.stdout)
            process.stdout.write = ((chunk, encoding, cb) => {
                const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
                if (!dropped && text.includes("BEFORE_DROP")) {
                    dropped = true
                    setTimeout(() => {
                        const getter = process._getActiveHandles?.() ?? []
                        for (const h of getter) {
                            if (h && typeof h.destroy === "function" && !h.destroyed && h.remotePort === hub_port) {
                                h.destroy()
                            }
                        }
                    }, 50)
                }
                return orig_write(chunk, encoding, cb)
            })
            run_tty(caller, {
                file: "sh",
                args: ["-c", "echo BEFORE_DROP; sleep 1.6; echo AFTER_DROP; exit 9"]
            }).then((code) => process.exit(code))
        `
        const recon_proc = spawn(tsx_bin, ["-e", reconnect_script], {
            cwd: repo_root,
            stdio: ["pipe", "pipe", "pipe"]
        })
        let recon_out = ""
        let recon_err = ""
        recon_proc.stdout.on("data", (c: Buffer) => {
            recon_out += c.toString("utf8")
        })
        recon_proc.stderr.on("data", (c: Buffer) => {
            recon_err += c.toString("utf8")
        })
        const recon_code = await new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => {
                recon_proc.kill("SIGKILL")
                reject(new Error(`run_tty reconnect timed out\nout=${recon_out}\nerr=${recon_err}`))
            }, 15000)
            recon_proc.on("close", (code) => {
                clearTimeout(timer)
                resolve(code ?? 0)
            })
        })
        const before_count = recon_out.split("BEFORE_DROP").length - 1
        if (recon_code !== 9 || !recon_out.includes("AFTER_DROP") || before_count !== 1) {
            throw new Error(
                `Expected run_tty incremental reconnect exit 9 with 1 BEFORE_DROP and AFTER_DROP, got code=${recon_code} before_count=${before_count} out=${JSON.stringify(recon_out)} err=${JSON.stringify(recon_err)}`
            )
        }
        console.log("✓ run_tty incremental auto-reconnect passed")

        console.log("[test:tty] Checking connect_pty initial failure fails fast without retrying...")
        const dead_port = await get_closed_port()
        const dead_caller = new RexecCaller({ hub_url: `http://127.0.0.1:${dead_port}`, token: DEBUG_TOKEN })
        const dead_started = Date.now()
        const dead_conn = dead_caller.connect_pty({ session_id: "0123456789abcdef" })
        let dead_ready_failed = false
        try {
            await dead_conn.ready
        } catch {
            dead_ready_failed = true
        }
        let dead_exit_failed = false
        try {
            await dead_conn.exited
        } catch {
            dead_exit_failed = true
        }
        if (
            !dead_ready_failed ||
            !dead_exit_failed ||
            dead_conn.status !== "error" ||
            Date.now() - dead_started > 2000
        ) {
            throw new Error(
                `Expected connect_pty initial network error to fail fast, got ready=${dead_ready_failed} exit=${dead_exit_failed} status=${dead_conn.status} elapsed=${Date.now() - dead_started}ms`
            )
        }
        console.log("✓ connect_pty initial failure did not retry")

        console.log("[test:tty] Checking connect_pty resume(), offline resize, and incremental replay...")
        const hub_port = Number(new URL(config.hub_url).port || 80)
        const handles_before = new Set(get_active_handles())
        const res_conn = caller.connect_pty({
            file: "sh",
            args: ["-c", "echo CONN_BEFORE; sleep 0.8; stty size; echo CONN_AFTER; exit 4"],
            cols: 80,
            rows: 24,
            orphan_ttl_ms: 10000
        })
        let res_output = ""
        let res_resets = 0
        const res_statuses: string[] = []
        res_conn.on_status((event) => {
            res_statuses.push(event.status)
        })
        res_conn.on_reset(() => {
            res_resets += 1
        })
        res_conn.on_data((data) => {
            res_output += Buffer.from(data).toString("utf8")
        })
        await res_conn.ready
        const drop_deadline = Date.now() + 5000
        while (!res_output.includes("CONN_BEFORE") && Date.now() < drop_deadline) {
            await new Promise((resolve) => setTimeout(resolve, 30))
        }
        if (!res_output.includes("CONN_BEFORE")) {
            throw new Error(`Timed out waiting for CONN_BEFORE: ${JSON.stringify(res_output)}`)
        }
        for (const h of get_active_handles()) {
            if (!handles_before.has(h) && h.remotePort === hub_port && !h.destroyed && h.destroy) {
                h.destroy()
            }
        }
        const reconnecting_deadline = Date.now() + 5000
        while (!res_statuses.includes("connecting") && Date.now() < reconnecting_deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        if (!res_statuses.includes("connecting")) {
            throw new Error(
                `Expected connect_pty to enter 'connecting' after drop, got: ${JSON.stringify(res_statuses)}`
            )
        }
        res_conn.resize(110, 35)
        res_conn.resume()
        const res_exit = await Promise.race([
            res_conn.exited,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("connect_pty timed out")), 10000))
        ])
        const conn_before_count = res_output.split("CONN_BEFORE").length - 1
        if (
            res_exit.code !== 4 ||
            conn_before_count !== 1 ||
            res_resets !== 0 ||
            !res_output.includes("CONN_AFTER") ||
            !res_output.includes("35 110")
        ) {
            throw new Error(
                `Unexpected connect_pty reconnect result: code=${res_exit.code} before_count=${conn_before_count} resets=${res_resets} statuses=${JSON.stringify(res_statuses)} out=${JSON.stringify(res_output)}`
            )
        }
        console.log("✓ connect_pty resume(), offline resize, and incremental replay passed")

        console.log("[test:tty] Checking multi-PTY WS sharing and cross-caller takeover isolation...")
        const shared_handles_before = new Set(get_active_handles())
        const unrelated_conn = caller.connect_pty({
            file: "sh",
            args: ["-c", "echo UNRELATED_READY; read line; echo UNRELATED_ECHO:$line; sleep 5"],
            orphan_ttl_ms: 5000
        })
        let unrelated_out = ""
        unrelated_conn.on_data((data) => {
            unrelated_out += Buffer.from(data).toString("utf8")
        })
        await unrelated_conn.ready

        const take_conn = caller.connect_pty({
            file: "sh",
            args: ["-c", "echo TAKEOVER_READY; sleep 30"],
            orphan_ttl_ms: 5000
        })
        let take_ready = false
        take_conn.on_data((data) => {
            if (Buffer.from(data).toString("utf8").includes("TAKEOVER_READY")) {
                take_ready = true
            }
        })
        const take_id = await take_conn.ready
        const shared_sockets = get_active_handles().filter(
            (h) => !shared_handles_before.has(h) && h.remotePort === hub_port && !h.destroyed
        )
        if (shared_sockets.length !== 1) {
            throw new Error(`Expected 1 shared PTY WebSocket for 2 sessions, found ${shared_sockets.length}`)
        }
        const take_deadline = Date.now() + 5000
        while ((!take_ready || !unrelated_out.includes("UNRELATED_READY")) && Date.now() < take_deadline) {
            await new Promise((resolve) => setTimeout(resolve, 30))
        }
        const caller_2 = new RexecCaller({ hub_url: config.hub_url, token: DEBUG_TOKEN })
        const taker = await caller_2.open_pty({ session_id: take_id })
        let take_err = ""
        try {
            await Promise.race([
                take_conn.exited,
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error("takeover timed out")), 5000))
            ])
        } catch (err) {
            take_err = (err as Error).message
        } finally {
            taker.close()
        }
        if (take_err !== "Session is open in another client" || take_conn.status !== "error") {
            unrelated_conn.close()
            throw new Error(`Expected takeover error, got err=${JSON.stringify(take_err)} status=${take_conn.status}`)
        }
        unrelated_conn.send(new TextEncoder().encode("still_alive\n"))
        const echo_deadline = Date.now() + 5000
        while (!unrelated_out.includes("UNRELATED_ECHO:still_alive") && Date.now() < echo_deadline) {
            await new Promise((resolve) => setTimeout(resolve, 30))
        }
        unrelated_conn.close()
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (!unrelated_out.includes("UNRELATED_ECHO:still_alive") || unrelated_conn.status !== "closed") {
            throw new Error(
                `Expected unrelated PTY session on same WS to stay alive, out=${JSON.stringify(unrelated_out)}`
            )
        }
        console.log("✓ multi-PTY WS sharing & cross-caller takeover isolation passed")

        console.log("[test:tty] Checking connect_pty fires on_reset and marks replay_bytes when ring buffer wraps...")
        const ovf_handles_before = new Set(get_active_handles())
        const ovf_conn = caller.connect_pty({
            file: "sh",
            args: [
                "-c",
                "echo OVERFLOW_START; sleep 0.25; dd if=/dev/zero bs=1024 count=600 2>/dev/null | tr '\\0' 'A'; echo ''; echo OVERFLOW_END; sleep 1.2; exit 6"
            ],
            cols: 80,
            rows: 24,
            orphan_ttl_ms: 10000
        })
        let ovf_started = false
        let ovf_resets = 0
        let ovf_replay_bytes = 0
        let ovf_tail = ""
        ovf_conn.on_reset(() => {
            ovf_resets += 1
        })
        ovf_conn.on_data((data, replay_bytes) => {
            ovf_replay_bytes += replay_bytes
            const text = Buffer.from(data).toString("utf8")
            if (text.includes("OVERFLOW_START")) ovf_started = true
            ovf_tail = (ovf_tail + text).slice(-4096)
        })
        await ovf_conn.ready
        const ovf_deadline = Date.now() + 5000
        while (!ovf_started && Date.now() < ovf_deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        if (!ovf_started) throw new Error("Timed out waiting for OVERFLOW_START")
        for (const h of get_active_handles()) {
            if (!ovf_handles_before.has(h) && h.remotePort === hub_port && !h.destroyed && h.destroy) {
                h.destroy()
            }
        }
        const ovf_exit = await Promise.race([
            ovf_conn.exited,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("overflow test timed out")), 15000))
        ])
        if (ovf_exit.code !== 6 || ovf_resets !== 1 || ovf_replay_bytes <= 0 || !ovf_tail.includes("OVERFLOW_END")) {
            throw new Error(
                `Expected overflow reset=1, replay_bytes>0, exit 6 with OVERFLOW_END, got code=${ovf_exit.code} resets=${ovf_resets} replay_bytes=${ovf_replay_bytes} tail=${JSON.stringify(ovf_tail)}`
            )
        }
        console.log("✓ connect_pty ring buffer overflow reset and replay_bytes passed")

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
