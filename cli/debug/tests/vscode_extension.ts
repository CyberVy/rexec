import assert from "node:assert"
import fs from "node:fs"
import http from "node:http"
import Module from "node:module"
import os from "node:os"
import path from "node:path"
import type * as vscode from "vscode"
import { detect_env_from_workspace, parse_env_file } from "../../../extensions/vscode/src/env"
import { H2StatusClient } from "../../../extensions/vscode/src/h2_client"

// Mock vscode module for headless testing
const original_load = (Module as unknown as { _load: (req: string, parent: unknown, is_main: boolean) => unknown })
    ._load
;(Module as unknown as { _load: (req: string, parent: unknown, is_main: boolean) => unknown })._load = function (
    request: string,
    parent: unknown,
    is_main: boolean
) {
    if (request === "vscode") {
        return {
            EventEmitter: class<T> {
                private listeners: ((e: T) => void)[] = []
                public event = (l: (e: T) => void) => {
                    this.listeners.push(l)
                    return { dispose: () => {} }
                }
                public fire(e: T) {
                    for (const l of this.listeners) l(e)
                }
                public dispose() {
                    this.listeners = []
                }
            },
            workspace: {
                workspaceFolders: [],
                getConfiguration: () => ({ get: () => undefined })
            }
        }
    }
    return original_load.apply(this, [request, parent, is_main])
}

async function test_parse_env_file(): Promise<void> {
    const raw = `
# Comment
REXEC_HUB=https://example.com:8787
export REXEC_TOKEN="my_secret_token"
ANOTHER_VAR='single_quoted'
EMPTY_VAL=
`
    const parsed = parse_env_file(raw)
    assert.strictEqual(parsed.REXEC_HUB, "https://example.com:8787")
    assert.strictEqual(parsed.REXEC_TOKEN, "my_secret_token")
    assert.strictEqual(parsed.ANOTHER_VAR, "single_quoted")
    assert.strictEqual(parsed.EMPTY_VAL, "")
    assert.strictEqual(parsed["# Comment"], undefined)
}

async function test_detect_env_from_workspace(): Promise<void> {
    const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "rexec-test-env-"))
    try {
        const env_file = path.join(tmp_dir, ".env")
        fs.writeFileSync(env_file, "REXEC_HUB=http://127.0.0.1:9999\nREXEC_TOKEN=token_from_env_file\n", "utf-8")

        const orig_hub = process.env.REXEC_HUB
        const orig_token = process.env.REXEC_TOKEN
        delete process.env.REXEC_HUB
        delete process.env.REXEC_TOKEN

        try {
            const detected = detect_env_from_workspace([tmp_dir])
            assert.strictEqual(detected.hub_url, "http://127.0.0.1:9999")
            assert.strictEqual(detected.token, "token_from_env_file")
        } finally {
            if (orig_hub !== undefined) process.env.REXEC_HUB = orig_hub
            if (orig_token !== undefined) process.env.REXEC_TOKEN = orig_token
        }
    } finally {
        fs.rmSync(tmp_dir, { recursive: true, force: true })
    }
}

async function test_extension_bundle(): Promise<void> {
    const bundle_path = path.resolve("extensions/vscode/dist/extension.js")
    assert.ok(fs.existsSync(bundle_path), "Extension bundle dist/extension.js should exist")

    const stat = fs.statSync(bundle_path)
    assert.ok(stat.size > 1000, "Bundle size should be non-trivial")
    assert.ok(stat.size < 500 * 1024, "Bundle size should be lightweight (<500KB)")

    const content = fs.readFileSync(bundle_path, "utf-8")
    assert.ok(content.includes("activate"), "Bundle must export or contain activate")
    assert.ok(content.includes("deactivate"), "Bundle must export or contain deactivate")
}

async function test_h2_client_fallback(): Promise<void> {
    const server = http.createServer((req, res) => {
        assert.ok(req.url?.startsWith("/health"))
        assert.strictEqual(req.headers.authorization, "Bearer test-token")
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", agent_connected: true, node_id: "mock-node" }))
    })

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const addr = server.address() as { port: number }
    const hub_url = `http://127.0.0.1:${addr.port}`

    const client = new H2StatusClient()
    try {
        const res = await client.get_status(hub_url, "test-token")
        assert.strictEqual(res.status, "ok")
        assert.strictEqual(res.agent_connected, true)
        assert.strictEqual(res.node_id, "mock-node")
    } finally {
        client.dispose()
        server.close()
    }
}

async function test_server_manager(): Promise<void> {
    const { ServerManager } = await import("../../../extensions/vscode/src/server_manager")

    const global_storage = new Map<string, unknown>()
    const workspace_storage = new Map<string, unknown>()

    const mock_context = {
        globalState: {
            get: <T>(key: string) => global_storage.get(key) as T,
            update: async (key: string, value: unknown) => {
                global_storage.set(key, value)
            }
        },
        workspaceState: {
            get: <T>(key: string) => workspace_storage.get(key) as T,
            update: async (key: string, value: unknown) => {
                workspace_storage.set(key, value)
            }
        }
    } as unknown as vscode.ExtensionContext

    const manager = new ServerManager(mock_context)
    assert.strictEqual(manager.get_servers().length, 0)
    assert.strictEqual(manager.get_active_server(), null)

    const s1 = await manager.add_server("Colab GPU", "https://hub.example.com", "token123")
    assert.strictEqual(manager.get_servers().length, 1)
    assert.strictEqual(manager.get_active_server()?.id, s1.id)
    assert.strictEqual(manager.get_active_server()?.name, "Colab GPU")

    const s2 = await manager.add_server("AWS H100", "https://aws.example.com", "token456")
    assert.strictEqual(manager.get_servers().length, 2)
    assert.strictEqual(manager.get_active_server()?.id, s2.id)

    await manager.set_active_server(s1.id)
    assert.strictEqual(manager.get_active_server()?.id, s1.id)

    await manager.remove_server(s1.id)
    assert.strictEqual(manager.get_servers().length, 1)
    assert.strictEqual(manager.get_active_server()?.id, s2.id)

    manager.dispose()
}

async function run(): Promise<void> {
    console.log("--- Running suite: vscode_extension.ts ---")
    await test_parse_env_file()
    console.log("[PASS] test:vscode_env_parser")
    await test_detect_env_from_workspace()
    console.log("[PASS] test:vscode_detect_workspace_env")
    await test_extension_bundle()
    console.log("[PASS] test:vscode_bundle_integrity")
    await test_h2_client_fallback()
    console.log("[PASS] test:vscode_h2_client_fallback")
    await test_server_manager()
    console.log("[PASS] test:vscode_server_manager")
}

run().catch((err) => {
    console.error("[FAIL] vscode_extension test failed:", err)
    process.exit(1)
})
