import { is_ios_device, is_android_device } from "./device.client"
import { create_logger } from "./logger"

const logger = create_logger("FileClient")

export type SaveFileResult = {
    success: boolean
    method?: "picker" | "share" | "download"
    error?: string
}

/**
 * Save text content to a user-chosen file via Web Share API (mobile),
 * File System Access API (desktop), or anchor download fallback.
 */
export async function save_text_file(
    filename: string,
    content: string,
    mime_type = "application/json"
): Promise<SaveFileResult> {
    try {
        const is_mobile = is_ios_device() || is_android_device()

        if (is_mobile) {
            if (navigator.share) {
                try {
                    const file = new File([content], filename, { type: mime_type })
                    if (navigator.canShare?.({ files: [file] })) {
                        await navigator.share({ files: [file] })
                        return { success: true, method: "share" }
                    }
                } catch (share_err) {
                    if (share_err instanceof Error && share_err.name === "AbortError") {
                        return { success: false }
                    }
                    logger.warn("navigator.share failed, falling back to download", { error: share_err })
                }
            }
        } else if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types:
                        mime_type === "application/json"
                            ? [{ description: "JSON Files", accept: { "application/json": [".json"] } }]
                            : undefined
                })
                const writable = await handle.createWritable()
                await writable.write(content)
                await writable.close()
                return { success: true, method: "picker" }
            } catch (picker_err) {
                if (picker_err instanceof Error && picker_err.name === "AbortError") {
                    return { success: false }
                }
                logger.warn("showSaveFilePicker failed, falling back to download", { error: picker_err })
            }
        }

        const blob = new Blob([content], { type: mime_type })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        return { success: true, method: "download" }
    } catch (err) {
        logger.error("Failed to save file", err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
}

/**
 * Prompt the user to select a local text file and read its contents.
 * Returns null if the user cancels selection or reading fails.
 */
export function read_text_file(accept = ".json"): Promise<string | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = accept

        let settled = false
        let focus_timer: number | null = null

        const finish = (result: string | null) => {
            if (settled) return
            settled = true
            if (focus_timer !== null) {
                window.clearTimeout(focus_timer)
                focus_timer = null
            }
            window.removeEventListener("focus", handle_window_focus)
            resolve(result)
        }

        // Fallback for older browsers/WebViews that do not emit the input `cancel` event.
        const handle_window_focus = () => {
            if (focus_timer !== null) window.clearTimeout(focus_timer)
            focus_timer = window.setTimeout(() => {
                if (!input.files?.length) {
                    finish(null)
                }
            }, 300)
        }

        input.addEventListener("cancel", () => finish(null), { once: true })
        input.addEventListener(
            "change",
            () => {
                const file = input.files?.[0]
                if (!file) {
                    finish(null)
                    return
                }
                const reader = new FileReader()
                reader.onload = (event) => {
                    finish(typeof event.target?.result === "string" ? event.target.result : null)
                }
                reader.onerror = () => finish(null)
                reader.readAsText(file)
            },
            { once: true }
        )

        window.addEventListener("focus", handle_window_focus)
        input.click()
    })
}
