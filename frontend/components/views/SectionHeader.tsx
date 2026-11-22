"use client"

import { join_classes } from "../utils"

import type { ReactNode, Ref } from "react"

export type SectionHeaderProps = {
    title: ReactNode
    count?: number
    action_label?: string
    on_action?: () => void
    className?: string
    ref?: Ref<HTMLDivElement>
}

/** Section title row with an optional count and trailing action. When on_action is set, the title is also tappable. */
function SectionHeader({ title, count, action_label, on_action, className, ref }: SectionHeaderProps) {
    const title_content = (
        <>
            <h3
                className={join_classes(
                    "text-xs font-semibold uppercase tracking-wider text-black/60 dark:text-white/60 transition-colors",
                    on_action && "group-hover:text-black dark:group-hover:text-white"
                )}
            >
                {title}
            </h3>
            {count !== undefined && (
                <span
                    className={join_classes(
                        "text-xs font-mono text-black/50 dark:text-white/50 transition-colors",
                        on_action && "group-hover:text-black/70 dark:group-hover:text-white/70"
                    )}
                >
                    ({count})
                </span>
            )}
        </>
    )

    return (
        <div ref={ref} className={join_classes("flex items-center justify-between select-none", className)}>
            {on_action ? (
                <button
                    type="button"
                    onClick={on_action}
                    className="group flex items-center gap-1.5 text-left cursor-pointer"
                >
                    {title_content}
                </button>
            ) : (
                <div className="flex items-center gap-1.5">{title_content}</div>
            )}
            {action_label && on_action && (
                <button
                    type="button"
                    onClick={on_action}
                    className="text-[11px] text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors cursor-pointer px-2 py-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 font-medium"
                >
                    {action_label}
                </button>
            )}
        </div>
    )
}

export { SectionHeader }
