"use client"

import { useEscapeKey } from "../hooks"
import { join_classes } from "../utils"
import { Portal } from "./Portal"
import { Transition } from "./Transition"

import type { ReactNode, Ref } from "react"
import type { TransitionStyle } from "./Transition"

const DEFAULT_ENTER_FROM: TransitionStyle = { transform: "scale(0.94)", opacity: 0 }
const DEFAULT_ENTER_TO: TransitionStyle = { transform: "scale(1)", opacity: 1 }

export type ModalProps = {
    open: boolean
    on_close?: () => void
    close_label?: string
    close_on_backdrop?: boolean
    enable_escape?: boolean
    unmount_on_exit?: boolean
    center?: boolean
    z_index?: number
    duration?: number
    easing?: string
    enter_from?: TransitionStyle
    enter_to?: TransitionStyle
    exit_from?: TransitionStyle
    exit_to?: TransitionStyle
    backdrop_class_name?: string
    container_class_name?: string
    className?: string
    children?: ReactNode
    ref?: Ref<HTMLDivElement>
}

/**
 * Self-contained modal presentation controller: manages portal mounting, dimming backdrop,
 * WebKit-safe backdrop hit-testing, Escape dismissal, and enter/exit transitions.
 */
function Modal({
    open,
    on_close,
    close_label = "Close",
    close_on_backdrop = true,
    enable_escape = true,
    unmount_on_exit = true,
    center = true,
    z_index = 50,
    duration = 220,
    easing = "cubic-bezier(0.16, 1, 0.3, 1)",
    enter_from = DEFAULT_ENTER_FROM,
    enter_to = DEFAULT_ENTER_TO,
    exit_from,
    exit_to,
    backdrop_class_name,
    container_class_name,
    className,
    children,
    ref
}: ModalProps) {
    useEscapeKey(open && enable_escape, on_close)

    return (
        <Portal>
            <Transition
                show={open}
                enter_from={{ opacity: 0 }}
                enter_to={{ opacity: 1 }}
                exit_from={{ opacity: 1 }}
                exit_to={{ opacity: 0 }}
                duration={duration}
                easing="ease-out"
                unmount_on_exit={true}
                style={{ zIndex: z_index }}
                className={join_classes(
                    "fixed inset-0 bg-ui-backdrop backdrop-blur-xs select-none",
                    backdrop_class_name
                )}
            >
                <button
                    type="button"
                    aria-label={close_label}
                    className="block w-full h-full"
                    onClick={open && close_on_backdrop ? on_close : undefined}
                />
            </Transition>

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
                style={{ zIndex: z_index + 1 }}
                role="dialog"
                aria-modal="true"
                className={join_classes(
                    "fixed inset-0 pointer-events-none select-none",
                    center && "flex items-center justify-center p-4",
                    container_class_name
                )}
            >
                <div
                    ref={ref}
                    className={join_classes(
                        "pointer-events-auto flex flex-col rounded-3xl border border-ui-border bg-ui-surface backdrop-blur-xl shadow-2xl text-ui-label",
                        className
                    )}
                    onClick={(event) => {
                        event.stopPropagation()
                    }}
                >
                    {children}
                </div>
            </Transition>
        </Portal>
    )
}

export { Modal }
