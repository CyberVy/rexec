import * as fs from "node:fs"
import * as path from "node:path"

export function parse_env_file(content: string): Record<string, string> {
    const env: Record<string, string> = {}
    const lines = content.split("\n")

    for (const raw_line of lines) {
        const line = raw_line.trim()
        if (!line || line.startsWith("#")) {
            continue
        }

        const clean_line = line.startsWith("export ") ? line.slice(7).trim() : line
        const eq_index = clean_line.indexOf("=")
        if (eq_index <= 0) {
            continue
        }

        const key = clean_line.slice(0, eq_index).trim()
        let value = clean_line.slice(eq_index + 1).trim()

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }

        if (key) {
            env[key] = value
        }
    }

    return env
}

export function detect_env_from_workspace(root_paths: string[]): { hub_url?: string; token?: string } {
    let hub_url = process.env.REXEC_HUB?.trim() || undefined
    let token = process.env.REXEC_TOKEN?.trim() || undefined

    if (hub_url && token) {
        return { hub_url, token }
    }

    for (const root_dir of root_paths) {
        const env_path = path.join(root_dir, ".env")
        if (fs.existsSync(env_path)) {
            try {
                const content = fs.readFileSync(env_path, "utf-8")
                const parsed = parse_env_file(content)
                if (!hub_url && parsed.REXEC_HUB) {
                    hub_url = parsed.REXEC_HUB.trim()
                }
                if (!token && parsed.REXEC_TOKEN) {
                    token = parsed.REXEC_TOKEN.trim()
                }
            } catch {
                // Ignore file read errors
            }
        }
        if (hub_url && token) {
            break
        }
    }

    return { hub_url, token }
}
