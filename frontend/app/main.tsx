import { createRoot } from "react-dom/client"
import "./globals.css"
import App from "./App"

function mount() {
    const root_element = document.getElementById("root")
    if (root_element) {
        createRoot(root_element).render(<App />)
    }
}

if (navigator.serviceWorker && ["https:", "http"].includes(location.protocol)) {
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
