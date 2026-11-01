import type { RexecCaller } from "@rexec/caller/core"

export interface WorkspaceEntry {
    name: string
    path: string
    is_directory: boolean
    is_symlink: boolean
    size: number
    permissions: string
    mtime_label: string
}

export interface WorkspaceSnapshot {
    resolved_cwd: string
    entries: WorkspaceEntry[]
}

const LS_DELIMITER = "---REXEC_WORKSPACE_LS---"
const LS_LINE_REGEX =
    /^([bcdlfps-][rwxstST-]{9}[+@.]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Z][a-z]{2}\s+\d+\s+(?:\d+:\d+|\d{4}))\s+(.+)$/

export function parse_osc7_path(osc_data: string): string | null {
    const trimmed = osc_data.trim()
    if (!trimmed) return null

    if (trimmed.startsWith("file://")) {
        const without_scheme = trimmed.slice("file://".length)
        const slash_index = without_scheme.indexOf("/")
        if (slash_index === -1) return null
        const raw_path = without_scheme.slice(slash_index)
        try {
            return normalize_posix_path(decodeURIComponent(raw_path))
        } catch {
            return normalize_posix_path(raw_path)
        }
    }

    if (trimmed.startsWith("/")) {
        return normalize_posix_path(trimmed)
    }

    return null
}

export function normalize_posix_path(input_path: string): string {
    const collapsed = input_path.replace(/\/+/g, "/")
    if (collapsed.length > 1 && collapsed.endsWith("/")) {
        return collapsed.slice(0, -1)
    }
    return collapsed || "/"
}

export function join_posix_path(base_path: string, child_name: string): string {
    const normalized_base = normalize_posix_path(base_path)
    if (normalized_base === "/") {
        return `/${child_name}`
    }
    return `${normalized_base}/${child_name}`
}

export function resolve_parent_path(current_path: string): string {
    const normalized = normalize_posix_path(current_path)
    if (normalized === "/") return "/"
    const last_slash = normalized.lastIndexOf("/")
    if (last_slash <= 0) return "/"
    return normalized.slice(0, last_slash)
}

export function format_entry_size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export async function fetch_workspace_entries(
    caller: RexecCaller,
    target_cwd?: string,
    signal?: AbortSignal
): Promise<WorkspaceSnapshot> {
    let stdout_buffer = ""
    let stderr_buffer = ""

    const exit_code = await caller.exec(
        {
            cmd: `pwd && echo "${LS_DELIMITER}" && LC_ALL=C ls -lap`,
            cwd: target_cwd || undefined,
            signal
        },
        (stream, data) => {
            if (stream === "stdout") {
                stdout_buffer += data
            } else {
                stderr_buffer += data
            }
        }
    )

    if (exit_code !== 0 && !stdout_buffer.includes(LS_DELIMITER)) {
        throw new Error(stderr_buffer.trim() || `Failed to list directory (exit ${exit_code})`)
    }

    const parts = stdout_buffer.split(LS_DELIMITER)
    const raw_pwd = parts[0]?.trim().split(/\r?\n/).pop()?.trim() || target_cwd || "/"
    const resolved_cwd = normalize_posix_path(raw_pwd)
    const ls_output = parts[1] ?? ""

    const entries: WorkspaceEntry[] = []
    const lines = ls_output.split(/\r?\n/)

    for (const raw_line of lines) {
        const line = raw_line.trim()
        if (!line || line.startsWith("total ")) continue

        const match = LS_LINE_REGEX.exec(line)
        if (!match) continue

        const permissions = match[1] ?? ""
        const size = Number(match[2] ?? 0)
        const mtime_label = (match[3] ?? "").replace(/\s+/g, " ")
        let raw_name = match[4] ?? ""

        const is_symlink = permissions.startsWith("l")
        let is_directory = permissions.startsWith("d")

        if (is_symlink && raw_name.includes(" -> ")) {
            const [link_name, link_target] = raw_name.split(" -> ")
            raw_name = link_name ?? raw_name
            if (link_target?.endsWith("/")) {
                is_directory = true
            }
        }

        if (raw_name.endsWith("/")) {
            is_directory = true
            raw_name = raw_name.slice(0, -1)
        }

        if (!raw_name || raw_name === "." || raw_name === "..") continue

        entries.push({
            name: raw_name,
            path: join_posix_path(resolved_cwd, raw_name),
            is_directory,
            is_symlink,
            size,
            permissions: permissions.slice(0, 10),
            mtime_label
        })
    }

    entries.sort((a, b) => {
        if (a.is_directory !== b.is_directory) {
            return a.is_directory ? -1 : 1
        }
        return a.name.localeCompare(b.name)
    })

    return {
        resolved_cwd,
        entries
    }
}
