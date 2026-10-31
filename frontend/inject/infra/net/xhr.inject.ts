import type { XhrSendBody, XhrInterceptRequest, XhrInterceptResponse } from "@/inject/infra/net/types"

function define_intercepted_xhr_property(xhr: XMLHttpRequest, key: PropertyKey, value: unknown) {
    Object.defineProperty(xhr, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
    })
}

function normalize_header_name(header_name: string) {
    return header_name.toLowerCase()
}

function extract_xhr_headers(xhr: XMLHttpRequest) {
    const raw_headers = xhr.getAllResponseHeaders()
    if (!raw_headers) return undefined

    const headers: Record<string, string> = {}
    for (const line of raw_headers.split(/\r?\n/)) {
        if (!line.trim()) continue

        const separator_index = line.indexOf(":")
        if (separator_index === -1) continue

        const header_name = normalize_header_name(line.slice(0, separator_index).trim())
        const header_value = line.slice(separator_index + 1).trim()
        headers[header_name] = header_value
    }

    return Object.keys(headers).length > 0 ? headers : undefined
}

function extract_xhr_intercept_response(xhr: XMLHttpRequest): XhrInterceptResponse {
    return {
        status: xhr.status,
        response: xhr.response,
        response_text: xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText : undefined,
        headers: extract_xhr_headers(xhr)
    }
}

function dispatch_intercepted_xhr_events(xhr: XMLHttpRequest) {
    const fire_ready_state_change = (ready_state: number) => {
        define_intercepted_xhr_property(xhr, "readyState", ready_state)
        xhr.dispatchEvent(new Event("readystatechange"))
    }

    fire_ready_state_change(XMLHttpRequest.HEADERS_RECEIVED)
    fire_ready_state_change(XMLHttpRequest.LOADING)
    fire_ready_state_change(XMLHttpRequest.DONE)
    xhr.dispatchEvent(new ProgressEvent("load"))
    xhr.dispatchEvent(new ProgressEvent("loadend"))
}

function apply_intercepted_response(
    xhr: XMLHttpRequest,
    request: XhrInterceptRequest,
    intercepted_response: XhrInterceptResponse
) {
    const status = intercepted_response.status ?? 200
    const response_text =
        intercepted_response.response_text ??
        (typeof intercepted_response.response === "string" ? intercepted_response.response : undefined)
    const headers = Object.fromEntries(
        Object.entries(intercepted_response.headers ?? {}).map(([key, value]) => [normalize_header_name(key), value])
    )

    define_intercepted_xhr_property(xhr, "status", status)
    define_intercepted_xhr_property(xhr, "statusText", status === 200 ? "OK" : "")
    define_intercepted_xhr_property(xhr, "responseURL", request.url)
    define_intercepted_xhr_property(xhr, "response", intercepted_response.response)

    if (xhr.responseType === "" || xhr.responseType === "text") {
        define_intercepted_xhr_property(xhr, "responseText", response_text ?? "")
    }

    define_intercepted_xhr_property(xhr, "getAllResponseHeaders", () =>
        Object.entries(headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\r\n")
    )
    define_intercepted_xhr_property(
        xhr,
        "getResponseHeader",
        (header_name: string) => headers[normalize_header_name(header_name)] ?? null
    )
}

export function install_xhr_interceptor(
    bypass_callback?: (request: XhrInterceptRequest, response: XhrInterceptResponse) => void,
    intercept_callback?: (
        request: XhrInterceptRequest
    ) => XhrInterceptResponse | Promise<XhrInterceptResponse | void> | void
): () => void {
    const original_open = XMLHttpRequest.prototype.open
    const original_send = XMLHttpRequest.prototype.send

    type InterceptedXhrMetadata = {
        method: string
        url: string
        body: XhrSendBody
        async: boolean
    }
    const intercepted_xhr_metadata_map = new WeakMap<XMLHttpRequest, InterceptedXhrMetadata>()

    XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
    ) {
        intercepted_xhr_metadata_map.set(this, {
            method: method.toUpperCase(),
            url: String(url),
            body: null,
            async: async ?? true
        })
        return original_open.call(this, method, url, async ?? true, username, password)
    }

    XMLHttpRequest.prototype.send = async function (body?: XhrSendBody) {
        const metadata = intercepted_xhr_metadata_map.get(this)
        if (metadata) metadata.body = body

        if (metadata) {
            const request: XhrInterceptRequest = {
                method: metadata.method,
                url: metadata.url,
                body: metadata.body
            }

            this.addEventListener(
                "loadend",
                () => {
                    bypass_callback?.(request, extract_xhr_intercept_response(this))
                },
                { once: true }
            )

            const intercepted_response = await intercept_callback?.(request)
            if (intercepted_response) {
                apply_intercepted_response(this, request, intercepted_response)

                const complete_intercepted_request = () => {
                    dispatch_intercepted_xhr_events(this)
                }

                if (metadata.async) {
                    queueMicrotask(complete_intercepted_request)
                } else {
                    complete_intercepted_request()
                }
                return
            }
        }

        return original_send.call(this, body)
    }

    return () => {
        XMLHttpRequest.prototype.open = original_open
        XMLHttpRequest.prototype.send = original_send
    }
}
