import { consola } from "consola"

const logger = consola.withTag("RuntimeInject")

export async function register_runtime_inject_script(script: string): Promise<void> {
    const invoke = typeof window !== "undefined" ? window.__TAURI__?.core?.invoke : undefined
    if (!invoke) return

    try {
        await invoke("set_runtime_inject_script", { script })
    } catch (err) {
        logger.warn("Failed to register runtime inject script", err)
    }
}
