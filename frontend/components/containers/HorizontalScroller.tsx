"use client"

import { useMergedRef } from "../hooks"
import { join_classes } from "../utils"

import type { ComponentPropsWithRef } from "react"

export type HorizontalScrollerProps = ComponentPropsWithRef<"div">

function stop_touch_propagation(scroll_container: HTMLDivElement | null) {
    if (!scroll_container) return

    const handle_touch = (event: TouchEvent) => {
        event.stopPropagation()
    }

    scroll_container.addEventListener("touchstart", handle_touch, { passive: true })
    scroll_container.addEventListener("touchmove", handle_touch, { passive: true })

    return () => {
        scroll_container.removeEventListener("touchstart", handle_touch)
        scroll_container.removeEventListener("touchmove", handle_touch)
    }
}

/** Horizontally scrolling flex row with hidden scrollbar. Touch gestures stay inside it and do not reach ancestor swipe handlers. */
function HorizontalScroller({ className, ref, ...props }: HorizontalScrollerProps) {
    const merged_ref = useMergedRef(ref, stop_touch_propagation)

    return (
        <div
            {...props}
            ref={merged_ref}
            className={join_classes("flex w-full overflow-x-auto no-scrollbar", className)}
        />
    )
}

export { HorizontalScroller }
