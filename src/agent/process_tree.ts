import { spawn } from "node:child_process"

const ESCALATE_MS = 1000

/**
 * Signal a command and the processes it started.
 * The shell spawned for exec ignores SIGINT while a foreground command runs, and a
 * signal sent only to that shell leaves the command behind after the shell exits.
 */
export function signal_process_tree(pid: number, signal: NodeJS.Signals): void {
    if (process.platform === "win32") {
        const args = ["/PID", String(pid), "/T"]
        if (signal === "SIGKILL" || signal === "SIGTERM") args.push("/F")
        spawn("taskkill", args, { stdio: "ignore", windowsHide: true }).on("error", () => {})
        return
    }

    try {
        process.kill(-pid, signal)
    } catch {
        try {
            process.kill(pid, signal)
        } catch {
            // The process has already exited.
        }
    }
}

export function signal_process_tree_until_dead(pid: number, signal: NodeJS.Signals, has_exited: () => boolean): void {
    signal_process_tree(pid, signal)
    const timer = setTimeout(() => {
        if (!has_exited()) signal_process_tree(pid, "SIGKILL")
    }, ESCALATE_MS)
    timer.unref?.()
}
