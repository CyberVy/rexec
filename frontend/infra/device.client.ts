export function is_apple_device() {
    if (typeof window === "undefined") {
        return false
    }
    const user_agent = navigator.userAgent.toLowerCase()
    return user_agent.includes("iphone") || user_agent.includes("ipad") || user_agent.includes("macintosh")
}

export function is_touch_device() {
    if (typeof window === "undefined") {
        return false
    }
    return "ontouchend" in document || navigator.maxTouchPoints > 0
}

export function is_ios_device() {
    return is_apple_device() && is_touch_device()
}

export function is_ios_desktop_device() {
    const user_agent = navigator.userAgent.toLowerCase()
    return user_agent.includes("macintosh") && is_ios_device()
}

export function is_android_device() {
    const user_agent = navigator.userAgent.toLowerCase()
    return user_agent.includes("android") && is_touch_device()
}

export function is_iphone() {
    const user_agent = navigator.userAgent.toLowerCase()
    return user_agent.includes("iphone")
}

export function is_mac() {
    return is_apple_device() && !is_touch_device()
}

export function is_ipad() {
    if (typeof window === "undefined") {
        return false
    }
    return (
        navigator.userAgent.toLowerCase().includes("ipad") ||
        (navigator.userAgent.toLowerCase().includes("macintosh") && is_touch_device())
    )
}

export function is_in_pwa() {
    if (typeof window === "undefined") {
        return false
    }
    // Chrome can install a non-PWA as a PWA with display-mode: minimal-ui,
    // and this function also regards it as a PWA
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: minimal-ui)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches
    )
}

export function is_in_webview() {
    if (typeof window === "undefined") {
        return false
    }
    return Boolean(window.webkit && window.webkit.messageHandlers)
}

export function is_in_native() {
    if (typeof window === "undefined") {
        return false
    }
    return Boolean(window.__TAURI__)
}

export function is_in_browser() {
    if (typeof window === "undefined") {
        return false
    }
    return !is_in_native() && !is_in_pwa()
}

export function is_service_worker_available() {
    if (typeof window === "undefined") {
        return false
    }
    return Boolean(navigator.serviceWorker?.controller)
}

export function is_in_background() {
    if (typeof window === "undefined") {
        return false
    }
    return document.visibilityState === "hidden"
}

export function is_viewport_portrait() {
    if (typeof window === "undefined") {
        return false
    }
    const height = document.documentElement.clientHeight
    const width = document.documentElement.clientWidth
    return height > width
}

export function is_in_dark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
}

let _ios_haptics_label_element: HTMLLabelElement | null = null
function create_ios_haptics_label_element() {
    if (_ios_haptics_label_element) return _ios_haptics_label_element

    const label_element = document.createElement("label")
    label_element.style.display = "none"
    const input_element = document.createElement("input")
    input_element.type = "checkbox"
    input_element.setAttribute("switch", "")
    label_element.appendChild(input_element)
    _ios_haptics_label_element = label_element
    return label_element
}

// This browser-side workaround is only reliable after a completed tap-like gesture.
// Early gesture phases such as touchstart/pointerdown usually cannot trigger it on iOS.
// warning: available for iOS 18 - iOS 26.0
export function ios_haptic() {
    if (!is_ios_device()) return

    const label_element = create_ios_haptics_label_element()
    document.head.appendChild(label_element)
    try {
        label_element.click()
        document.head.removeChild(label_element)
    } catch {}
}

export function vibrate() {
    if (is_ios_device()) {
        ios_haptic()
    } else if (navigator.vibrate) {
        navigator.vibrate(50)
    }
}

// Keep a loading placeholder in the popup before navigating to target URL.
type OpenUrlOptions = {
    dom_string?: string
    on_close?: () => void
    keep_gesture?: boolean
}

export function open_url(url: string, target: "_self" | "_blank" | string, options?: OpenUrlOptions) {
    if (typeof window === "undefined") {
        return
    }
    if (target === "_self") {
        return window.open(url, "_self")
    }

    let dom_string = options?.dom_string || ""
    const on_close = options?.on_close
    const keep_gesture = options?.keep_gesture || false

    const new_window = window.open(url, target, "popup")
    if (!new_window) return

    if (!dom_string) {
        if (is_in_dark()) {
            dom_string = `<body style="background-color: black;"></body>`
        } else {
            dom_string = `<body style="background-color: white;"></body>`
        }
    }
    try {
        new_window.document.documentElement.innerHTML = dom_string
        new_window.document.documentElement.style.overscrollBehavior = "none"
        new_window.document.documentElement.style.overflow = "hidden"
    } catch {}

    if (!keep_gesture) {
        if (!on_close) return new_window

        if (!is_ios_device()) {
            const callback = () => {
                if (new_window.closed) {
                    window.removeEventListener("focus", callback)
                    on_close()
                }
            }
            window.addEventListener("focus", callback)
        }
        // the focus event will be triggered instantly after opening a new window on iOS
        else {
            setTimeout(() => window.addEventListener("focus", on_close, { once: true }), 17)
        }
    } else {
        if (!on_close) return new_window
        // setInterval can keep the gesture
        const i = window.setInterval(() => {
            if (new_window.closed) {
                clearInterval(i)
                on_close()
            }
        }, 167)
    }

    return new_window
}
