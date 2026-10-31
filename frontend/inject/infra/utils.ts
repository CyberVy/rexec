import { web_ipc_call } from "@/infra/web_ipc.client"
import { create_logger } from "@/infra/logger"

const logger = create_logger("InjectUtils")

export function execute_after_dom_content_loaded(callback: () => void) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", callback, { once: true })
    } else {
        callback()
    }
}

export function append_style(css: string) {
    const callback = () => {
        const style = document.createElement("style")
        style.textContent = css
        document.head.appendChild(style)
    }
    execute_after_dom_content_loaded(callback)
}

export function safe_define_property(
    target: unknown,
    key: PropertyKey,
    descriptor: PropertyDescriptor & ThisType<unknown>
) {
    try {
        Object.defineProperty(target, key, descriptor)
        return true
    } catch (_error) {
        // Some runtimes expose non-configurable descriptors.
        return false
    }
}
export function notify_injection_success_of_window(_window: Window) {
    web_ipc_call({
        target: _window,
        type: "on_injection_success",
        payload: { origin: location.href }
    }).catch((err: any) => logger.warn("Failed to notify injection success", err))
}
