"use client"

import version from "@/infra/version"
import { string_icons } from "@/components/ui_constants"
import { useState } from "react"
import { is_service_worker_available, service_worker_api_call, vibrate } from "@/infra"
import type { ReactNode } from "react"
import type { ComponentPropsWithRef } from "react"

export type VersionProps = Omit<ComponentPropsWithRef<"div">, "children">

const Version = function Version({ className = "", ref, ...props }: VersionProps) {
    const [cache_update_icon, set_cache_update_icon] = useState<ReactNode>(string_icons.reset)

    const handle_static_cache_update = () => {
        vibrate()
        if (!is_service_worker_available()) return
        set_cache_update_icon(string_icons.success)
        service_worker_api_call<void>({ type: "static_cache_update" })
            .then(() => setTimeout(() => set_cache_update_icon(string_icons.reset), 2000))
            .catch(() => set_cache_update_icon(string_icons.reset))
    }

    return (
        <div {...props} ref={ref} className={className}>
            <div className="flex items-center">
                <span className="text-xs">v{version}</span>
                <button
                    type="button"
                    className="ml-1 text-xs hover:cursor-pointer text-green-600 dark:text-green-300 rounded-md"
                    onClick={handle_static_cache_update}
                >
                    {cache_update_icon}
                </button>
            </div>
            <p className="text-xs">{`Built at: ${import.meta.env.VITE_BUILD_TIME}`}</p>
        </div>
    )
}

Version.displayName = "Version"

export { Version }
