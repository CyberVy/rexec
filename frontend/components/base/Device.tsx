"use client"

import { useEffect, useState } from "react"
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

const Device = function Device({ className = "", ref, ...props }: DeviceProps) {
    const [ua, set_ua] = useState("")
    const [is_touch_device, set_is_touch_device] = useState(false)
    const [client_width, set_client_width] = useState(0)
    const [client_height, set_client_height] = useState(0)
    const [is_in_pwa, set_is_in_pwa] = useState(false)
    const [is_in_webview, set_is_in_webview] = useState(false)
    const [is_service_worker_available, set_is_service_worker_available] = useState(true)
    const [is_in_native, set_is_in_native] = useState(false)
    useEffect(() => {
        const sync_device_information = () => {
            set_client_width(document.documentElement.clientWidth)
            set_client_height(document.documentElement.clientHeight)
        }

        set_ua(navigator.userAgent)
        set_is_touch_device(_is_touch_device())
        sync_device_information()
        window.addEventListener("resize", sync_device_information)
        set_is_in_pwa(_is_in_pwa())
        set_is_in_webview(_is_in_webview())
        set_is_service_worker_available(_is_service_worker_available())
        set_is_in_native(_is_in_native())

        return () => {
            window.removeEventListener("resize", sync_device_information)
        }
    }, [])

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
