"use client"

import { join_classes } from "../utils"
import { Text } from "./Text"

import type { ReactNode, Ref } from "react"

export type CardAspect = "video" | "poster" | "square"

export type CardProps = {
    aspect: CardAspect
    media: ReactNode
    hover_icon?: ReactNode
    top_left?: ReactNode
    top_right?: ReactNode
    bottom_left?: ReactNode
    bottom_right?: ReactNode
    title: ReactNode
    title_lines?: 1 | 2
    subtitle?: ReactNode
    meta?: ReactNode
    meta_trailing?: ReactNode
    variant?: "solid" | "dashed"
    on_click?: () => void
    className?: string
    ref?: Ref<HTMLDivElement>
}

const ASPECT_CLASS: Record<CardAspect, string> = {
    video: "aspect-video",
    poster: "aspect-3/4",
    square: "aspect-square"
}

/**
 * Media card shell: aspect-ratio media area with corner slots and an optional hover icon,
 * above a fixed-height text area. Wrap it in a ContextMenu for context actions.
 */
function Card({
    aspect,
    media,
    hover_icon,
    top_left,
    top_right,
    bottom_left,
    bottom_right,
    title,
    title_lines = 1,
    subtitle,
    meta,
    meta_trailing,
    variant = "solid",
    on_click,
    className,
    ref
}: CardProps) {
    const is_dashed = variant === "dashed"

    return (
        <div
            ref={ref}
            onClick={on_click}
            className={join_classes(
                "group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-ui-fill-subtle select-none transition-all duration-300",
                is_dashed
                    ? "border-dashed border-ui-border-hover hover:border-ui-border-strong"
                    : "border-ui-border hover:border-ui-border-hover",
                on_click && "cursor-pointer hover:-translate-y-1",
                className
            )}
        >
            <div
                className={join_classes(
                    "relative w-full shrink-0 overflow-hidden",
                    ASPECT_CLASS[aspect],
                    is_dashed ? "bg-ui-fill-subtle" : "bg-ui-scrim-subtle"
                )}
            >
                {media}
                {hover_icon && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ui-scrim opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <div className="flex size-11 items-center justify-center rounded-full bg-ui-surface-sheet text-ui-label-strong shadow-lg">
                            {hover_icon}
                        </div>
                    </div>
                )}
                {top_left && <div className="absolute top-2 left-2 z-2">{top_left}</div>}
                {top_right && <div className="absolute top-2 right-2 z-2">{top_right}</div>}
                {bottom_left && <div className="absolute bottom-2 left-2 z-2">{bottom_left}</div>}
                {bottom_right && <div className="absolute right-2 bottom-2 z-2">{bottom_right}</div>}
            </div>

            <div className="flex h-[75.5px] shrink-0 flex-col justify-between p-2.5">
                <div className="overflow-hidden">
                    <Text
                        as="div"
                        variant="caption"
                        weight="semibold"
                        lines={title_lines}
                        className="sm:text-sm leading-snug"
                    >
                        {title}
                    </Text>
                    {subtitle && (
                        <Text as="div" variant="footnote" weight="medium" tone="secondary" truncate className="mt-0.5">
                            {subtitle}
                        </Text>
                    )}
                </div>
                {(meta || meta_trailing) && (
                    <div className="mt-1 flex items-center justify-between">
                        <Text variant="footnote" weight="medium" tone="tertiary" truncate className="pr-1">
                            {meta}
                        </Text>
                        {meta_trailing && (
                            <Text variant="footnote" weight="medium" tone="tertiary" className="ml-1 shrink-0">
                                {meta_trailing}
                            </Text>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

export type CardSkeletonProps = {
    aspect: CardAspect
    className?: string
}

function CardSkeleton({ aspect, className }: CardSkeletonProps) {
    return (
        <div
            className={join_classes(
                "pointer-events-none flex h-full flex-col overflow-hidden rounded-2xl border border-ui-border bg-ui-fill-subtle select-none",
                className
            )}
        >
            <div className={join_classes("w-full shrink-0", ASPECT_CLASS[aspect])} />
            <div className="h-[75.5px] shrink-0" />
        </div>
    )
}

export { Card, CardSkeleton }
