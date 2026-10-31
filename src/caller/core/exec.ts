import { HUB_ROUTES, type ExecKillRequestPayload, type ExecRequestPayload } from "@/protocol"
import type { ExecOptions } from "./types"

export async function exec_command(
    hub_url: string,
    token: string,
    options: ExecOptions,
    on_chunk?: (stream: "stdout" | "stderr", data: string) => void
): Promise<number> {
    const url = new URL(hub_url)
    url.pathname = HUB_ROUTES.EXEC.path

    const payload: ExecRequestPayload = {
        cmd: options.cmd,
        cwd: options.cwd,
        env: options.env,
        timeout_ms: options.timeout_ms ?? 300000
    }

    const res = await fetch(url.toString(), {
        method: HUB_ROUTES.EXEC.method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: options.signal
    })

    if (!res.ok) {
        const err_msg = await res.text()
        throw new Error(`Server returned error ${res.status}: ${err_msg}`)
    }

    if (!res.body) {
        throw new Error("No response body received from server")
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let current_event = "chunk"
    let exit_code: number | null = null
    let task_id: string | null = null

    const kill_remote = (): void => {
        if (!task_id) return
        const kill_url = new URL(hub_url)
        kill_url.pathname = HUB_ROUTES.EXEC_KILL.path
        const payload: ExecKillRequestPayload = { task_id }
        const payload_json = JSON.stringify(payload)
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
            const beacon_url = new URL(kill_url)
            beacon_url.searchParams.set("token", token)
            navigator.sendBeacon(beacon_url, new Blob([payload_json], { type: "text/plain;charset=UTF-8" }))
        }
        void fetch(kill_url.toString(), {
            method: HUB_ROUTES.EXEC_KILL.method,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: payload_json,
            keepalive: true
        }).catch(() => {})
    }
    options.signal?.addEventListener("abort", kill_remote, { once: true })

    const process_line = (raw_line: string): boolean => {
        let line = raw_line
        if (line.endsWith("\r")) {
            line = line.slice(0, -1)
        }
        if (line.startsWith("event: ")) {
            current_event = line.slice(7).trim()
        } else if (line.startsWith("data: ")) {
            const data_raw = line.slice(6)
            try {
                const parsed = JSON.parse(data_raw)
                if (current_event === "start" && typeof parsed.task_id === "string") {
                    task_id = parsed.task_id
                    if (options.signal?.aborted) kill_remote()
                } else if (current_event === "chunk") {
                    on_chunk?.(parsed.stream, parsed.data)
                } else if (current_event === "exit") {
                    exit_code = parsed.code ?? 0
                    return true
                } else if (current_event === "error") {
                    throw new Error(parsed.message)
                }
            } catch (err) {
                if (current_event === "chunk") {
                    on_chunk?.("stdout", data_raw)
                } else if (current_event === "error") {
                    throw err
                }
            }
            current_event = "chunk"
        }
        return false
    }

    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            buffer += decoder.decode()
            if (buffer.length > 0) {
                for (const line of buffer.split("\n")) {
                    process_line(line)
                }
            }
            break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let should_exit = false
        for (const line of lines) {
            if (process_line(line)) {
                should_exit = true
                break
            }
        }
        if (should_exit) {
            await reader.cancel().catch(() => {})
            break
        }
    }

    return exit_code ?? 0
}
