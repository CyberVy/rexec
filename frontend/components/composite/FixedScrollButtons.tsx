"use client"

import { ButtonGroup } from "@/components/base/Buttons"
import { string_icons } from "@/components/ui_constants"
import React from "react"
import { join_classes } from "../utils"

import type { ComponentPropsWithRef, RefObject } from "react"

export type ScrollButtonProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
    element_ref?: RefObject<HTMLDivElement | null>
    on_scroll?: () => void
    offset?: number
}

function scroll_element({ element_ref, on_scroll, offset = 0 }: ScrollButtonProps, position: "top" | "bottom") {
    if (!element_ref?.current) {
        const { documentElement } = document
        // use window.outerHeight
        // or use window.innerHeight instead of documentElement.clientHeight
        // to get the correct viewport height with
        // css: min-height: calc(100% + env(safe-area-inset-top) + env(safe-area-inset-bottom));
        // for Apple Webkit
        // https://bugs.webkit.org/show_bug.cgi?id=210009
        documentElement.scrollTop =
            position === "top" ? 0 + offset : documentElement.scrollHeight - window.innerHeight - offset
        on_scroll?.()
        return
    }

    element_ref.current.scrollTop =
        position === "top" ? 0 + offset : element_ref.current.scrollHeight - element_ref.current.clientHeight - offset
    on_scroll?.()
}

const ScrollToTopButton = React.memo(function ScrollToTopButton({
    element_ref,
    on_scroll,
    offset = 1,
    className,
    ref,
    ...props
}: ScrollButtonProps) {
    return (
        <div {...props} ref={ref} className={join_classes("fixed z-10 select-none text-2xl", className)}>
            <ButtonGroup
                className="rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-xl shadow-sm p-1"
                items={[
                    {
                        content: string_icons.up_triangle,
                        className: "w-10 h-10",
                        on_click: () => scroll_element({ element_ref, on_scroll, offset }, "top")
                    }
                ]}
            />
        </div>
    )
})

const ScrollToBottomButton = React.memo(function ScrollToBottomButton({
    element_ref,
    on_scroll,
    offset = 1,
    className,
    ref,
    ...props
}: ScrollButtonProps) {
    return (
        <div {...props} ref={ref} className={join_classes("fixed z-10 select-none text-2xl", className)}>
            <ButtonGroup
                className="rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-xl shadow-sm p-1"
                items={[
                    {
                        content: string_icons.down_triangle,
                        className: "w-10 h-10",
                        on_click: () => scroll_element({ element_ref, on_scroll, offset }, "bottom")
                    }
                ]}
            />
        </div>
    )
})

const ScrollButtonGroup = React.memo(function ScrollButtonGroup({
    element_ref,
    on_scroll,
    offset = 0,
    className,
    ref,
    ...props
}: ScrollButtonProps) {
    return (
        <div {...props} ref={ref} className={join_classes("fixed z-10 select-none text-2xl", className)}>
            <ButtonGroup
                className="rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-xl shadow-sm p-1"
                items={[
                    {
                        content: string_icons.up_triangle,
                        className: "w-13 h-10",
                        on_click: () => scroll_element({ element_ref, on_scroll, offset }, "top")
                    },
                    {
                        content: string_icons.down_triangle,
                        className: "w-13 h-10",
                        on_click: () => scroll_element({ element_ref, on_scroll, offset }, "bottom")
                    }
                ]}
            />
        </div>
    )
})

ScrollToTopButton.displayName = "ScrollToTopButton"
ScrollToBottomButton.displayName = "ScrollToBottomButton"
ScrollButtonGroup.displayName = "ScrollButtonGroup"

export { ScrollToTopButton, ScrollToBottomButton, ScrollButtonGroup }
