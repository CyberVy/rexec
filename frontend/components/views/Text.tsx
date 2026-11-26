"use client"

import { join_classes } from "../utils"

import type { ComponentPropsWithRef, ElementType } from "react"

export type TextVariant = "title" | "headline" | "body" | "callout" | "caption" | "footnote" | "overline"
export type TextTone = "primary" | "secondary" | "tertiary" | "destructive" | "inherit"
export type TextWeight = "normal" | "medium" | "semibold" | "bold"
export type TextAlign = "left" | "center" | "right"
export type TextElement = "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "label"

export type TextProps<T extends TextElement = "span"> = {
    as?: T
    variant?: TextVariant
    tone?: TextTone
    weight?: TextWeight
    mono?: boolean
    truncate?: boolean
    lines?: 1 | 2 | 3
    align?: TextAlign
    className?: string
} & Omit<ComponentPropsWithRef<T>, "as" | "className">

const VARIANT_BASE_CLASS: Record<TextVariant, string> = {
    title: "text-lg tracking-tight leading-snug",
    headline: "text-base tracking-tight leading-snug",
    body: "text-sm leading-normal",
    callout: "text-[13px] leading-tight",
    caption: "text-xs leading-normal",
    footnote: "text-[11px] leading-snug",
    overline: "text-[10px] uppercase tracking-wider leading-tight"
}

const VARIANT_DEFAULT_WEIGHT: Record<TextVariant, TextWeight> = {
    title: "bold",
    headline: "semibold",
    body: "normal",
    callout: "medium",
    caption: "normal",
    footnote: "normal",
    overline: "semibold"
}

const WEIGHT_CLASS: Record<TextWeight, string> = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold"
}

const TONE_CLASS: Record<TextTone, string> = {
    primary: "text-ui-label",
    secondary: "text-ui-label-secondary",
    tertiary: "text-ui-label-tertiary",
    destructive: "text-ui-destructive",
    inherit: ""
}

const LINES_CLASS: Record<1 | 2 | 3, string> = {
    1: "line-clamp-1",
    2: "line-clamp-2",
    3: "line-clamp-3"
}

const ALIGN_CLASS: Record<TextAlign, string> = {
    left: "text-left",
    center: "text-center",
    right: "text-right"
}

/** Semantic typography primitive mapping UIKit-style text roles, tones, and truncation rules onto design tokens. */
function Text<T extends TextElement = "span">({
    as,
    variant = "body",
    tone = "primary",
    weight,
    mono = false,
    truncate = false,
    lines,
    align,
    className,
    ...props
}: TextProps<T>) {
    const Component = (as ?? "span") as ElementType
    const resolved_weight = weight ?? VARIANT_DEFAULT_WEIGHT[variant]

    return (
        <Component
            {...props}
            className={join_classes(
                VARIANT_BASE_CLASS[variant],
                WEIGHT_CLASS[resolved_weight],
                TONE_CLASS[tone],
                mono && "font-mono tabular-nums",
                lines ? LINES_CLASS[lines] : truncate && "min-w-0 truncate",
                align && ALIGN_CLASS[align],
                className
            )}
        />
    )
}

export { Text }
