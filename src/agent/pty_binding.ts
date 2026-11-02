import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const NODE_PTY_VERSION = "1.2.0-beta.17"

/** Served from `vendor/node-pty/<version>` via the Hub static asset `/install/pty/<version>`. */

interface PtyAsset {
    name: string
    sha256: string
}

const PTY_ASSETS: Record<string, PtyAsset[]> = {
    "linux-x64": [{ name: "pty.node", sha256: "rfUHJ9VXu25uzSqGV/N1gQdXbm/0Q9s/WUtOEzDzowU=" }],
    "linux-arm64": [{ name: "pty.node", sha256: "OP7q4EClNoutwMAST9rq206tnce7/ZENhXZf/mThAus=" }],
    "darwin-x64": [
        { name: "pty.node", sha256: "P/YRJExuzYmInQdIq7+2T1AsK56ObPTMEYF0shoxhkE=" },
        { name: "spawn-helper", sha256: "AiHd8w0aDCAWHPiQ90EKG3e9YOHPmZeHW6EKfk/pxRU=" }
    ],
    "darwin-arm64": [
        { name: "pty.node", sha256: "DzHHHQqlZQa6v4GsxFEaknykRe5l7EpdeHN10aolV7g=" },
        { name: "spawn-helper", sha256: "wW/kADA9/G+bTZeVE8qS6FFlAzwgV8DqNjYC7gtOdWk=" }
    ],
    "win32-x64": [
        { name: "conpty.node", sha256: "UGWsvGkX4MSJy1G99S7bYlJC5ea6B81BQjGPM13FlRQ=" },
        { name: "conpty/conpty.dll", sha256: "Mxm0hLgLtT0fTQqesOpg/Q9h2mnbcoDKQ7hCFfGSRf8=" },
        { name: "conpty/OpenConsole.exe", sha256: "f2jIQCJlBQBCFcC4LU5QLCS1vD9Lk8S6qqGb1nnA3vg=" }
    ],
    "win32-arm64": [
        { name: "conpty.node", sha256: "JN9XvN8/CwAvYUYbvz7oYBtTedVyw78JHQHJeBswoRc=" },
        { name: "conpty/conpty.dll", sha256: "s6n5dcUdW5uW0pC/eE6ZDj+FIDsGPCFhRFc1P1ZiZv8=" },
        { name: "conpty/OpenConsole.exe", sha256: "f6VgvgybbIHbXRuFWkpuDz7loup1027rs65ERDuNSGY=" }
    ]
}

export interface PtyForkResult {
    fd: number
    pid: number
    pty: string
}

export interface PtyNative {
    fork: (
        file: string,
        args: string[],
        env: string[],
        cwd: string,
        cols: number,
        rows: number,
        uid: number,
        gid: number,
        utf8: boolean,
        helper_path: string,
        on_exit: (code: number, signal: number) => void
    ) => PtyForkResult
    resize: (fd: number, cols: number, rows: number, x_pixel: number, y_pixel: number) => void
}

export interface ConptyStartResult {
    pty: number
    fd: number
    conin: string
    conout: string
}

/** Native API of `conpty.node` from node-pty 1.2.0-beta.17. */
export interface ConptyNative {
    startProcess: (
        file: string,
        cols: number,
        rows: number,
        debug: boolean,
        pipe_name: string,
        inherit_cursor: boolean,
        use_conpty_dll: boolean
    ) => ConptyStartResult
    connect: (
        id: number,
        command_line: string,
        cwd: string,
        env: string[],
        use_conpty_dll: boolean,
        on_exit: (code: number) => void
    ) => { pid: number }
    resize: (id: number, cols: number, rows: number, use_conpty_dll: boolean) => void
    kill: (id: number, use_conpty_dll: boolean) => void
}

export interface PtyBinding {
    native: PtyNative | null
    conpty: ConptyNative | null
    helper_path: string
}

let loading: Promise<PtyBinding> | null = null

export function load_pty_binding(hub_url: string): Promise<PtyBinding> {
    loading ??= fetch_binding(hub_url).catch((err) => {
        loading = null
        throw err
    })
    return loading
}

function pty_base_url(hub_url: string): string {
    const override = process.env.REXEC_PTY_BASE_URL?.trim()
    if (override) return override.replace(/\/$/, "")

    let http_url = hub_url.trim()
    if (http_url.startsWith("wss://")) {
        http_url = "https://" + http_url.slice(6)
    } else if (http_url.startsWith("ws://")) {
        http_url = "http://" + http_url.slice(5)
    } else if (!http_url.startsWith("https://") && !http_url.startsWith("http://")) {
        http_url = "https://" + http_url
    }

    const url = new URL(http_url)
    url.pathname = `/install/pty/${NODE_PTY_VERSION}`
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
}

async function fetch_binding(hub_url: string): Promise<PtyBinding> {
    const platform_key = `${process.platform}-${process.arch}`
    const assets = PTY_ASSETS[platform_key]
    if (!assets) {
        throw new Error(
            `PTY sessions are available on Linux, macOS, and Windows (x64 and arm64). This agent is ${platform_key}.`
        )
    }

    const cache_dir =
        process.env.REXEC_PTY_CACHE?.trim() ||
        path.join(os.homedir(), ".cache", "rexec", "node-pty", NODE_PTY_VERSION, platform_key)
    fs.mkdirSync(cache_dir, { recursive: true })

    const base_url = pty_base_url(hub_url)
    for (const asset of assets) {
        const dest = path.join(cache_dir, asset.name)
        await ensure_asset(`${base_url}/${platform_key}/${asset.name}`, dest, asset.sha256)
        if (asset.name === "spawn-helper") {
            fs.chmodSync(dest, 0o755)
        }
    }

    const require = createRequire(import.meta.url)
    if (process.platform === "win32") {
        const conpty = require(path.join(cache_dir, "conpty.node")) as ConptyNative
        return { native: null, conpty, helper_path: "" }
    }

    const native = require(path.join(cache_dir, "pty.node")) as PtyNative
    const helper_path = path.join(cache_dir, "spawn-helper")
    return {
        native,
        conpty: null,
        helper_path: fs.existsSync(helper_path) ? helper_path : "spawn-helper"
    }
}

async function ensure_asset(url: string, dest: string, sha256: string): Promise<void> {
    if (fs.existsSync(dest) && hash_file(dest) === sha256) {
        return
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true })
    console.log(`[rexec-agent] Downloading PTY binding ${path.basename(dest)}`)
    const res = await fetch(url)
    if (!res.ok) {
        throw new Error(`Failed to download PTY binding ${url}: HTTP ${res.status}`)
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    const digest = crypto.createHash("sha256").update(bytes).digest("base64")
    if (digest !== sha256) {
        throw new Error(`PTY binding hash mismatch for ${path.basename(dest)}`)
    }

    const tmp = `${dest}.${process.pid}.tmp`
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, dest)
}

function hash_file(file_path: string): string {
    const bytes = fs.readFileSync(file_path)
    return crypto.createHash("sha256").update(bytes).digest("base64")
}
