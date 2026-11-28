import net from "node:net"
import type { RexecCaller } from "@core/caller"
import { format_bytes } from "./ui"

export interface ForwardOptions {
    signal?: AbortSignal
    on_ready?: (info: { local_port: number; remote_port: number }) => void
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

    try {
        await new Promise<void>((resolve, reject) => {
            const on_listen_error = (err: Error) => reject(err)
            server.once("error", on_listen_error)
            server.listen(local_port, "127.0.0.1", () => {
                server.off("error", on_listen_error)
                resolve()
            })
        })
    } catch (err) {
        tunnel.close()
        throw err
    }

    let stopped = false
    const shutdown = () => {
        if (stopped) return
        stopped = true
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

    const on_process_signal = () => {
        shutdown()
        process.exit(0)
    }

    if (options?.signal?.aborted) {
        shutdown()
        return
    }

    options?.signal?.addEventListener("abort", shutdown, { once: true })
    process.on("SIGINT", on_process_signal)
    process.on("SIGTERM", on_process_signal)

    options?.on_ready?.({ local_port, remote_port })

    try {
        // Keep running until signal aborts or server closes
        await new Promise<void>((resolve) => {
            server.once("close", resolve)
        })
    } finally {
        options?.signal?.removeEventListener("abort", shutdown)
        process.off("SIGINT", on_process_signal)
        process.off("SIGTERM", on_process_signal)
    }
}
