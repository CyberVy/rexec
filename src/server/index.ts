import type { Env } from "./types"
import { get_cors_headers, missing_token_response } from "./utils"

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

        const missing = missing_token_response(request)
        if (missing) {
            return missing
        }

        const id = env.REXEC_HUB.idFromName("default")
        const stub = env.REXEC_HUB.get(id)
        return stub.fetch(request)
    }
}
