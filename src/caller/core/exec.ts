import type { ExecRequestPayload } from "@/protocol"
import type { ExecOptions } from "./types"

export async function exec_command(
    hub_url: string,
    token: string,
    options: ExecOptions,
    on_chunk?: (stream: "stdout" | "stderr", data: string) => void
): Promise<number> {
    const url = new URL(hub_url)
    url.pathname = "/exec"

    const payload: ExecRequestPayload = {
        cmd: options.cmd,
        cwd: options.cwd,
        env: options.env,
        timeout_ms: options.timeout_ms ?? 300000
    }

    const res = await fetch(url.toString(), {
        method: "POST",
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
                if (current_event === "chunk") {
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
