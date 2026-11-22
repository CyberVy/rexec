"use client"

import { join_classes } from "../utils"
import { AnimatedGlowText } from "./AnimatedGlowText"

import type { ReactNode, Ref } from "react"

export type EmptyStateSize = "inline" | "page"

export type EmptyStateProps = {
    size?: EmptyStateSize
    icon?: ReactNode
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
    glow?: boolean
    className?: string
    ref?: Ref<HTMLDivElement>
}

/**
 * Content-unavailable placeholder modeled after UIContentUnavailableView.
 * Supports compact inline placeholders inside lists/modals and full-page centered states.
 */
function EmptyState({
    size = "inline",
    icon,
    title,
    description,
    action,
    glow = false,
    className,
    ref
}: EmptyStateProps) {
    const is_page = size === "page"
    const title_class = is_page
        ? "text-lg font-medium text-foreground"
        : "text-xs font-medium text-black/45 dark:text-white/45"

    return (
        <div
            ref={ref}
            className={join_classes(
                "flex w-full flex-col items-center justify-center text-center select-none",
                is_page ? "min-h-[60vh] px-6 pt-12 pb-24" : "px-4 py-16",
                className
            )}
        >
            {icon != null && (
                <div
                    className={join_classes(
                        "flex items-center justify-center",
                        is_page ? "mb-4 text-black/40 dark:text-white/40" : "mb-2.5 text-black/35 dark:text-white/35"
                    )}
                >
                    {icon}
                </div>
            )}

            {glow && typeof title === "string" ? (
                <AnimatedGlowText text={title} className={title_class} />
            ) : (
                <div className={title_class}>{title}</div>
            )}

            {description != null && (
                <div
                    className={join_classes(
                        "mx-auto max-w-xs",
                        is_page
                            ? "mt-2 text-sm text-black/50 dark:text-white/50"
                            : "mt-1 text-[11px] text-black/40 dark:text-white/40"
                    )}
                >
                    {description}
                </div>
            )}

            {action != null && <div className="mt-4">{action}</div>}
        </div>
    )
}

export { EmptyState }
