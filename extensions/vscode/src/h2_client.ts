import * as http2 from "node:http2"
import type * as vscode from "vscode"
import type { HubStatus } from "@/caller"

export class H2StatusClient implements vscode.Disposable {
    private session: http2.ClientHttp2Session | null = null
    private current_origin = ""

    public async get_status(hub_url: string, token: string, signal?: AbortSignal): Promise<HubStatus> {
        const url = new URL(hub_url)
        if (url.protocol !== "https:") {
            return this.fetch_http_status(hub_url, token, signal)
        }

        const session = this.get_session(url.origin)
        return this.query_h2_status(session, url, token, signal)
    }

    private get_session(origin: string): http2.ClientHttp2Session {
        if (this.session && this.current_origin === origin && !this.session.closed && !this.session.destroyed) {
            return this.session
        }

        this.close_session()

        this.current_origin = origin
        const session = http2.connect(origin)
        session.on("error", () => {
            // Errors will trigger reconnect on next get_status call
        })
        session.on("close", () => {
            if (this.session === session) {
                this.session = null
            }
        })

        this.session = session
        return session
    }

    private async query_h2_status(
        session: http2.ClientHttp2Session,
        _url: URL,
        token: string,
        signal?: AbortSignal
    ): Promise<HubStatus> {
        return new Promise<HubStatus>((resolve, reject) => {
            if (signal?.aborted) {
                return reject(new Error("Request aborted"))
            }

            const path = `/health${token ? `?token=${encodeURIComponent(token)}` : ""}`
            const req = session.request({
                [http2.constants.HTTP2_HEADER_PATH]: path,
                [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_GET,
                ...(token ? { authorization: `Bearer ${token}` } : {})
            })

            let is_resolved = false
            const on_abort = () => {
                if (!is_resolved) {
                    is_resolved = true
                    signal?.removeEventListener("abort", on_abort)
                    req.close(http2.constants.NGHTTP2_CANCEL)
                    reject(new Error("Request aborted"))
                }
            }
            signal?.addEventListener("abort", on_abort)

            let status_code = 0
            req.on("response", (headers) => {
                status_code = Number(headers[http2.constants.HTTP2_HEADER_STATUS]) || 0
            })

            let body = ""
            req.setEncoding("utf-8")
            req.on("data", (chunk) => {
                body += chunk
            })

            req.on("end", () => {
                if (is_resolved) return
                is_resolved = true
                signal?.removeEventListener("abort", on_abort)

                if (status_code !== 200) {
                    return reject(new Error(`HTTP ${status_code}`))
                }

                try {
                    const parsed = JSON.parse(body) as HubStatus
                    resolve(parsed)
                } catch (err) {
                    reject(err)
                }
            })

            req.on("error", (err) => {
                if (is_resolved) return
                is_resolved = true
                signal?.removeEventListener("abort", on_abort)
                reject(err)
            })

            req.end()
        })
    }

    private async fetch_http_status(hub_url: string, token: string, signal?: AbortSignal): Promise<HubStatus> {
        const url = new URL(hub_url)
        url.pathname = "/health"
        if (token) {
            url.searchParams.set("token", token)
        }

        const res = await fetch(url.toString(), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal
        })
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`)
        }
        return (await res.json()) as HubStatus
    }

    public close_session(): void {
        if (this.session) {
            try {
                this.session.close()
            } catch {
                // Ignore close error
            }
            this.session = null
        }
    }

    public dispose(): void {
        this.close_session()
    }
}
