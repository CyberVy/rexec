"use client"

import { is_in_browser } from "@/infra/device"
import { useEscapeKey } from "../hooks"
import { join_classes } from "../utils"
import { Portal } from "./Portal"
import { Transition } from "./Transition"

import type { ReactNode, Ref } from "react"
import type { TransitionStyle } from "./Transition"

const IS_IN_BROWSER = typeof window !== "undefined" && is_in_browser()
const DEFAULT_ENTER_FROM: TransitionStyle = { transform: "translateY(100vh)" }
const DEFAULT_ENTER_TO: TransitionStyle = { transform: "translateY(0)" }

export type FullscreenSheetProps = {
    open: boolean
    on_close?: () => void
    enable_escape?: boolean
    z_index?: number
    duration?: number
    easing?: string
    enter_from?: TransitionStyle
    enter_to?: TransitionStyle
    exit_from?: TransitionStyle
    exit_to?: TransitionStyle
    className?: string
    children?: ReactNode
    ref?: Ref<HTMLDivElement>
}

/**
 * Full-viewport sheet presentation with portal hosting, enter/exit transitions,
 * Escape dismissal, and iOS standalone/browser viewport height handling.
 */
function FullscreenSheet({
    open,
    on_close,
    enable_escape = true,
    z_index = 50,
    duration = 300,
    easing = "ease-in-out",
    enter_from = DEFAULT_ENTER_FROM,
    enter_to = DEFAULT_ENTER_TO,
    exit_from,
    exit_to,
    className,
    children,
    ref
}: FullscreenSheetProps) {
    useEscapeKey(open && enable_escape, on_close)

    return (
        <Portal>
            <Transition
                show={open}
                enter_from={enter_from}
                enter_to={enter_to}
                exit_from={exit_from}
                exit_to={exit_to}
                duration={duration}
                easing={easing}
                unmount_on_exit={true}
                style={{ zIndex: z_index }}
                className="fixed inset-0"
            >
                <div
                    ref={ref}
                    role="dialog"
                    aria-modal="true"
                    className={join_classes(
                        "relative w-full h-screen overflow-hidden overscroll-none",
                        // Keep 100vh as baseline in iOS containers without browser chrome (e.g. standalone/PWA).
                        IS_IN_BROWSER && "supports-[height:100dvh]:h-dvh",
                        "bg-(--ui-surface-fullscreen) text-foreground backdrop-blur-2xl pt-[env(safe-area-inset-top)]",
                        className
                    )}
                >
                    {children}
                </div>
            </Transition>
        </Portal>
    )
}

export { FullscreenSheet }
