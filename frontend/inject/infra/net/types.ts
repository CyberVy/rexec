export type XhrSendBody = Parameters<XMLHttpRequest["send"]>[0]

export type XhrInterceptRequest = {
    method: string
    url: string
    body: XhrSendBody
}

export type XhrInterceptResponse = {
    response: XMLHttpRequest["response"]
    response_text?: string
    status?: number
    headers?: Record<string, string>
}

export type FetchInterceptRequest = {
    method: string
    url: string
    body?: BodyInit | null
}
