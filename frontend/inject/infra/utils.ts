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
