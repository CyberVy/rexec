"use client"

import { HapticContainer } from "../feedback/HapticContainer"
import { join_classes } from "../utils"

import type { ComponentPropsWithRef } from "react"

export type ButtonVariant = "unstyled" | "primary" | "secondary" | "outline" | "ghost" | "destructive"
export type ButtonSize = "auto" | "xs" | "sm" | "md" | "icon"
export type ButtonShape = "none" | "rounded" | "pill"

export type ButtonProps = ComponentPropsWithRef<"button"> & {
    variant?: ButtonVariant
    size?: ButtonSize
    shape?: ButtonShape
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
    unstyled: "",
    primary: "bg-ui-fill-solid text-ui-label-inverse hover:opacity-90 disabled:opacity-45 disabled:pointer-events-none",
    secondary:
        "border border-ui-border bg-ui-fill-subtle text-ui-label hover:bg-ui-fill-hover disabled:opacity-45 disabled:pointer-events-none",
    outline:
        "border border-ui-border bg-transparent text-ui-label hover:bg-ui-fill-subtle disabled:opacity-45 disabled:pointer-events-none",
    ghost: "bg-transparent text-ui-label-secondary hover:bg-ui-fill-subtle hover:text-ui-label-strong disabled:opacity-35 disabled:pointer-events-none",
    destructive:
        "border border-ui-destructive/20 bg-transparent text-ui-destructive hover:bg-ui-destructive/10 disabled:opacity-45 disabled:pointer-events-none"
}

const SIZE_CLASS: Record<ButtonSize, string> = {
    auto: "",
    xs: "px-2.5 py-1 text-xs font-medium",
    sm: "px-3.5 py-1.5 text-xs font-semibold",
    md: "px-4 py-2 text-xs font-medium",
    icon: "size-8"
}

const SHAPE_CLASS: Record<ButtonShape, string> = {
    none: "",
    rounded: "rounded-xl",
    pill: "rounded-full"
}

/** Interactive button primitive with press feedback, iOS native switch haptics, and optional semantic variants. */
function Button({
    children,
    className,
    type = "button",
    variant = "unstyled",
    size = "auto",
    shape,
    ref,
    ...props
}: ButtonProps) {
    const resolved_shape = shape ?? (variant !== "unstyled" ? "rounded" : "none")

    return (
        <button
            {...props}
            type={type}
            ref={ref}
            className={join_classes(
                "inline-flex items-center justify-center cursor-pointer select-none transition active:scale-[0.97]",
                VARIANT_CLASS[variant],
                SIZE_CLASS[size],
                SHAPE_CLASS[resolved_shape],
                className
            )}
        >
            <HapticContainer disabled={props.disabled}>
                <div className="w-full h-full flex items-center justify-center">{children}</div>
            </HapticContainer>
        </button>
    )
}

export { Button }
