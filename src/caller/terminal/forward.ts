import net from "node:net"
import type { RexecCaller } from "@/caller"
import { format_bytes } from "./ui"

export interface ForwardOptions {
    signal?: AbortSignal
}

export async function run_port_forward(
    caller: RexecCaller,
    local_port: number,
    remote_port: number,
    options?: ForwardOptions
): Promise<void> {
    console.log(`[rexec forward] Connecting to hub at ${caller.hub_url}...`)

    const tunnel = await caller.forward(remote_port, { signal: options?.signal })

    console.log(`[rexec forward] Forwarding 127.0.0.1:${local_port} -> agent:${remote_port}`)
    console.log(`[rexec forward] Ready for connections. Press Ctrl+C to stop.\n`)

    const active_sockets = new Map<number, { socket: net.Socket; tx: number; rx: number }>()
    let next_conn_id = 0

    tunnel.on_data((conn_id, data) => {
        const item = active_sockets.get(conn_id)
        if (item && !item.socket.destroyed) {
            item.rx += data.byteLength
            item.socket.write(data)
        }
    })

    tunnel.on_channel_close((conn_id, reason) => {
        const item = active_sockets.get(conn_id)
        if (item) {
            if (reason) console.log(`[conn-${conn_id}] ${reason}`)
            item.socket.destroy()
            active_sockets.delete(conn_id)
        }
    })

    tunnel.on_channel_error((conn_id, error) => {
        const item = active_sockets.get(conn_id)
        if (item) {
            console.error(`[conn-${conn_id}] Remote error: ${error}`)
            item.socket.destroy()
            active_sockets.delete(conn_id)
        }
    })

    const server = net.createServer((socket) => {
        const conn_id = ++next_conn_id
        const remote_addr = `${socket.remoteAddress || "127.0.0.1"}:${socket.remotePort || ""}`
        console.log(`[conn-${conn_id}] Connected from ${remote_addr}`)

        active_sockets.set(conn_id, { socket, tx: 0, rx: 0 })
        tunnel.open_channel(conn_id)

        socket.on("data", (chunk: Buffer) => {
            const item = active_sockets.get(conn_id)
            if (item) {
                item.tx += chunk.byteLength
            }
            tunnel.send_data(conn_id, chunk)
        })

        socket.on("error", (err: Error) => {
            console.error(`[conn-${conn_id}] Local socket error: ${err.message}`)
            tunnel.close_channel(conn_id, err.message)
            active_sockets.delete(conn_id)
        })

        socket.on("close", () => {
            const item = active_sockets.get(conn_id)
            if (item) {
                console.log(`[conn-${conn_id}] Closed (tx: ${format_bytes(item.tx)}, rx: ${format_bytes(item.rx)})`)
                tunnel.close_channel(conn_id)
                active_sockets.delete(conn_id)
            }
        })
    })

    await new Promise<void>((resolve, reject) => {
        server.on("error", (err) => {
            reject(err)
        })

        server.listen(local_port, "127.0.0.1", () => {
            resolve()
        })
    })

    const shutdown = () => {
        console.log(`\n[rexec forward] Stopping forward server...`)
        for (const [, item] of active_sockets) {
            item.socket.destroy()
        }
        active_sockets.clear()
        try {
            server.close()
        } catch {
            // Ignore
        }
        tunnel.close()
    }

    if (options?.signal) {
        options.signal.addEventListener("abort", shutdown, { once: true })
    }

    process.on("SIGINT", () => {
        shutdown()
        process.exit(0)
    })
    process.on("SIGTERM", () => {
        shutdown()
        process.exit(0)
    })

    // Keep running until signal aborts or server closes
    await new Promise<void>((resolve) => {
        server.on("close", resolve)
    })
}
