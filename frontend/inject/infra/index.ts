import { setup_tauri_popup_polyfill } from "./ipc/polyfill"

export default function inject() {
    setup_tauri_popup_polyfill()
}

export { execute_after_dom_content_loaded, append_style, safe_define_property } from "./utils"
export { setup_tauri_popup_polyfill } from "./ipc/polyfill"
export { install_xhr_interceptor } from "./net/xhr.inject"
export { install_fetch_interceptor } from "./net/fetch.inject"
