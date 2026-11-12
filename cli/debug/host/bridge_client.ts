import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HOST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.resolve(HOST_DIRECTORY, "../../../.debug/frontend/config.json")
const DEBUG_HOST = "127.0.0.1"

export interface DebugEvalResponse {
    success: boolean
    result?: unknown
    error?: string
}

export interface EvalHttpResult {
    status_code: number
    payload: DebugEvalResponse
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

/** Send raw evaluation request to `/__debug/eval` without unwrapping `payload.result`. */
export function request_eval_raw(port: number, code: string): Promise<EvalHttpResult> {
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
                    const status_code = response.statusCode ?? 0
                    try {
                        const payload = JSON.parse(response_body) as DebugEvalResponse
                        resolve({ status_code, payload })
                    } catch {
                        if (status_code !== 200) {
                            resolve({
                                status_code,
                                payload: {
                                    success: false,
                                    error: response_body || `Debug bridge returned HTTP ${status_code}`
                                }
                            })
                            return
                        }
                        reject(new Error(`Invalid debug bridge response: ${response_body}`))
                    }
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

export async function evaluate_in_browser<T>(port: number, code: string): Promise<T> {
    const { status_code, payload } = await request_eval_raw(port, code)
    if (status_code !== 200 || !payload.success) {
        const err_detail =
            payload.error ||
            (payload.result !== undefined ? String(payload.result) : undefined) ||
            `Debug bridge returned HTTP ${status_code}`
        throw new Error(err_detail)
    }
    return payload.result as T
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
