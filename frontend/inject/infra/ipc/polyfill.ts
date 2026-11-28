import {
    handle_ios_ipc,
    has_ios_capability,
    init_ios_ipc_runtime,
    ios_ipc_call,
    is_ios_ipc_available
} from "@/infra/ios_ipc"
import { WebviewWindowProxy } from "@/infra/web_ipc"

declare global {
    interface Window {
        /**
         * Global IPC Message Event Dispatcher (Used by desktop Rust backend)
         * Called by:
         *  - Desktop: src-tauri/src/commands/message.rs (post_message_to_webview -> eval)
         */
        __tauri_ipc_dispatch_message_event?: (message: any, senderLabel: string) => void
        __tauri_popup_polyfill_initialized?: boolean
        __TAURI_OPENER_LABEL__?: string
    }
}

function dispatch_message_event(message: unknown, sender_label: string) {
    const event = new MessageEvent("message", {
        data: message
    })
    Object.defineProperty(event, "source", {
        value: new WebviewWindowProxy(sender_label),
        writable: false,
        enumerable: true,
        configurable: true
    })
    window.dispatchEvent(event)
}

export function setup_tauri_popup_polyfill() {
    if (window.__tauri_popup_polyfill_initialized) return
    window.__tauri_popup_polyfill_initialized = true

    init_ios_ipc_runtime()

    // Unconditionally register the receive helper for desktop Rust eval routing
    if (!window.__tauri_ipc_dispatch_message_event) {
        window.__tauri_ipc_dispatch_message_event = (message: any, senderLabel: string) => {
            dispatch_message_event(message, senderLabel)
        }
    }

    setup_opener_polyfill()

    if (!is_ios_ipc_available()) return

    if (has_ios_capability("webview_router")) {
        handle_ios_ipc({
            type: "webview_router.message",
            handler: (payload) => {
                const sender_label = typeof payload.sender_label === "string" ? payload.sender_label : "unknown"
                dispatch_message_event(payload.message, sender_label)
            }
        })
    }

    if (has_ios_capability("tauri_proxy")) {
        setup_ios_tauri_invoke_polyfill()
    } else if (window === window.top) {
        register_ios_main_tauri_proxy_handler()
    }
}

function register_ios_main_tauri_proxy_handler() {
    handle_ios_ipc({
        type: "tauri_proxy.execute",
        handler: async (payload) => {
            const cmd = typeof payload.cmd === "string" ? payload.cmd : ""
            if (!cmd) {
                throw new Error("Missing Tauri command name")
            }

            const invoke = window.__TAURI__?.core?.invoke
            if (!invoke) {
                throw new Error("Tauri core invoke not available on main webview")
            }

            try {
                return await invoke(cmd, payload.args ?? {})
            } catch (err) {
                if (err instanceof Error) throw err
                throw new Error(String(err))
            }
        }
    })
}

function setup_ios_tauri_invoke_polyfill() {
    const custom_invoke = <T = any>(cmd: string, args?: any): Promise<T> => {
        return ios_ipc_call<T>({
            type: "tauri_proxy.invoke",
            payload: {
                cmd,
                args: args ?? {}
            }
        })
    }

    const current_tauri = window.__TAURI__
    window.__TAURI__ = {
        ...current_tauri,
        core: {
            ...current_tauri?.core,
            invoke: custom_invoke
        }
    }
}

function setup_opener_polyfill() {
    if (!window.opener) {
        const opener_label = window.__TAURI_OPENER_LABEL__ || "main"
        window.opener = new WebviewWindowProxy(opener_label) as unknown as Window
    }
}

// polyfill window.open to support opening windows in child webview
function setup_window_open_polyfill() {
    const originalOpen = window.open
    window.open = function (url?: string | URL, target?: string, features?: string) {
        return originalOpen.call(window, url, target, features)
    }
}
