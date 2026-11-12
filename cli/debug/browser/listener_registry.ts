const TRACKED_EVENT_TYPES = new Set([
    "click",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "touchstart",
    "touchmove",
    "touchend",
    "contextmenu",
    "wheel",
    "keydown",
    "keyup"
])

const INLINE_HANDLER_EVENTS = [
    ["onclick", "click"],
    ["onpointerdown", "pointerdown"],
    ["onmousedown", "mousedown"],
    ["ontouchstart", "touchstart"],
    ["oncontextmenu", "contextmenu"]
] as const

const element_listener_counts = new WeakMap<Element, Map<string, number>>()
let is_listener_hook_installed = false

export function install_listener_registry(): void {
    if (is_listener_hook_installed || typeof EventTarget === "undefined") return
    is_listener_hook_installed = true

    const original_add = EventTarget.prototype.addEventListener
    const original_remove = EventTarget.prototype.removeEventListener

    EventTarget.prototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions
    ) {
        if (this instanceof Element && listener && TRACKED_EVENT_TYPES.has(type)) {
            let counts = element_listener_counts.get(this)
            if (!counts) {
                counts = new Map<string, number>()
                element_listener_counts.set(this, counts)
            }
            counts.set(type, (counts.get(type) ?? 0) + 1)
        }
        return original_add.call(this, type, listener, options)
    }

    EventTarget.prototype.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions
    ) {
        if (this instanceof Element && listener && TRACKED_EVENT_TYPES.has(type)) {
            const counts = element_listener_counts.get(this)
            if (counts) {
                const next = (counts.get(type) ?? 0) - 1
                if (next <= 0) {
                    counts.delete(type)
                } else {
                    counts.set(type, next)
                }
            }
        }
        return original_remove.call(this, type, listener, options)
    }
}

export function get_direct_listeners(element: Element): string[] {
    const detected = new Set<string>()
    const counts = element_listener_counts.get(element)
    if (counts) {
        for (const [event_name, count] of counts.entries()) {
            if (count > 0) {
                detected.add(event_name)
            }
        }
    }

    const record = element as unknown as Record<string, unknown>
    for (const [prop_name, event_name] of INLINE_HANDLER_EVENTS) {
        if (typeof record[prop_name] === "function" || element.hasAttribute(prop_name)) {
            detected.add(event_name)
        }
    }

    return Array.from(detected)
}
