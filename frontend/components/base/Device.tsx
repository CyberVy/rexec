"use client"

import { useSyncExternalStore } from "react"
import {
    is_in_pwa as _is_in_pwa,
    is_touch_device as _is_touch_device,
    is_in_webview as _is_in_webview,
    is_service_worker_available as _is_service_worker_available,
    is_in_native as _is_in_native
} from "@/infra/device.client"
import { string_icons } from "@/components/ui_constants"

import type { ComponentPropsWithRef } from "react"

type DeviceProps = Omit<ComponentPropsWithRef<"div">, "children">

const subscribe_resize = (callback: () => void) => {
    window.addEventListener("resize", callback)
    return () => window.removeEventListener("resize", callback)
}

const get_client_width = () => (typeof document !== "undefined" ? document.documentElement.clientWidth : 0)
const get_client_height = () => (typeof document !== "undefined" ? document.documentElement.clientHeight : 0)

const Device = function Device({ className = "", ref, ...props }: DeviceProps) {
    const client_width = useSyncExternalStore(subscribe_resize, get_client_width, () => 0)
    const client_height = useSyncExternalStore(subscribe_resize, get_client_height, () => 0)

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : ""
    const is_touch_device = _is_touch_device()
    const is_in_pwa = _is_in_pwa()
    const is_in_webview = _is_in_webview()
    const is_service_worker_available = _is_service_worker_available()
    const is_in_native = _is_in_native()

    return (
        <div {...props} ref={ref} className={["text-xs select-text", className].filter(Boolean).join(" ")}>
            <p>{`UA: ${ua}`}</p>
            <p>{`Width: ${client_width}, Height: ${client_height}`}</p>
            <p>{`Mobile Device: ${is_touch_device ? string_icons.true : string_icons.false}`}</p>
            <p>{`PWA: ${is_in_pwa ? string_icons.true : string_icons.false}`}</p>
            <p>{`Webview: ${is_in_webview ? string_icons.true : string_icons.false}`}</p>
            <p>{`Service Worker Available: ${is_service_worker_available ? string_icons.true : string_icons.false}`}</p>
            <p>{`Native: ${is_in_native ? string_icons.true : string_icons.false}`}</p>
        </div>
    )
}

Device.displayName = "Device"

export { Device }
