import * as net from "node:net"
import * as vscode from "vscode"
import { RexecCaller, type ForwardTunnelClient } from "@/caller"
import type { PortForwardInfo } from "./types"

interface ManagedTunnel {
    local_port: number
    remote_port: number
    server: net.Server
    tunnel: ForwardTunnelClient
    sockets: Map<number, net.Socket>
    created_at: Date
}

export class ForwardManager implements vscode.Disposable {
    private readonly tunnels = new Map<number, ManagedTunnel>()
    private readonly on_tunnels_change_emitter = new vscode.EventEmitter<PortForwardInfo[]>()
    public readonly on_did_change_tunnels = this.on_tunnels_change_emitter.event

    public async start_forward(hub_url: string, token: string, local_port: number, remote_port: number): Promise<void> {
        if (this.tunnels.has(local_port)) {
            throw new Error(`Port ${local_port} is already being forwarded by Rexec`)
        }

        const caller = new RexecCaller({ hub_url, token })
        const tunnel = await caller.forward(remote_port)

        const sockets = new Map<number, net.Socket>()
        let next_conn_id = 0

        tunnel.on_data((conn_id, data) => {
            const socket = sockets.get(conn_id)
            if (socket && !socket.destroyed) {
                socket.write(data)
            }
        })

        tunnel.on_channel_close((conn_id) => {
            const socket = sockets.get(conn_id)
            if (socket) {
                socket.destroy()
                sockets.delete(conn_id)
                this.notify_change()
            }
        })

        tunnel.on_channel_error((conn_id) => {
            const socket = sockets.get(conn_id)
            if (socket) {
                socket.destroy()
                sockets.delete(conn_id)
                this.notify_change()
            }
        })

        const server = net.createServer((socket) => {
            const conn_id = ++next_conn_id
            sockets.set(conn_id, socket)
            this.notify_change()

            tunnel.open_channel(conn_id)

            socket.on("data", (chunk: Buffer) => {
                tunnel.send_data(conn_id, chunk)
            })

            socket.on("error", (err: Error) => {
                tunnel.close_channel(conn_id, err.message)
                sockets.delete(conn_id)
                this.notify_change()
            })

            socket.on("close", () => {
                tunnel.close_channel(conn_id)
                sockets.delete(conn_id)
                this.notify_change()
            })
        })

        await new Promise<void>((resolve, reject) => {
            server.once("error", (err) => {
                tunnel.close()
                reject(err)
            })
            server.listen(local_port, "127.0.0.1", () => {
                resolve()
            })
        })

        this.tunnels.set(local_port, {
            local_port,
            remote_port,
            server,
            tunnel,
            sockets,
            created_at: new Date()
        })

        this.notify_change()
    }

    public async stop_forward(local_port: number): Promise<boolean> {
        const item = this.tunnels.get(local_port)
        if (!item) {
            return false
        }

        for (const socket of item.sockets.values()) {
            socket.destroy()
        }
        item.sockets.clear()

        await new Promise<void>((resolve) => {
            item.server.close(() => resolve())
        })

        item.tunnel.close()
        this.tunnels.delete(local_port)
        this.notify_change()
        return true
    }

    public async stop_all(): Promise<void> {
        const ports = Array.from(this.tunnels.keys())
        for (const port of ports) {
            await this.stop_forward(port)
        }
    }

    public get_active_tunnels(): PortForwardInfo[] {
        return Array.from(this.tunnels.values()).map((t) => ({
            local_port: t.local_port,
            remote_port: t.remote_port,
            active_connections: t.sockets.size,
            created_at: t.created_at
        }))
    }

    private notify_change(): void {
        this.on_tunnels_change_emitter.fire(this.get_active_tunnels())
    }

    public dispose(): void {
        void this.stop_all()
        this.on_tunnels_change_emitter.dispose()
    }
}
