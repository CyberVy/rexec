import { create_logger } from "./logger"

const logger = create_logger("ServiceWorkerAPI")

export const SERVICE_WORKER_API_PATH = "/_sw/api"

export type ServiceWorkerApiRequestEnvelope = {
    type: string
    payload: unknown
}

export type ServiceWorkerApiResponseEnvelope =
    | { ok: true; data?: unknown }
    | { ok: false; error: { code: string; message: string } }

export type ServiceWorkerApiRequestParams = {
    type: string
    payload?: Record<string, unknown>
    delay?: number
}

function is_record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function service_worker_api_call<Result = unknown>({
    type,
    payload = {},
    delay = 30000
}: ServiceWorkerApiRequestParams): Promise<Result> {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) {
        throw new Error("The current page is not controlled by a service worker")
    }

    const request: ServiceWorkerApiRequestEnvelope = { type, payload }
    const abort_controller = new AbortController()
    const timeout_id = setTimeout(() => abort_controller.abort(), delay)
    let response: Response
    try {
        response = await fetch(SERVICE_WORKER_API_PATH, {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            signal: abort_controller.signal
        })
    } catch (error) {
        if (abort_controller.signal.aborted) {
            logger.warn("Service worker API request timed out", { type, delay })
            throw new Error(`Service worker API request timeout for type: ${type}`)
        }
        throw error
    } finally {
        clearTimeout(timeout_id)
    }

    let envelope: unknown
    try {
        envelope = await response.json()
    } catch (error) {
        logger.error("Service worker returned an invalid API response", { type, status: response.status, error })
        throw new Error("Invalid service worker API response")
    }

    if (!is_record(envelope) || typeof envelope.ok !== "boolean") {
        logger.error("Service worker returned an invalid API response", { type, status: response.status })
        throw new Error("Invalid service worker API response")
    }

    if (!response.ok || !envelope.ok) {
        const error = envelope.error
        const message =
            is_record(error) && typeof error.message === "string"
                ? error.message
                : `Service worker API failed with status ${response.status}`
        logger.error("Service worker API request failed", { type, status: response.status, message })
        throw new Error(message)
    }

    return envelope.data as Result
}
