"use client"

import React from "react"
import { Image } from "./Image"
import { ContextMenu } from "./ContextMenuContainer"
import type { ComponentPropsWithRef, ReactNode } from "react"
import type { ContextMenuProps } from "./ContextMenuContainer"

export type LabeledRowProps = Omit<ComponentPropsWithRef<"div">, "children" | "title"> & {
    // Cover image properties passed to the internal FallbackImage
    src?: string
    alt?: string
    image_proxy_api?: string
    on_click_image?: () => void

    // Layout slots
    left_indicator?: ReactNode // E.g., index numbers, playback status indicators
    title?: ReactNode // Title of the video/song (can be a pre-styled string or ReactNode)
    subtitle?: ReactNode // Author/Channel/Muted information (can be a styled ReactNode)
    right_actions?: ReactNode // Quick actions on the far right

    // Context Menu config
    context_menu?: Omit<ContextMenuProps, "children" | "disabled" | "on_click_trigger">

    // Callbacks
    on_click_row?: () => void
}

const LabeledRow = React.memo(function LabeledRow({
    src,
    alt,
    image_proxy_api,
    left_indicator,
    title,
    subtitle,
    right_actions,
    context_menu,
    on_click_row,
    on_click_image,
    className = "",
    ref,
    ...props
}: LabeledRowProps) {
    return (
        <ContextMenu
            sections={context_menu?.sections || []}
            {...context_menu}
            className={`w-full ${className}`}
            ref={ref}
        >
            <div
                {...props}
                className={`flex items-center justify-between p-2 rounded-xl transition-all duration-150 relative hover:bg-black/5 dark:hover:bg-white/5`}
            >
                {/* Main clickable area: covers left indicator, thumbnail, and texts */}
                <div className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group" onClick={on_click_row}>
                    {/* Left status/index */}
                    {left_indicator != null && (
                        <div className="text-xs font-semibold w-6 text-center shrink-0">{left_indicator}</div>
                    )}

                    {/* Thumbnail/Cover image with offline fallback generation */}
                    <div className="w-20 sm:w-24 aspect-video shrink-0 rounded-lg overflow-hidden relative shadow-sm bg-black/10 dark:bg-white/5">
                        <Image
                            src={src}
                            alt={alt}
                            image_proxy_api={image_proxy_api}
                            onClick={on_click_image}
                            className="w-full h-full object-cover"
                        />
                    </div>

                    {/* Meta info (Title & Channel) */}
                    <div className="min-w-0 flex-1 ml-1">
                        <div className="text-sm font-semibold truncate transition-colors duration-150 text-foreground">
                            {title}
                        </div>
                        {subtitle != null && <div className="text-xs mt-1 truncate">{subtitle}</div>}
                    </div>
                </div>

                {/* Independent actions block (sibling to avoid parent-click event propagation) */}
                {right_actions != null && (
                    <div className="flex items-center gap-1.5 ml-2 shrink-0">{right_actions}</div>
                )}
            </div>
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
