"use client"

import { join_classes } from "../utils"

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

const TITLE_LINES_CLASS = {
    1: "line-clamp-1",
    2: "line-clamp-2"
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
                "group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-black/5 dark:bg-white/5 select-none transition-all duration-300",
                is_dashed
                    ? "border-dashed border-black/20 dark:border-white/20 hover:border-black/40 dark:hover:border-white/40"
                    : "border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20",
                on_click && "cursor-pointer hover:-translate-y-1",
                className
            )}
        >
            <div
                className={join_classes(
                    "relative w-full shrink-0 overflow-hidden",
                    ASPECT_CLASS[aspect],
                    is_dashed ? "bg-black/5 dark:bg-white/5" : "bg-black/20"
                )}
            >
                {media}
                {hover_icon && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <div className="flex size-11 items-center justify-center rounded-full bg-white/60 text-black shadow-lg dark:bg-black/60 dark:text-white">
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
                    <div
                        className={join_classes(
                            "text-xs sm:text-sm font-semibold leading-snug",
                            TITLE_LINES_CLASS[title_lines]
                        )}
                    >
                        {title}
                    </div>
                    {subtitle && (
                        <div className="mt-0.5 truncate text-[11px] font-medium text-black/55 dark:text-white/55">
                            {subtitle}
                        </div>
                    )}
                </div>
                {(meta || meta_trailing) && (
                    <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-black/45 dark:text-white/45">
                        <span className="truncate pr-1">{meta}</span>
                        {meta_trailing && <span className="ml-1 shrink-0">{meta_trailing}</span>}
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
                "pointer-events-none flex h-full flex-col overflow-hidden rounded-2xl border border-black/10 bg-black/5 select-none dark:border-white/10 dark:bg-white/5",
                className
            )}
        >
            <div className={join_classes("w-full shrink-0", ASPECT_CLASS[aspect])} />
            <div className="h-[75.5px] shrink-0" />
        </div>
    )
}

export { Card, CardSkeleton }
