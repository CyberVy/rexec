"use client"

import { useEffect, useRef } from "react"
import { useMergedRef } from "@/components/hooks"
import { is_in_browser } from "@/infra/device.client"
import { ScrollToBottomButton, ScrollToTopButton } from "@/components/composite/FixedScrollButtons"

import type { ReactNode, Ref } from "react"

const IS_IN_BROWSER = typeof window !== "undefined" && is_in_browser()

function useEscapeKeyListener(enable_escape: boolean, on_escape?: () => void) {
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
}

export type FullscreenModalContainerProps = {
    children?: ReactNode
    className?: string
    ref?: Ref<HTMLDivElement>
    scroll_top_icon?: ReactNode
    scroll_bottom_icon?: ReactNode
    on_escape?: () => void
    enable_escape?: boolean
}

function FullscreenModalContainer({
    className = "",
    children,
    scroll_top_icon,
    scroll_bottom_icon,
    on_escape,
    enable_escape = true,
    ref
}: FullscreenModalContainerProps) {
    const container_ref = useRef<HTMLDivElement | null>(null)
    const set_container_ref = useMergedRef(container_ref, ref)

    useEscapeKeyListener(enable_escape, on_escape)

    return (
        <div
            ref={set_container_ref}
            className={[
                "fixed left-0 top-0 w-screen overflow-auto no-scrollbar overscroll-none",
                "h-screen",
                // Keep 100vh as baseline in iOS containers without browser chrome (e.g. standalone/PWA).
                // The issue is timing of dynamic viewport-related layout metrics (not dvh itself): values like offsetTop can settle later.
                // Any CSS that depends on browser UI chrome, such as dvh or inset, can trigger the same delay.
                IS_IN_BROWSER ? "supports-[height:100dvh]:h-dvh" : "",
                "pt-[env(safe-area-inset-top)]",
                className
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
            {scroll_top_icon && scroll_bottom_icon && (
                <>
                    <ScrollToTopButton
                        icon={scroll_top_icon}
                        className="bottom-4 right-4"
                        element_ref={container_ref}
                    />
                    <ScrollToBottomButton
                        icon={scroll_bottom_icon}
                        className="bottom-4 right-17"
                        element_ref={container_ref}
                    />
                </>
            )}
        </div>
    )
}

export { FullscreenModalContainer }

export type FloatingModalContainerProps = {
    children?: ReactNode
    className?: string
    ref?: Ref<HTMLDivElement>
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
    ref
}: FloatingModalContainerProps) {
    useEscapeKeyListener(enable_escape, on_escape)

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
            onClick={(event) => {
                event.stopPropagation()
            }}
        >
            {children}
        </div>
    )
}

export { FloatingModalContainer }
