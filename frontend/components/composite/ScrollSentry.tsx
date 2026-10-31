"use client"

import type { RefObject } from "react"
import React, { useEffect, useRef, useState } from "react"
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
    const [element, set_element] = useState<HTMLDivElement | null>(null)
    const last_trigger_time_ref = useRef(0)

    useEffect(() => {
        if (!element || !enabled) return

        const resolved_root = (root && typeof root === "object" && "current" in root ? root.current : root) || null

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const target_element = entry.target as HTMLElement
                    if (is_element_hidden(target_element)) {
                        continue
                    }
                    if (entry.isIntersecting) {
                        const now = Date.now()
                        if (now - last_trigger_time_ref.current >= throttle_ms) {
                            last_trigger_time_ref.current = now
                            on_trigger()
                        }
                    }
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
            observer.disconnect()
        }
    }, [element, enabled, root, root_margin, throttle_ms, on_trigger])

    return <div ref={set_element} className="h-[0.5px] w-full pointer-events-none" />
})

ScrollSentry.displayName = "ScrollSentry"

export { ScrollSentry }
