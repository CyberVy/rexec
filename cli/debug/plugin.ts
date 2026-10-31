import type { Plugin } from "vite"
import type http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEBUG_DIR = path.resolve(__dirname, "../../.debug/frontend")
const LOGS_FILE = path.join(DEBUG_DIR, "logs.jsonl")
const HISTORY_FILE = path.join(DEBUG_DIR, "history.jsonl")
const CONFIG_FILE = path.join(DEBUG_DIR, "config.json")
const SCRIPT_FILE = path.join(__dirname, "debug_bridge.js")

interface PendingEval {
    res: http.ServerResponse
    code: string
    timeout: NodeJS.Timeout
}

export function debug_bridge_plugin(): Plugin {
    const pending_evals = new Map<string, PendingEval>()
    let client_res: http.ServerResponse | null = null

    function log_eval_history(id: string, code: string, success: boolean, result: unknown) {
        try {
            const entry = JSON.stringify({
                timestamp: Date.now(),
                id,
                code,
                success,
                result
            })
            fs.appendFileSync(HISTORY_FILE, entry + "\n", "utf8")
        } catch (err) {
            try {
                const entry = JSON.stringify({
                    timestamp: Date.now(),
                    id,
                    code,
                    success,
                    result: String(err)
                })
                fs.appendFileSync(HISTORY_FILE, entry + "\n", "utf8")
            } catch {}
        }
    }

    return {
        name: "debug-bridge",
        apply: "serve",
        transformIndexHtml(_html, _ctx) {
            return [
                {
                    tag: "script",
                    attrs: { src: "/debug_bridge.js" },
                    injectTo: "head-prepend"
                }
            ]
        },
        configureServer(server) {
            if (!fs.existsSync(DEBUG_DIR)) {
                fs.mkdirSync(DEBUG_DIR, { recursive: true })
            }

            const write_config = () => {
                const address = server.httpServer?.address()
                const port = typeof address === "object" && address ? address.port : server.config.server.port || 3000
                fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port }, null, 2), "utf8")
            }

            if (server.httpServer?.listening) {
                write_config()
            } else {
                server.httpServer?.once("listening", write_config)
            }

            server.middlewares.use((req, res, next) => {
                const url = new URL(req.url || "", "http://localhost")
                const pathname = url.pathname

                // Fast bypass for non-debug requests
                if (!pathname.startsWith("/__debug/") && pathname !== "/debug_bridge.js") {
                    return next()
                }

                // 1. Serve client script
                if (pathname === "/debug_bridge.js") {
                    try {
                        const content = fs.readFileSync(SCRIPT_FILE, "utf8")
                        res.writeHead(200, {
                            "Content-Type": "application/javascript; charset=utf-8",
                            "Cache-Control": "no-cache"
                        })
                        res.end(content)
                    } catch {
                        res.writeHead(404)
                        res.end()
                    }
                    return
                }

                // 2. SSE events
                if (pathname === "/__debug/events") {
                    if (req.method !== "GET" && req.method !== "HEAD") return next()
                    res.writeHead(200, {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive"
                    })
                    res.write(":\n\n")
                    client_res = res
                    req.on("close", () => {
                        if (client_res === res) {
                            client_res = null
                        }
                    })
                    return
                }

                // 3. Client respond
                if (pathname === "/__debug/respond") {
                    if (req.method !== "POST") return next()
                    let body = ""
                    req.on("data", (chunk) => {
                        body += chunk
                    })
                    req.on("end", () => {
                        try {
                            const payload = JSON.parse(body)
                            const { id, success, result } = payload
                            const pending = pending_evals.get(id)

                            if (pending) {
                                clearTimeout(pending.timeout)
                                pending.res.writeHead(200, { "Content-Type": "application/json" })
                                pending.res.end(JSON.stringify({ success, result }))
                                pending_evals.delete(id)
                                log_eval_history(id, pending.code, success, result)
                            }

                            res.writeHead(200, { "Content-Type": "application/json" })
                            res.end(JSON.stringify({ status: "ok" }))
                        } catch (err) {
                            res.writeHead(500)
                            res.end(String(err))
                        }
                    })
                    return
                }

                // 4. Client console log
                if (pathname === "/__debug/log") {
                    if (req.method !== "POST") return next()
                    let body = ""
                    req.on("data", (chunk) => {
                        body += chunk
                    })
                    req.on("end", () => {
                        try {
                            fs.appendFileSync(LOGS_FILE, body + "\n", "utf8")
                            res.writeHead(200, { "Content-Type": "application/json" })
                            res.end(JSON.stringify({ status: "ok" }))
                        } catch (err) {
                            res.writeHead(500)
                            res.end(String(err))
                        }
                    })
                    return
                }

                // 5. Host eval request
                if (pathname === "/__debug/eval") {
                    const handle_eval = (code: string) => {
                        if (!code) {
                            res.writeHead(400, { "Content-Type": "application/json" })
                            res.end(JSON.stringify({ success: false, error: "No code provided" }))
                            return
                        }

                        if (!client_res) {
                            res.writeHead(503, { "Content-Type": "application/json" })
                            res.end(
                                JSON.stringify({
                                    success: false,
                                    error: "No active browser session connected to debug bridge"
                                })
                            )
                            return
                        }

                        const req_id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
                        const timeout = setTimeout(() => {
                            const pending = pending_evals.get(req_id)
                            if (pending) {
                                pending.res.writeHead(504, { "Content-Type": "application/json" })
                                pending.res.end(
                                    JSON.stringify({
                                        success: false,
                                        error: "Evaluation timed out waiting for browser response"
                                    })
                                )
                                pending_evals.delete(req_id)
                                log_eval_history(req_id, code, false, "Timeout")
                            }
                        }, 15000)

                        pending_evals.set(req_id, { res, code, timeout })
                        client_res.write(`data: ${JSON.stringify({ id: req_id, code })}\n\n`)
                    }

                    if (req.method === "GET") {
                        const code = url.searchParams.get("code") || ""
                        handle_eval(code)
                        return
                    }

                    if (req.method === "POST") {
                        let body = ""
                        req.on("data", (chunk) => {
                            body += chunk
                        })
                        req.on("end", () => {
                            try {
                                const payload = JSON.parse(body)
                                handle_eval(payload.code || "")
                            } catch {
                                res.writeHead(400, { "Content-Type": "application/json" })
                                res.end(JSON.stringify({ success: false, error: "Invalid JSON payload" }))
                            }
                        })
                        return
                    }
                }

                next()
            })

            server.httpServer?.on("close", () => {
                for (const [, pending] of pending_evals) {
                    clearTimeout(pending.timeout)
                    try {
                        pending.res.writeHead(503, { "Content-Type": "application/json" })
                        pending.res.end(JSON.stringify({ success: false, error: "Debug server closed" }))
                    } catch {}
                }
                pending_evals.clear()
                if (client_res) {
                    try {
                        client_res.end()
                    } catch {}
                    client_res = null
                }
            })
        }
    }
}
