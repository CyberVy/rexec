"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import { useEscapeKey, useMergedRef } from "../hooks"
import { join_classes } from "../utils"
import { Transition } from "./Transition"

import type { ReactNode, Ref } from "react"
import type { TransitionStyle } from "./Transition"

const DEFAULT_ENTER_FROM: TransitionStyle = { opacity: 0, transform: "scale(0.95)" }
const DEFAULT_ENTER_TO: TransitionStyle = { opacity: 1, transform: "scale(1)" }

export type PopoverProps = {
    open: boolean
    on_close?: () => void
    enable_escape?: boolean
    close_on_outside_click?: boolean
    unmount_on_exit?: boolean
    duration?: number
    easing?: string
    enter_from?: TransitionStyle
    enter_to?: TransitionStyle
    exit_from?: TransitionStyle
    exit_to?: TransitionStyle
    className?: string
    panel_class_name?: string
    trigger: ReactNode
    children: ReactNode
    ref?: Ref<HTMLDivElement>
}

/**
 * Anchored overlay presentation relative to its trigger element,
 * handling transitions, Escape key dismissal, and outside pointer dismissal.
 */
function Popover({
    open,
    on_close,
    enable_escape = true,
    close_on_outside_click = true,
    unmount_on_exit = true,
    duration = 250,
    easing = "ease-in-out",
    enter_from = DEFAULT_ENTER_FROM,
    enter_to = DEFAULT_ENTER_TO,
    exit_from,
    exit_to,
    className,
    panel_class_name,
    trigger,
    children,
    ref
}: PopoverProps) {
    const root_ref = useRef<HTMLDivElement | null>(null)
    const set_root_ref = useMergedRef(root_ref, ref)
    const on_close_ref = useRef(on_close)

    useLayoutEffect(() => {
        on_close_ref.current = on_close
    }, [on_close])

    useEscapeKey(open && enable_escape, on_close)

    useEffect(() => {
        if (!open || !close_on_outside_click) return

        const handle_pointer_down = (event: PointerEvent) => {
            const root = root_ref.current
            if (!root) return
            if (event.target instanceof Node && !root.contains(event.target)) {
                on_close_ref.current?.()
            }
        }

        document.addEventListener("pointerdown", handle_pointer_down)
        return () => document.removeEventListener("pointerdown", handle_pointer_down)
    }, [open, close_on_outside_click])

    return (
        <div ref={set_root_ref} className={join_classes("relative inline-flex", className)}>
            {trigger}
            <Transition
                show={open}
                enter_from={enter_from}
                enter_to={enter_to}
                exit_from={exit_from}
                exit_to={exit_to}
                duration={duration}
                easing={easing}
                mount_on_init={false}
                unmount_on_exit={unmount_on_exit}
                className={join_classes("absolute z-50", panel_class_name)}
            >
                {children}
            </Transition>
        </div>
    )
}

export { Popover }
