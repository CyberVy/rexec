"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useMergedRef } from "../hooks"
import type { ComponentPropsWithRef, CSSProperties, ReactNode } from "react"

export type TransitionStyle = Pick<CSSProperties, "opacity" | "transform" | "filter">

// Passthrough div props (aria-*, role, onClick...) land on the root div.
export type TransitionProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
    show?: boolean
    children: ReactNode
    duration?: number
    delay?: number
    easing?: string
    enter_from: TransitionStyle
    enter_to: TransitionStyle
    exit_from?: TransitionStyle
    exit_to?: TransitionStyle
    on_enter_start?: () => void
    on_enter_end?: () => void
    on_exit_start?: () => void
    on_exit_end?: () => void
    mount_on_init?: boolean
    unmount_on_exit?: boolean
    animate_on_mount?: boolean
}

/**
 * Ensure the container and its children stay visually aligned before using this wrapper.
 * This is especially important when children include `absolute`, `fixed`, or other positioned content.
 *
 * Note: To ensure exit animations play correctly, do not conditionally unmount this component
 * in the parent. Use `show={state}` and `unmount_on_exit={true}` instead.
 */
function Transition({
    show = true,
    children,
    className,
    style,
    duration = 300,
    delay = 0,
    easing = "ease-in-out",
    enter_from,
    enter_to,
    exit_from,
    exit_to,
    on_enter_start,
    on_enter_end,
    on_exit_start,
    on_exit_end,
    mount_on_init = true,
    unmount_on_exit = false,
    animate_on_mount = true,
    ref,
    ...props
}: TransitionProps) {
    const element_ref = useRef<HTMLDivElement>(null)
    const animation_ref = useRef<Animation | null>(null)
    const set_element_ref = useMergedRef(element_ref, ref)
    const [render_mode, set_render_mode] = useState<
        "entering" | "visible" | "exiting_to_hidden" | "hidden" | "exiting_to_unmount" | "unmount"
    >(() => {
        if (show) {
            return animate_on_mount ? "entering" : "visible"
        }
        return mount_on_init && !unmount_on_exit ? "hidden" : "unmount"
    })

    const [prev_show, set_prev_show] = useState(show)

    if (show !== prev_show) {
        set_prev_show(show)
        set_render_mode(show ? "entering" : unmount_on_exit ? "exiting_to_unmount" : "exiting_to_hidden")
    } else if (!show && unmount_on_exit && render_mode === "hidden") {
        set_render_mode("unmount")
    } else if (!show && mount_on_init && !unmount_on_exit && render_mode === "unmount") {
        set_render_mode("hidden")
    }

    const latest_props_ref = useRef({
        duration,
        delay,
        easing,
        enter_from,
        enter_to,
        exit_from,
        exit_to,
        on_enter_start,
        on_enter_end,
        on_exit_start,
        on_exit_end,
        unmount_on_exit
    })

    useLayoutEffect(() => {
        latest_props_ref.current = {
            duration,
            delay,
            easing,
            enter_from,
            enter_to,
            exit_from,
            exit_to,
            on_enter_start,
            on_enter_end,
            on_exit_start,
            on_exit_end,
            unmount_on_exit
        }
    })

    useEffect(() => {
        if (show && render_mode !== "entering") return
        if (!show && render_mode !== "exiting_to_hidden" && render_mode !== "exiting_to_unmount") return

        const element = element_ref.current
        if (!element) return

        animation_ref.current?.cancel()

        const cfg = latest_props_ref.current
        const animation = element.animate(
            show ? [cfg.enter_from, cfg.enter_to] : [cfg.exit_from || cfg.enter_to, cfg.exit_to || cfg.enter_from],
            {
                duration: cfg.duration,
                delay: cfg.delay,
                easing: cfg.easing,
                fill: "both"
            }
        )

        animation_ref.current = animation

        if (show) {
            cfg.on_enter_start?.()
        } else {
            cfg.on_exit_start?.()
        }

        animation.finished
            .then(() => {
                if (animation_ref.current !== animation) return

                animation_ref.current = null
                const latest = latest_props_ref.current

                if (show) {
                    animation.cancel()
                    latest.on_enter_end?.()
                    set_render_mode("visible")
                } else {
                    latest.on_exit_end?.()
                    set_render_mode(latest.unmount_on_exit ? "unmount" : "hidden")
                }
            })
            .catch(() => {})

        return () => {
            if (animation_ref.current === animation) {
                animation_ref.current = null
            }
            animation.cancel()
        }
    }, [show])

    if (!["hidden", "unmount"].includes(render_mode) || show) {
        return (
            <div {...props} ref={set_element_ref} className={className} style={style}>
                {children}
            </div>
        )
    }
    if (render_mode === "hidden") {
        return (
            <div
                {...props}
                ref={set_element_ref}
                className={className}
                style={{ ...style, display: "none" }}
                hidden={true}
            >
                {children}
            </div>
        )
    }
    return null
}

export { Transition }
