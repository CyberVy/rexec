"use client"

import React from "react"
import { Image } from "./Image"
import { ContextMenu } from "./ContextMenuContainer"
import type { ReactNode, Ref } from "react"
import type { ContextMenuProps } from "./ContextMenuContainer"

export type LabeledRowProps = {
    src?: string
    alt?: string
    on_click_image?: () => void
    left_indicator?: ReactNode
    title?: ReactNode
    subtitle?: ReactNode
    right_actions?: ReactNode
    context_menu?: Omit<ContextMenuProps, "children" | "disabled" | "on_click_trigger">
    on_click_row?: () => void
    className?: string
    ref?: Ref<HTMLDivElement>
}

const LabeledRow = React.memo(function LabeledRow({
    src,
    alt,
    left_indicator,
    title,
    subtitle,
    right_actions,
    context_menu,
    on_click_row,
    on_click_image,
    className = "",
    ref
}: LabeledRowProps) {
    const row = (
        <div className="flex items-center justify-between p-2 rounded-xl transition-all duration-150 relative hover:bg-black/5 dark:hover:bg-white/5">
            {/* Main clickable area: covers left indicator, thumbnail, and texts */}
            <div className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group" onClick={on_click_row}>
                {/* Left status/index */}
                {left_indicator != null && <div className="shrink-0 text-center font-semibold">{left_indicator}</div>}

                {/* Thumbnail/Cover image with offline fallback generation */}
                <div className="w-20 sm:w-24 aspect-video shrink-0 rounded-lg overflow-hidden relative shadow-sm bg-black/10 dark:bg-white/5">
                    <Image src={src} alt={alt} onClick={on_click_image} className="w-full h-full object-cover" />
                </div>

                {/* Meta info (Title & Channel) */}
                <div className="min-w-0 flex-1 ml-1">
                    <div className="truncate font-semibold text-foreground transition-colors duration-150">{title}</div>
                    {subtitle != null && <div className="mt-1 truncate">{subtitle}</div>}
                </div>
            </div>

            {/* Independent actions block (sibling to avoid parent-click event propagation) */}
            {right_actions != null && <div className="flex items-center gap-1.5 ml-2 shrink-0">{right_actions}</div>}
        </div>
    )

    if (!context_menu) {
        return (
            <div ref={ref} className={`w-full ${className}`}>
                {row}
            </div>
        )
    }

    return (
        <ContextMenu {...context_menu} className={`w-full ${className}`} ref={ref}>
            {row}
        </ContextMenu>
    )
})

export type LabeledRowSkeletonProps = {
    className?: string
}

const LabeledRowSkeleton = React.memo(function LabeledRowSkeleton({ className = "" }: LabeledRowSkeletonProps) {
    return (
        <div
            className={`h-15.25 sm:h-17.5 w-full rounded-xl bg-black/5 dark:bg-white/5 select-none pointer-events-none ${className}`}
        />
    )
})

export { LabeledRow, LabeledRowSkeleton }
