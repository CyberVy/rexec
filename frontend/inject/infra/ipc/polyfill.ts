import { is_touch_device } from "@/infra/device.client"
import { WebviewWindowProxy } from "@/infra/web_ipc.client"

declare global {
    interface Window {
        /**
         * Global IPC Message Event Dispatcher (Runs on all WebViews)
         * Called by:
         *  - iOS: ExternalOpenUIDelegate.swift (tauriPopupBridge -> evaluateJavaScript)
         *  - Desktop: src-tauri/src/commands/message.rs (post_message_to_webview -> eval)
         */
        __tauri_ipc_dispatch_message_event?: (message: any, senderLabel: string) => void
        /**
         * iOS Popup Invoke Executor Proxy (Runs on Main WebView)
         * Called by: ExternalOpenUIDelegate.swift (tauriPopupInvoke -> evaluateJavaScript)
         */
        __tauri_ios_main_proxy_popup_invoke?: (id: string, cmd: string, args: any) => void
        /**
         * iOS Popup Invoke Result Resolver (Runs on Popup WebView)
         * Called by: ExternalOpenUIDelegate.swift (tauriPopupInvokeReply -> evaluateJavaScript)
         */
        __tauri_ios_popup_resolve_pending_invoke?: (id: string, status: string, data: any) => void
        __TAURI_OPENER_LABEL__?: string
    }
}

export function setup_tauri_popup_polyfill() {
    const is_ios = window.webkit?.messageHandlers !== undefined && is_touch_device()
    const is_ios_popup = is_ios && window.webkit?.messageHandlers?.tauriPopupBridge !== undefined

    // Unconditionally register the receive helper on all platforms/webviews
    if (!window.__tauri_ipc_dispatch_message_event) {
        window.__tauri_ipc_dispatch_message_event = (message: any, senderLabel: string) => {
            const event = new MessageEvent("message", {
                data: message
            })
            Object.defineProperty(event, "source", {
                value: new WebviewWindowProxy(senderLabel),
                writable: false,
                enumerable: true,
                configurable: true
            })
            window.dispatchEvent(event)
        }
    }

    setup_opener_polyfill()

    if (is_ios) {
        register_ios_dispatch_helpers()
        if (is_ios_popup) {
            setup_ios_tauri_invoke_polyfill()
        }
    }
}

function register_ios_dispatch_helpers() {
    window.__tauri_ios_main_proxy_popup_invoke = (id: string, cmd: string, args: any) => {
        if (window.__TAURI__?.core?.invoke) {
            window.__TAURI__.core
                .invoke(cmd, args)
                .then((res: any) => {
                    const handler = window.webkit?.messageHandlers?.tauriPopupInvokeReply
                    if (handler) {
                        handler.postMessage({
                            id: id,
                            status: "success",
                            data: res
                        })
                    }
                })
                .catch((err: any) => {
                    const handler = window.webkit?.messageHandlers?.tauriPopupInvokeReply
                    if (handler) {
                        handler.postMessage({
                            id: id,
                            status: "error",
                            data: String(err)
                        })
                    }
                })
        } else {
            const handler = window.webkit?.messageHandlers?.tauriPopupInvokeReply
            if (handler) {
                handler.postMessage({
                    id: id,
                    status: "error",
                    data: "Tauri core invoke not available on main webview"
                })
            }
        }
    }
}

// polyfill window.opener for iOS WebView popup window
function setup_ios_tauri_invoke_polyfill() {
    // Force define/overwrite window.__TAURI__.core.invoke for direct Rust invokes
    const pending_invokes: Record<string, { resolve: (val: any) => void; reject: (err: any) => void }> = {}

    window.__tauri_ios_popup_resolve_pending_invoke = (id: string, status: string, data: any) => {
        const promise = pending_invokes[id]
        if (promise) {
            delete pending_invokes[id]
            if (status === "success") {
                promise.resolve(data)
            } else {
                promise.reject(data)
            }
        }
    }

    const custom_invoke = <T = any>(cmd: string, args?: any): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
            pending_invokes[id] = { resolve, reject }
            const handler = window.webkit?.messageHandlers?.tauriPopupInvoke
            if (handler) {
                handler.postMessage({
                    id: id,
                    cmd: cmd,
                    args: args || {}
                })
            } else {
                reject(new Error("tauriPopupInvoke handler not available"))
            }
        })
    }

    const current_tauri = window.__TAURI__
    if (current_tauri) {
        current_tauri.core = current_tauri.core || {}
        current_tauri.core.invoke = custom_invoke
    } else {
        window.__TAURI__ = {
            core: {
                invoke: custom_invoke
            }
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
