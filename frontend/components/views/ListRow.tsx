"use client"

import { join_classes } from "../utils"
import { Text } from "./Text"

import type { ReactNode, Ref } from "react"

export type ListRowSize = "sm" | "md"
export type ListRowAspect = "poster" | "square" | "video"
export type ListRowVariant = "plain" | "filled"

export type ListRowProps = {
    size?: ListRowSize
    variant?: ListRowVariant
    leading?: ReactNode
    media?: ReactNode
    media_aspect?: ListRowAspect
    title: ReactNode
    subtitle?: ReactNode
    trailing?: ReactNode
    on_click?: () => void
    className?: string
    ref?: Ref<HTMLDivElement>
}

const ROW_PADDING_CLASS: Record<ListRowSize, string> = {
    sm: "px-3 py-2.5",
    md: "px-3 py-3"
}

const ROW_VARIANT_CLASS: Record<ListRowVariant, string> = {
    plain: "hover:bg-ui-fill-subtle",
    filled: "bg-ui-fill-subtle hover:bg-ui-fill-hover"
}

const MEDIA_HEIGHT_CLASS: Record<ListRowSize, string> = {
    sm: "h-12",
    md: "h-16"
}

const MEDIA_ASPECT_CLASS: Record<ListRowAspect, string> = {
    poster: "aspect-3/4",
    square: "aspect-square",
    video: "aspect-video"
}

const MEDIA_ROW_HEIGHT_CLASS: Record<ListRowSize, string> = {
    sm: "h-17",
    md: "h-22"
}

const TEXT_ROW_HEIGHT_CLASS: Record<ListRowSize, string> = {
    sm: "h-15.25",
    md: "h-16.25"
}

/**
 * List cell primitive with optional leading indicator, fixed-height thumbnail media,
 * primary/secondary text stack, and independent trailing actions.
 * Pair rows inside LazyContainer with ListRowSkeleton of the same size and has_media mode for zero CLS.
 */
function ListRow({
    size = "sm",
    variant = "plain",
    leading,
    media,
    media_aspect = "poster",
    title,
    subtitle,
    trailing,
    on_click,
    className,
    ref
}: ListRowProps) {
    const row_height_class =
        media != null ? MEDIA_ROW_HEIGHT_CLASS[size] : subtitle != null ? TEXT_ROW_HEIGHT_CLASS[size] : undefined

    const main_content = (
        <>
            {leading != null && <div className="shrink-0">{leading}</div>}
            {media != null && (
                <div
                    className={join_classes(
                        "shrink-0 overflow-hidden rounded-lg border border-ui-border bg-ui-fill-hover",
                        MEDIA_HEIGHT_CLASS[size],
                        MEDIA_ASPECT_CLASS[media_aspect]
                    )}
                >
                    {media}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <Text
                    as="div"
                    variant="body"
                    weight="medium"
                    truncate
                    className="transition-colors group-hover:text-ui-label-strong"
                >
                    {title}
                </Text>
                {subtitle != null && (
                    <Text as="div" variant="caption" tone="secondary" truncate className="mt-0.5">
                        {subtitle}
                    </Text>
                )}
            </div>
        </>
    )

    return (
        <div
            ref={ref}
            className={join_classes(
                "group flex items-center justify-between gap-3 rounded-xl transition-colors",
                ROW_PADDING_CLASS[size],
                row_height_class,
                ROW_VARIANT_CLASS[variant],
                className
            )}
        >
            <div
                onClick={on_click}
                className={join_classes("flex min-w-0 flex-1 items-center gap-3", on_click && "cursor-pointer")}
            >
                {main_content}
            </div>
            {trailing != null && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
        </div>
    )
}

export type ListRowSkeletonProps = {
    size?: ListRowSize
    has_media?: boolean
    className?: string
}

function ListRowSkeleton({ size = "sm", has_media = true, className }: ListRowSkeletonProps) {
    return (
        <div
            className={join_classes(
                "pointer-events-none w-full rounded-xl bg-ui-fill-subtle select-none",
                has_media ? MEDIA_ROW_HEIGHT_CLASS[size] : TEXT_ROW_HEIGHT_CLASS[size],
                className
            )}
        />
    )
}

export { ListRow, ListRowSkeleton }
