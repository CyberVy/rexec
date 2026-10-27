export function get_cors_headers(request?: Request): Record<string, string> {
    const origin = request?.headers.get("Origin")
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept",
        "Access-Control-Max-Age": "86400"
    }
}

export function extract_token(request: Request, url: URL): string | null {
    const query_token = url.searchParams.get("token")
    const auth_header = request.headers.get("Authorization")
    let bearer_token: string | null = null
    if (auth_header) {
        bearer_token = auth_header.replace(/^Bearer\s+/i, "")
    }
    const token = query_token?.trim() || bearer_token?.trim()
    return token || null
}

export function read_ws_bytes(data: unknown, on_bytes: (bytes: Uint8Array) => void): void {
    if (data instanceof ArrayBuffer) {
        on_bytes(new Uint8Array(data))
        return
    }
    if (ArrayBuffer.isView(data)) {
        on_bytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        return
    }
    if (data && typeof (data as Blob).arrayBuffer === "function") {
        void (data as Blob).arrayBuffer().then((ab) => on_bytes(new Uint8Array(ab)))
    }
}
