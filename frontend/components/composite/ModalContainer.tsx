"use client"

import { useCallback, useRef } from "react"
import { is_in_browser } from "@/infra/device.client"
import { ScrollToBottomButton, ScrollToTopButton } from "@/components/composite/FixedScrollButtons"

import type { ComponentPropsWithRef } from "react"

const IS_IN_BROWSER = typeof window !== "undefined" && is_in_browser()

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
    const container_ref = useRef<HTMLDivElement | null>(null)

    const set_container_ref = useCallback(
        (node: HTMLDivElement | null) => {
            container_ref.current = node

            let user_cleanup: (() => void) | void
            if (typeof ref === "function") {
                user_cleanup = ref(node)
            } else if (ref) {
                ref.current = node
            }

            if (!node) {
                return () => {
                    container_ref.current = null
                    if (typeof user_cleanup === "function") {
                        user_cleanup()
                    } else if (typeof ref === "function") {
                        ref(null)
                    } else if (ref) {
                        ref.current = null
                    }
                }
            }

            let remove_escape_listener: (() => void) | undefined
            if (enable_escape && on_escape) {
                const handle_keydown = (e: KeyboardEvent) => {
                    if (e.key === "Escape") {
                        e.preventDefault()
                        on_escape()
                    }
                }
                window.addEventListener("keydown", handle_keydown)
                remove_escape_listener = () => window.removeEventListener("keydown", handle_keydown)
            }

            return () => {
                remove_escape_listener?.()
                container_ref.current = null
                if (typeof user_cleanup === "function") {
                    user_cleanup()
                } else if (typeof ref === "function") {
                    ref(null)
                } else if (ref) {
                    ref.current = null
                }
            }
        },
        [ref, enable_escape, on_escape]
    )

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
    const set_floating_ref = useCallback(
        (node: HTMLDivElement | null) => {
            let user_cleanup: (() => void) | void
            if (typeof ref === "function") {
                user_cleanup = ref(node)
            } else if (ref) {
                ref.current = node
            }

            if (!node) {
                return () => {
                    if (typeof user_cleanup === "function") {
                        user_cleanup()
                    } else if (typeof ref === "function") {
                        ref(null)
                    } else if (ref) {
                        ref.current = null
                    }
                }
            }

            let remove_escape_listener: (() => void) | undefined
            if (enable_escape && on_escape) {
                const handle_keydown = (e: KeyboardEvent) => {
                    if (e.key === "Escape") {
                        e.preventDefault()
                        on_escape()
                    }
                }
                window.addEventListener("keydown", handle_keydown)
                remove_escape_listener = () => window.removeEventListener("keydown", handle_keydown)
            }

            return () => {
                remove_escape_listener?.()
                if (typeof user_cleanup === "function") {
                    user_cleanup()
                } else if (typeof ref === "function") {
                    ref(null)
                } else if (ref) {
                    ref.current = null
                }
            }
        },
        [ref, enable_escape, on_escape]
    )

    return (
        <div
            ref={set_floating_ref}
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
