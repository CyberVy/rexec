import { createRoot } from "react-dom/client"
import "../globals.css"
import App from "./App"

const root_element = document.getElementById("root")
if (root_element) {
    createRoot(root_element).render(<App />)
}
