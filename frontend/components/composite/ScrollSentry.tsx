"use client"

import type { RefObject } from "react"
import React, { useEffect, useLayoutEffect, useRef } from "react"
import { is_element_hidden } from "@/components/utils"

export type ScrollSentryProps = {
    on_trigger: () => void
    throttle_ms?: number
    root_margin?: string | number
    root?: HTMLElement | RefObject<HTMLElement | null> | null
    enabled?: boolean
}

function get_root_margin(root_margin: number | string) {
    if (typeof root_margin === "number") return `${root_margin}px`
    return root_margin
}

const ScrollSentry = React.memo(function ScrollSentry({
    on_trigger,
    throttle_ms = 500,
    root_margin = 0,
    root,
    enabled = true
}: ScrollSentryProps) {
    const element_ref = useRef<HTMLDivElement | null>(null)
    const last_trigger_time_ref = useRef(0)
    const on_trigger_ref = useRef(on_trigger)

    useLayoutEffect(() => {
        on_trigger_ref.current = on_trigger
    })

    useEffect(() => {
        const element = element_ref.current
        if (!element || !enabled) return

        const resolved_root = (root && typeof root === "object" && "current" in root ? root.current : root) || null
        let is_intersecting = false
        let retry_timer: ReturnType<typeof setTimeout> | null = null

        const clear_retry_timer = () => {
            if (retry_timer !== null) {
                clearTimeout(retry_timer)
                retry_timer = null
            }
        }

        const fire_trigger = () => {
            clear_retry_timer()
            last_trigger_time_ref.current = Date.now()
            on_trigger_ref.current()
        }

        const try_trigger = () => {
            const elapsed = Date.now() - last_trigger_time_ref.current
            if (elapsed >= throttle_ms) {
                fire_trigger()
                return
            }

            if (retry_timer === null) {
                retry_timer = setTimeout(() => {
                    retry_timer = null
                    if (!is_intersecting || is_element_hidden(element)) return
                    fire_trigger()
                }, throttle_ms - elapsed)
            }
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const latest_entry = entries[entries.length - 1]
                if (!latest_entry) return

                if (is_element_hidden(latest_entry.target as HTMLElement)) {
                    is_intersecting = false
                    clear_retry_timer()
                    return
                }

                is_intersecting = latest_entry.isIntersecting
                if (is_intersecting) {
                    try_trigger()
                } else {
                    clear_retry_timer()
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
            is_intersecting = false
            clear_retry_timer()
            observer.disconnect()
        }
    }, [enabled, root, root_margin, throttle_ms])

    return <div ref={element_ref} className="h-[0.5px] w-full pointer-events-none" />
})

ScrollSentry.displayName = "ScrollSentry"

export { ScrollSentry }
