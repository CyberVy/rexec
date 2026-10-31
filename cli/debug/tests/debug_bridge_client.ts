import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.resolve(TEST_DIRECTORY, "../../../.debug/frontend/config.json")
const DEBUG_HOST = "127.0.0.1"

interface DebugResponse {
    success: boolean
    result?: unknown
    error?: string
}

export function read_debug_port(): number {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error("Debug bridge configuration not found. Start the development server first.")
    }

    let config: { port?: unknown }
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
    } catch (error) {
        throw new Error(`Failed to parse debug bridge configuration: ${String(error)}`)
    }

    const port = Number(config.port)
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid debug bridge port: ${String(config.port)}`)
    }
    return port
}

export function evaluate_in_browser<T>(port: number, code: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const post_data = JSON.stringify({ code })
        const request = http.request(
            {
                hostname: DEBUG_HOST,
                port,
                path: "/__debug/eval",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(post_data)
                }
            },
            (response) => {
                let response_body = ""
                response.setEncoding("utf8")
                response.on("data", (chunk: string) => {
                    response_body += chunk
                })
                response.on("end", () => {
                    let payload: DebugResponse
                    try {
                        payload = JSON.parse(response_body) as DebugResponse
                    } catch {
                        reject(new Error(`Invalid debug bridge response: ${response_body}`))
                        return
                    }

                    if (response.statusCode !== 200 || !payload.success) {
                        reject(new Error(payload.error || `Debug bridge returned HTTP ${response.statusCode}`))
                        return
                    }
                    resolve(payload.result as T)
                })
            }
        )

        request.setTimeout(30000, () => {
            request.destroy(new Error("Timed out waiting for the debug bridge"))
        })
        request.on("error", reject)
        request.write(post_data)
        request.end()
    })
}

export function parse_numeric_option(args: string[], name: string, default_value: number): number {
    const prefix = `${name}=`
    const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
    if (value === undefined) return default_value

    const parsed_value = Number(value)
    if (!Number.isFinite(parsed_value) || parsed_value < 0) {
        throw new Error(`Invalid ${name} value: ${value}`)
    }
    return parsed_value
}
