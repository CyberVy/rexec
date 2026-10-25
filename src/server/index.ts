import type { Env } from "./types"
import { extract_token, get_cors_headers } from "./utils"

export { RexecHub } from "./hub"
export * from "./types"

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: get_cors_headers(request)
            })
        }

        const url = new URL(request.url)

        // Intercept unauthenticated agent registrations before reaching Durable Object
        if (url.pathname === "/ws" || url.pathname === "/ws/agent") {
            const token = extract_token(request, url)
            if (!token) {
                return new Response("Missing authorization token for agent registration", {
                    status: 401,
                    headers: get_cors_headers(request)
                })
            }
        }

        // Intercept unauthenticated exec or file transfer requests before reaching Durable Object
        if (
            url.pathname === "/exec" ||
            url.pathname === "/api/exec" ||
            url.pathname === "/file/pull" ||
            url.pathname === "/api/file/pull" ||
            url.pathname === "/file/push" ||
            url.pathname === "/api/file/push"
        ) {
            const token = extract_token(request, url)
            if (!token) {
                return new Response("Missing authorization token", {
                    status: 401,
                    headers: get_cors_headers(request)
                })
            }
        }

        const id = env.REXEC_HUB.idFromName("default")
        const stub = env.REXEC_HUB.get(id)
        return stub.fetch(request)
    }
}
