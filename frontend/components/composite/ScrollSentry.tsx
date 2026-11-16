"use client"

import type { RefObject } from "react"
import React, { useEffect, useLayoutEffect, useRef } from "react"

export type ScrollSentryProps = {
    on_trigger: () => void | PromiseLike<unknown>
    root_margin?: string | number
    /**
     * Custom scroll container element or ref; defaults to the browser viewport (`null`).
     * If the container mounts after `ScrollSentry`, pass the element via state so the observer re-attaches.
     */
    root?: HTMLElement | RefObject<HTMLElement | null> | null
}

function get_root_margin(root_margin: number | string) {
    if (typeof root_margin === "number") return `${root_margin}px`
    return root_margin
}

function is_ref_object<T>(value: unknown): value is RefObject<T> {
    return Boolean(value && typeof value === "object" && "current" in value)
}

function is_thenable(value: unknown): value is PromiseLike<unknown> {
    return (
        (typeof value === "object" || typeof value === "function") &&
        value !== null &&
        "then" in value &&
        typeof value.then === "function"
    )
}

/** Edge-triggered intersection sentinel. Control lifecycle by conditionally mounting this component. */
const ScrollSentry = React.memo(function ScrollSentry({ on_trigger, root_margin = 0, root }: ScrollSentryProps) {
    const element_ref = useRef<HTMLDivElement | null>(null)
    const on_trigger_ref = useRef(on_trigger)

    useLayoutEffect(() => {
        on_trigger_ref.current = on_trigger
    }, [on_trigger])

    useEffect(() => {
        const element = element_ref.current
        if (!element) return

        const is_ref_root = is_ref_object<HTMLElement | null>(root)
        const resolved_root = is_ref_root ? root.current : (root ?? null)
        // A RefObject with `.current === null` means the intended scroll container is unmounted;
        // skip observing instead of silently falling back to the window viewport.
        if (is_ref_root && !resolved_root) return

        let is_active = true
        let has_triggered = false
        let is_pending = false

        const observer = new IntersectionObserver(
            (entries) => {
                const latest_entry = entries[entries.length - 1]
                if (!latest_entry) return

                if (!latest_entry.isIntersecting) {
                    has_triggered = false
                    return
                }

                if (has_triggered || is_pending) return
                has_triggered = true

                const result = on_trigger_ref.current()
                if (is_thenable(result)) {
                    is_pending = true
                    const settle = () => {
                        if (!is_active) return
                        is_pending = false
                    }
                    Promise.resolve(result).then(settle, settle)
                }
            },
            {
                root: resolved_root,
                rootMargin: get_root_margin(root_margin),
                threshold: 0
            }
        )

        observer.observe(element)

        return () => {
            is_active = false
            observer.disconnect()
        }
    }, [root, root_margin])

    return <div ref={element_ref} aria-hidden="true" className="h-px w-full pointer-events-none" />
})

ScrollSentry.displayName = "ScrollSentry"

export { ScrollSentry }
