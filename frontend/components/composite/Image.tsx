"use client"

import { useEffect, useState } from "react"
import { generate_cover_svg_data_uri, is_ios_device } from "@/infra"
import { ContextMenu } from "@/components/composite/ContextMenuContainer"

import type { CoverImageOptions } from "@/infra"
import type { ContextMenuProps } from "@/components/composite/ContextMenuContainer"
import type { ComponentPropsWithRef } from "react"

export type ImageProps = Omit<ComponentPropsWithRef<"img">, "children" | "src"> & {
    src?: string
    image_proxy_api?: string
    fallback_title?: string
    fallback_src?: string
    context_menu?: Omit<ContextMenuProps, "children" | "disabled" | "on_click_trigger">
    generated_cover_options?: CoverImageOptions
}

const DEFAULT_BLANK_PLACEHOLDER =
    "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 768 1024'%3E%3Crect width='100%25' height='100%25' fill='%23222222'/%3E%3C/svg%3E"

function Image({
    src,
    image_proxy_api,
    fallback_title,
    fallback_src,
    context_menu,
    generated_cover_options,
    alt = "",
    className,
    onError,
    ref,
    ...props
}: ImageProps) {
    const [is_ios, set_is_ios] = useState(false)

    useEffect(() => {
        set_is_ios(is_ios_device())
    }, [])

    const get_fallback_url = () => {
        if (fallback_src) return fallback_src
        const title = fallback_title || alt
        if (title) {
            return generate_cover_svg_data_uri(title, generated_cover_options)
        }
        return DEFAULT_BLANK_PLACEHOLDER
    }

    const initial_url = src ? `${image_proxy_api || ""}${src}` : get_fallback_url()

    const handle_error = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const fallback = get_fallback_url()
        const img = e.currentTarget
        if (img.src !== fallback) {
            img.src = fallback
        }
        onError?.(e)
    }

    const image = (
        <img
            {...props}
            ref={ref}
            src={initial_url}
            alt={alt}
            onError={handle_error}
            className={["[-webkit-touch-callout:none]", is_ios ? "[-webkit-user-drag:none]" : "", className]
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
