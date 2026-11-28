import { createRoot } from "react-dom/client"
import "./globals.css"
import App from "./App"
import { is_in_native } from "@/infra/device"
import { register_runtime_inject_script } from "@/infra/runtime_inject"

async function init_runtime_inject(): Promise<void> {
    if (!is_in_native()) return
    try {
        const { default: script } = await import("virtual:inject-core")
        await register_runtime_inject_script(script)
    } catch (err) {
        console.warn("Failed to load runtime inject bundle", err)
    }
}

function mount() {
    void init_runtime_inject().finally(() => {
        const root_element = document.getElementById("root")
        if (root_element) {
            createRoot(root_element).render(<App />)
        }
    })
}

function bootstrap() {
    const native_entry_url = import.meta.env.VITE_NATIVE_ENTRY_URL
    if (!import.meta.env.DEV && is_in_native() && native_entry_url) {
        try {
            if (window.location.origin !== new URL(native_entry_url).origin) {
                location.replace(native_entry_url)
                return
            }
        } catch {
            // Invalid URL, continue normal bootstrap
        }
    }

    if (navigator.serviceWorker && ["https:", "http:"].includes(location.protocol)) {
        navigator.serviceWorker
            .register("/sw.js")
            .then(() => {
                console.log("Service worker is registered successfully.")
            })
            .catch((err) => {
                console.error("Failed to register Service worker.", err)
            })

        navigator.serviceWorker.ready.then(() => {
            mount()
        })
    } else {
        mount()
    }
}

bootstrap()
