"use client"

import { useCallback } from "react"
import { join_classes } from "@/components/utils"
import { LaunchLogo } from "./icons"

export type LaunchAnimationProps = {
    className?: string
    on_finish?: () => void
}

function LaunchAnimation({ className, on_finish }: LaunchAnimationProps) {
    const attach_launch_timer = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node) return
            const finish_timer = setTimeout(() => {
                on_finish?.()
            }, 1500)

            return () => {
                clearTimeout(finish_timer)
            }
        },
        [on_finish]
    )

    return (
        <div
            ref={attach_launch_timer}
            className={join_classes(
                "fixed inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white select-none overflow-hidden transition-opacity duration-300 ease-out",
                className
            )}
        >
            <LaunchLogo size={170} className="mb-8 shrink-0 text-black dark:text-white" />
        </div>
    )
}

export { LaunchAnimation }
