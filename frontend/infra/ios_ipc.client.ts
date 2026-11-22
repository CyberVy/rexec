import { create_logger } from "./logger"

const logger = create_logger("IosIPC")

const IOS_IPC_HANDLER_NAME = "iosIpcBridge"
const IOS_IPC_RUNTIME_KEY = "__REXEC_IOS_IPC__"
const IOS_IPC_CAPS_KEY = "__REXEC_IOS_IPC_CAPS__"

export type IosIPCErrorCode =
    | "UNAVAILABLE"
    | "UNSUPPORTED_TYPE"
    | "INVALID_PAYLOAD"
    | "FORBIDDEN"
    | "TIMEOUT"
    | "DISPOSED"
    | "NATIVE_ERROR"
    | (string & {})

export class IosIPCError extends Error {
    public readonly code: IosIPCErrorCode
    public readonly details?: unknown

    constructor(code: IosIPCErrorCode, message: string, details?: unknown) {
        super(message)
        this.name = "IosIPCError"
        this.code = code
        this.details = details
    }
}

export interface IosIPCRequestParams<Payload = Record<string, unknown>> {
    type: string
    payload?: Payload
    delay?: number
}

export type IosIPCHandler<Payload = Record<string, unknown>, Result = unknown> = (
    payload: Payload
) => Result | Promise<Result>

export interface IosIPCHandleParams<Payload = Record<string, unknown>, Result = unknown> {
    type: string
    handler: IosIPCHandler<Payload, Result>
}

interface IosIPCDispatchEnvelope {
    type: string
    payload?: Record<string, unknown>
}

interface IosIPCBridgeErrorPayload {
    code?: string
    message?: string
    details?: unknown
}

interface IosIPCBridgeResponse {
    ok: boolean
    data?: unknown
    error?: IosIPCBridgeErrorPayload
}

interface IosIPCRuntime {
    capabilities: Set<string>
    handlers: Map<string, Set<IosIPCHandler<any, any>>>
    sync_capabilities: () => void
    dispatch: (envelope: IosIPCDispatchEnvelope) => void
    invoke: (type: string, payload?: Record<string, unknown>) => Promise<unknown>
}

type IosIPCWindow = Window & {
    [IOS_IPC_RUNTIME_KEY]?: IosIPCRuntime
    [IOS_IPC_CAPS_KEY]?: unknown
}

function read_injected_capabilities(host: IosIPCWindow): string[] {
    const raw_caps = host[IOS_IPC_CAPS_KEY]
    if (!Array.isArray(raw_caps)) return []
    return raw_caps.filter((item): item is string => typeof item === "string")
}

function is_record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function get_existing_runtime(): IosIPCRuntime | null {
    if (typeof window === "undefined") return null
    return (window as IosIPCWindow)[IOS_IPC_RUNTIME_KEY] ?? null
}

function get_or_create_runtime(): IosIPCRuntime | null {
    if (typeof window === "undefined") return null
    const host = window as IosIPCWindow
    const existing = host[IOS_IPC_RUNTIME_KEY]
    if (existing) {
        return existing
    }

    const capabilities = new Set<string>(read_injected_capabilities(host))
    const handlers = new Map<string, Set<IosIPCHandler<any, any>>>()

    const sync_capabilities = () => {
        capabilities.clear()
        for (const cap of read_injected_capabilities(host)) {
            capabilities.add(cap)
        }
    }

    const dispatch = (envelope: IosIPCDispatchEnvelope) => {
        if (!envelope || typeof envelope.type !== "string") return
        const set = handlers.get(envelope.type)
        if (!set || set.size === 0) return

        const payload = is_record(envelope.payload) ? envelope.payload : {}
        const snapshot = Array.from(set)
        for (const handler of snapshot) {
            try {
                const result = handler(payload)
                if (result && typeof (result as Promise<unknown>).catch === "function") {
                    ;(result as Promise<unknown>).catch((err) => {
                        logger.error("Error in async iOS IPC handler", { type: envelope.type, error: err })
                    })
                }
            } catch (err) {
                logger.error("Error executing iOS IPC handler", { type: envelope.type, error: err })
            }
        }
    }

    const invoke = async (type: string, payload?: Record<string, unknown>): Promise<unknown> => {
        const set = handlers.get(type)
        if (!set || set.size === 0) {
            throw new IosIPCError("UNSUPPORTED_TYPE", `No JS handler registered for iOS IPC type: ${type}`)
        }

        const safe_payload = is_record(payload) ? payload : {}
        let resolved_result: unknown = undefined
        let has_result = false

        const snapshot = Array.from(set)
        for (const handler of snapshot) {
            const value = await handler(safe_payload)
            if (!has_result && value !== undefined) {
                resolved_result = value
                has_result = true
            }
        }

        return resolved_result
    }

    const runtime: IosIPCRuntime = {
        capabilities,
        handlers,
        sync_capabilities,
        dispatch,
        invoke
    }

    host[IOS_IPC_RUNTIME_KEY] = runtime
    return runtime
}

