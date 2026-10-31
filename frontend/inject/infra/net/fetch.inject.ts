import type { FetchInterceptRequest } from "./types"

export function install_fetch_interceptor(
    bypass_callback?: (request: FetchInterceptRequest, response: Response) => void
): () => void {
    const original_fetch = window.fetch

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const response = await original_fetch.apply(this, [input, init] as any)
        if (bypass_callback) {
            try {
                let method = init?.method
                let url = ""
                if (typeof input === "string") {
                    url = input
                } else if (input instanceof URL) {
                    url = input.href
                } else if (input && typeof input === "object" && "url" in input) {
                    url = (input as Request).url
                    if (!method) method = (input as Request).method
                }
                method = (method || "GET").toUpperCase()
                bypass_callback({ method, url, body: init?.body }, response.clone())
            } catch (e) {
                console.warn("[inject] fetch interceptor error:", e)
            }
        }
        return response
    }

    return () => {
        window.fetch = original_fetch
    }
}
