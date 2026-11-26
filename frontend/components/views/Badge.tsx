"use client"

import { join_classes } from "../utils"

import type { ComponentPropsWithRef } from "react"

export type BadgeProps = ComponentPropsWithRef<"span"> & {
    tone?: "overlay" | "subtle" | "solid" | "custom"
    shape?: "rounded" | "pill"
    mono?: boolean
}

const TONE_CLASS: Record<NonNullable<BadgeProps["tone"]>, string> = {
    overlay: "bg-ui-scrim-strong text-ui-label-overlay",
    subtle: "bg-ui-fill-subtle text-ui-label-secondary",
    solid: "bg-ui-fill-solid text-ui-label-inverse",
    custom: ""
}

/** Compact label chip. The custom tone adds no colors, so the caller supplies them through className. */
function Badge({ tone = "overlay", shape = "rounded", mono = false, className, children, ref, ...props }: BadgeProps) {
    return (
        <span
            {...props}
            ref={ref}
            className={join_classes(
                "inline-flex shrink-0 items-center px-1.5 py-0.5 text-[10px] font-medium",
                shape === "pill" ? "rounded-full" : "rounded-md",
                mono && "font-mono",
                TONE_CLASS[tone],
                className
            )}
        >
            {children}
        </span>
    )
}

export { Badge }
