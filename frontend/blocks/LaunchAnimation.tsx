"use client"

import { useEffect, useState } from "react"
import { AnimatedGlowText } from "@/components"
import { join_classes } from "@/components/utils"
import { LaunchLogo } from "./icons"

export type LaunchAnimationProps = {
    className?: string
    on_finish?: () => void
}

function LaunchAnimation({ className, on_finish }: LaunchAnimationProps) {
    const [status_text, set_status_text] = useState(">_ Initializing engine...")
    const [is_exiting, set_is_exiting] = useState(false)

    useEffect(() => {
        const timer1 = setTimeout(() => {
            set_status_text(">_ Synchronizing mesh nodes...")
        }, 600)

        const timer2 = setTimeout(() => {
            set_status_text(">_ Dispatching exec signal...")
        }, 1150)

        const timer3 = setTimeout(() => {
            set_status_text(">_ Session ready")
        }, 1650)

        const exit_timer = setTimeout(() => {
            set_is_exiting(true)
        }, 2100)

        const finish_timer = setTimeout(() => {
            on_finish?.()
        }, 2400)

        return () => {
            clearTimeout(timer1)
            clearTimeout(timer2)
            clearTimeout(timer3)
            clearTimeout(exit_timer)
            clearTimeout(finish_timer)
        }
    }, [on_finish])

    return (
        <div
            className={join_classes(
                "fixed inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white select-none overflow-hidden transition-opacity duration-300 ease-out",
                is_exiting ? "opacity-0 pointer-events-none" : "opacity-100",
                className
            )}
        >
            <div className="w-full max-w-sm flex flex-col items-center justify-center p-6 text-center">
                <LaunchLogo size={170} className="mb-8 shrink-0 text-black dark:text-white" />
                <div className="flex items-center justify-center h-6 w-72 max-w-[85vw] font-mono text-xs tracking-wider text-black/75 dark:text-white/80 overflow-hidden whitespace-nowrap cursor-default">
                    <AnimatedGlowText text={status_text} stagger={0.03} />
                </div>
            </div>
        </div>
    )
}

export { LaunchAnimation }
