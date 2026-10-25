import type { ProgressInfo } from "@/caller"

export function format_bytes(bytes: number): string {
    if (bytes <= 0) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function render_progress(label: string, info: ProgressInfo): void {
    if (!process.stderr.isTTY) return
    const { transferred, total, speed } = info
    const speed_str = `${format_bytes(speed)}/s`

    if (total > 0) {
        const percent = Math.min(100, Math.floor((transferred / total) * 100))
        const bar_length = 20
        const filled = Math.min(bar_length, Math.floor((percent / 100) * bar_length))
        const bar =
            "=".repeat(filled) + (filled < bar_length ? ">" : "") + " ".repeat(Math.max(0, bar_length - filled - 1))
        process.stderr.write(
            `\r[rexec] ${label}: [${bar}] ${percent}% (${format_bytes(transferred)} / ${format_bytes(total)}) ${speed_str} `
        )
    } else {
        process.stderr.write(`\r[rexec] ${label}: ${format_bytes(transferred)} (${speed_str}) `)
    }
}
