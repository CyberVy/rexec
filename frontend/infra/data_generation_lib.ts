import { is_in_dark } from "@/infra/device.client"

type PendingHtmlIcon = "search" | "loading" | "clipboard" | "chat" | "external_link" | "none"

type PendingHtmlOptions = {
    title: string
    message: string
    note?: string
    icon?: PendingHtmlIcon
}

export type CoverImageOptions = {
    width?: number
    height?: number
    background?: string
    color?: string
    fontSize?: number
    fontFamily?: string
}

export function generate_silent_wav_base64(duration_sec = 5, sample_rate = 8000) {
    const num_channels = 1
    const bits_per_sample = 16
    const byte_rate = (sample_rate * num_channels * bits_per_sample) / 8
    const block_align = (num_channels * bits_per_sample) / 8
    const num_samples = duration_sec * sample_rate
    const data_size = num_samples * block_align
    const total_size = 44 + data_size

    const array_buffer = new ArrayBuffer(total_size)
    const view = new DataView(array_buffer)

    const write_string = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i))
        }
    }

    // RIFF header
    write_string(0, "RIFF")
    view.setUint32(4, 36 + data_size, true)
    write_string(8, "WAVE")

    // fmt subchunk
    write_string(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, num_channels, true)
    view.setUint32(24, sample_rate, true)
    view.setUint32(28, byte_rate, true)
    view.setUint16(32, block_align, true)
    view.setUint16(34, bits_per_sample, true)

    // data subchunk
    write_string(36, "data")
    view.setUint32(40, data_size, true)

    // samples are all zero (silence)
    // ArrayBuffer is already zero-filled by default

    const bytes = new Uint8Array(array_buffer)
    let binary = ""
    const chunk_size = 0x8000
    for (let i = 0; i < bytes.length; i += chunk_size) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk_size))
    }

    return "data:audio/wav;base64," + btoa(binary)
}

function wrap_text_by_width(text: string, max_width: number, font_size: number): string[] {
    const lines: string[] = []
    let current_line = ""
    let current_width = 0

    for (const char of text) {
        // CJK/full-width characters are ~1.0 em, ASCII/half-width characters are ~0.55 em
        const char_width = char.charCodeAt(0) > 255 ? font_size : font_size * 0.55
        if (current_width + char_width > max_width && current_line !== "") {
            lines.push(current_line)
            current_line = char
            current_width = char_width
        } else {
            current_line += char
            current_width += char_width
        }
    }
    if (current_line) {
        lines.push(current_line)
    }
    return lines
}

export function generate_cover_svg(title: string, options: CoverImageOptions = {}): string {
    const {
        width = 768,
        height = 1024,
        background = "#222222",
        color = "#ffffff",
        fontSize = 48,
        fontFamily = "sans-serif"
    } = options

    const max_width = width * 0.85
    const lines = wrap_text_by_width(title, max_width, fontSize)
    const line_height = fontSize * 1.3
    const total_text_height = (lines.length - 1) * line_height
    const start_y = height / 2 - total_text_height / 2

    const tspans = lines
        .map((line, index) => {
            const y = start_y + index * line_height
            const safe_line = line
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&apos;")
            return `<tspan x="50%" y="${y}">${safe_line}</tspan>`
        })
        .join("")

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#000000" stroke-width="1"/><text text-anchor="middle" dominant-baseline="central" fill="${color}" font-size="${fontSize}" font-family="${fontFamily}">${tspans}</text></svg>`
}

export function generate_cover_svg_data_uri(title: string, options: CoverImageOptions = {}): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generate_cover_svg(title, options))}`
}

function escape_html(text: string) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}

function escape_html_with_line_break(text: string) {
    return escape_html(text).replaceAll("\n", "<br>")
}

function generate_pending_html_icon(icon: PendingHtmlIcon) {
    if (icon === "search") {
        return `
            <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" fill="none" />
                <path d="M15 15L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>`
    }
    if (icon === "clipboard") {
        return `
            <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="7" y="5" width="10" height="15" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none" />
                <path d="M9 5.5H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <rect x="9" y="2.5" width="6" height="4" rx="1.5" ry="1.5" stroke="currentColor" stroke-width="2" fill="none" />
            </svg>`
    }
    if (icon === "chat") {
        return `
            <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M6 18L4 20V6C4 4.9 4.9 4 6 4H18C19.1 4 20 4.9 20 6V16C20 17.1 19.1 18 18 18H6Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round" />
                <path d="M8 9H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <path d="M8 13H13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>`
    }
    if (icon === "external_link") {
        return `
            <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M14 5H19V10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                <path d="M19 5L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <path d="M19 13V18C19 19.1 18.1 20 17 20H6C4.9 20 4 19.1 4 18V7C4 5.9 4.9 5 6 5H11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
            </svg>`
    }
    if (icon === "none") {
        return ""
    }

    return `
        <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none" opacity="0.35" />
            <path d="M12 3A9 9 0 0 1 21 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
        </svg>`
}

export function generate_pending_html({ title, message, note = "", icon = "loading" }: PendingHtmlOptions) {
    const background_color = is_in_dark() ? "#000000" : "#FFFFFF"
    const text_color = is_in_dark() ? "#EEEEEE" : "#000000"
    const safe_title = escape_html(title)
    const safe_message = escape_html_with_line_break(message)
    const safe_note = escape_html_with_line_break(note)

    return `
        <!DOCTYPE html>
        <html style="background-color: ${background_color}; height: 100%; overscroll-behavior: none; overflow: hidden">
            <head>
                <title>${safe_title}</title>
                <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
            </head>
            <body style="background-color: ${background_color}; color: ${text_color}; overflow: auto">
                <div style="margin-top: 32px; margin-bottom: 8px; text-align: center;">
                    ${generate_pending_html_icon(icon)}
                </div>
                <div style="margin-top: 8px; margin-bottom: 8px; font-size: 20px; text-align: center;">
                    ${safe_message}
                </div>
                ${
                    note
                        ? `
                    <div style="text-align: center;">
                        <div style="padding: 8px 16px; border: 1px solid ${text_color}; border-radius: 16px; background-color: ${background_color}; opacity: 0.8; font-size: 18px;  display: inline-block">
                            ${safe_note}
                        </div>
                    </div>
                    `
                        : ""
                }
            </body>
        </html>`
}
