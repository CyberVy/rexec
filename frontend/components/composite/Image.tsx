"use client"

import { useState } from "react"
import { generate_cover_svg_data_uri, is_ios_device } from "@/infra"
import { ContextMenu } from "@/components/composite/ContextMenuContainer"

import type { CoverImageOptions } from "@/infra"
import type { ContextMenuProps } from "@/components/composite/ContextMenuContainer"
import type { ComponentPropsWithRef } from "react"

export type ImageProps = Omit<ComponentPropsWithRef<"img">, "children" | "src"> & {
    src?: string
    fallback_title?: string
    cover_options?: CoverImageOptions
    context_menu?: Omit<ContextMenuProps, "children" | "disabled" | "on_click_trigger">
}

const DEFAULT_BLANK_PLACEHOLDER =
    "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 768 1024'%3E%3Crect width='100%25' height='100%25' fill='%23222222'/%3E%3C/svg%3E"

const IS_IOS_DEVICE = typeof window !== "undefined" && is_ios_device()

function Image({
    src,
    fallback_title,
    cover_options,
    context_menu,
    alt = "",
    className,
    onError,
    ref,
    ...props
}: ImageProps) {
    const [failed_src, set_failed_src] = useState<string | null>(null)

    const is_fallback = !src || failed_src === src
    const title = fallback_title || alt
    const display_src = is_fallback
        ? title
            ? generate_cover_svg_data_uri(title, cover_options)
            : DEFAULT_BLANK_PLACEHOLDER
        : src

    const handle_error = (e: React.SyntheticEvent<HTMLImageElement>) => {
        if (src && failed_src !== src) {
            set_failed_src(src)
        }
        onError?.(e)
    }

    const image = (
        <img
            {...props}
            ref={ref}
            src={display_src}
            alt={alt}
            onError={handle_error}
            className={["[-webkit-touch-callout:none]", IS_IOS_DEVICE ? "[-webkit-user-drag:none]" : "", className]
                .filter(Boolean)
                .join(" ")}
        />
    )

    if (!context_menu) {
        return image
    }

    return <ContextMenu {...context_menu}>{image}</ContextMenu>
}

export { Image }
