"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { is_in_browser } from "@/infra/device.client"
import { ScrollToBottomButton, ScrollToTopButton } from "@/components/composite/FixedScrollButtons"

import type { ComponentPropsWithRef } from "react"

export type FullscreenModalContainerProps = ComponentPropsWithRef<"div"> & {
    enable_scroll_button?: boolean
    on_escape?: () => void
    enable_escape?: boolean
}

function FullscreenModalContainer({
    className = "",
    children,
    enable_scroll_button = false,
    on_escape,
    enable_escape = true,
    ref,
    ...props
}: FullscreenModalContainerProps) {
    const [in_browser, set_in_browser] = useState(true)
    const container_ref = useRef<HTMLDivElement | null>(null)

    const set_container_ref = useCallback(
        (node: HTMLDivElement | null) => {
            container_ref.current = node
            if (typeof ref === "function") {
                ref(node)
                return
            }
            if (ref) {
                ref.current = node
            }
        },
        [ref]
    )

    useEffect(() => {
        set_in_browser(is_in_browser())
    }, [])

    useEffect(() => {
        if (!enable_escape || !on_escape) return

        const handle_keydown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault()
                on_escape()
            }
        }

        window.addEventListener("keydown", handle_keydown)
        return () => window.removeEventListener("keydown", handle_keydown)
    }, [enable_escape, on_escape])

    return (
        <div
            ref={set_container_ref}
            className={[
                "fixed left-0 top-0 w-screen overflow-auto no-scrollbar overscroll-none",
                "h-screen",
                // Keep 100vh as baseline in iOS containers without browser chrome (e.g. standalone/PWA).
                // The issue is timing of dynamic viewport-related layout metrics (not dvh itself): values like offsetTop can settle later.
                // Any CSS that depends on browser UI chrome, such as dvh or inset, can trigger the same delay.
                in_browser ? "supports-[height:100dvh]:h-dvh" : "",
                "pt-[env(safe-area-inset-top)]",
                className
            ]
                .filter(Boolean)
                .join(" ")}
            {...props}
        >
            {children}
            {enable_scroll_button && (
                <>
                    <ScrollToTopButton className="bottom-4 right-4" element_ref={container_ref} />
                    <ScrollToBottomButton className="bottom-4 right-17" element_ref={container_ref} />
                </>
            )}
        </div>
    )
}

export { FullscreenModalContainer }

export type FloatingModalContainerProps = ComponentPropsWithRef<"div"> & {
    on_escape?: () => void
    enable_escape?: boolean
    center?: boolean
}

function FloatingModalContainer({
    className = "",
    children,
    on_escape,
    enable_escape = true,
    center = true,
    ref,
    onClick,
    ...props
}: FloatingModalContainerProps) {
    useEffect(() => {
        if (!enable_escape || !on_escape) return

        const handle_keydown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault()
                on_escape()
            }
        }

        window.addEventListener("keydown", handle_keydown)
        return () => window.removeEventListener("keydown", handle_keydown)
    }, [enable_escape, on_escape])

    return (
        <div
            ref={ref}
            className={[
                "fixed z-51 pointer-events-auto",
                center ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : "",
                "flex flex-col rounded-3xl border border-black/10 dark:border-white/10",
                "bg-white/85 dark:bg-[#141414]/85 backdrop-blur-xl shadow-2xl text-foreground",
                className
            ]
                .filter(Boolean)
                .join(" ")}
            onClick={(e) => {
                e.stopPropagation()
                onClick?.(e)
            }}
            {...props}
        >
            {children}
        </div>
    )
}

export { FloatingModalContainer }