export function init_ios_ipc_runtime(): void {
    get_or_create_runtime()?.sync_capabilities()
}

export function is_ios_ipc_available(): boolean {
    if (typeof window === "undefined") return false
    return typeof window.webkit?.messageHandlers?.[IOS_IPC_HANDLER_NAME]?.postMessage === "function"
}

export function has_ios_capability(capability: string): boolean {
    if (!is_ios_ipc_available()) return false
    const runtime = get_existing_runtime()
    if (runtime) {
        return runtime.capabilities.has(capability)
    }
    if (typeof window === "undefined") return false
    return read_injected_capabilities(window as IosIPCWindow).includes(capability)
}

export function get_ios_capabilities(): ReadonlySet<string> {
    if (!is_ios_ipc_available()) return new Set()
    const runtime = get_existing_runtime()
    if (runtime) {
        return new Set(runtime.capabilities)
    }
    if (typeof window === "undefined") return new Set()
    return new Set(read_injected_capabilities(window as IosIPCWindow))
}

export async function ios_ipc_call<Result = unknown, Payload = Record<string, unknown>>({
    type,
    payload = {} as Payload,
    delay
}: IosIPCRequestParams<Payload>): Promise<Result> {
    const handler = typeof window !== "undefined" ? window.webkit?.messageHandlers?.[IOS_IPC_HANDLER_NAME] : undefined
    if (!handler || typeof handler.postMessage !== "function") {
        throw new IosIPCError("UNAVAILABLE", `iOS IPC bridge is not available for type: ${type}`)
    }

    const request_promise = Promise.resolve(handler.postMessage({ type, payload })).then(
        (raw_response: unknown) => {
            if (is_record(raw_response) && typeof raw_response.ok === "boolean") {
                const envelope = raw_response as unknown as IosIPCBridgeResponse
                if (envelope.ok) {
                    return envelope.data as Result
                }
                const err = envelope.error
                throw new IosIPCError(
                    err?.code || "NATIVE_ERROR",
                    err?.message || `iOS IPC request failed for type: ${type}`,
                    err?.details
                )
            }
            return raw_response as Result
        },
        (err: unknown) => {
            if (err instanceof IosIPCError) throw err
            throw new IosIPCError("NATIVE_ERROR", err instanceof Error ? err.message : String(err), err)
        }
    )

    if (delay === undefined || delay <= 0) {
        return request_promise
    }

    // Observe rejections so a winning timeout never triggers an unhandledrejection later.
    request_promise.catch(() => {})

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout_promise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            logger.warn("iOS IPC request timed out", { type, delay })
            reject(new IosIPCError("TIMEOUT", `iOS IPC request timeout for type: ${type}`))
        }, delay)
    })

    try {
        return await Promise.race([request_promise, timeout_promise])
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer)
        }
    }
}

export function handle_ios_ipc<Payload = Record<string, unknown>, Result = unknown>({
    type,
    handler
}: IosIPCHandleParams<Payload, Result>): () => void {
    const runtime = get_or_create_runtime()
    if (!runtime) {
        throw new IosIPCError("UNAVAILABLE", "No window target available for iOS IPC handler")
    }

    let set = runtime.handlers.get(type)
    if (!set) {
        set = new Set()
        runtime.handlers.set(type, set)
    }
    set.add(handler as IosIPCHandler<any, any>)

    return () => {
        const current_set = runtime.handlers.get(type)
        if (!current_set) return
        current_set.delete(handler as IosIPCHandler<any, any>)
        if (current_set.size === 0) {
            runtime.handlers.delete(type)
        }
    }
}
