import { useLayoutEffect, useState, useEffect } from "react"
import { is_in_native } from "@/infra/device.client"
import { AnimatedGlowText } from "@/components"

// The WEB_URL with an "https" prefix is for native app to simulate a website environment
// for some 3rd-party services and service worker which require it.
const WEB_URL = import.meta.env.DEV ? "/" : import.meta.env.VITE_NATIVE_ENTRY_URL || "/"

export default function App() {
    const [in_native, set_in_native] = useState(true)

    useLayoutEffect(() => {
        if (is_in_native()) {
            const url = WEB_URL
            if (window.location.href === url) return

            location.replace(url)
        }
    }, [])
    useEffect(() => {
        set_in_native(is_in_native())
    }, [])
    return (
        <div className="fixed left-1/2 top-1/2 -translate-1/2">
            {!in_native ? (
                <div>
                    This path is only for native app to simulate a website environment for some 3rd-party services which
                    require it.
                </div>
            ) : (
                <div>
                    <AnimatedGlowText text={"Launching... >_"} className="select-none" />
                </div>
            )}
        </div>
    )
}
