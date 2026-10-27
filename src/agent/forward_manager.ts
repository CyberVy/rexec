import net from "node:net"
import type { AgentToHubMessage, ForwardCloseMessage, ForwardOpenMessage, ForwardSessionEndMessage } from "@/protocol"
import { encode_forward_frame } from "@/transport"

interface ConnectionInfo {
    session_id: string
    socket: net.Socket
}

export class ForwardManager {
    private active_connections: Map<number, ConnectionInfo> = new Map()

    public handle_open(
        msg: ForwardOpenMessage,
        send_json: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void
    ): void {
        const { session_id, conn_id, remote_port } = msg

        // If connection already exists for this conn_id, clean it up first
        const existing = this.active_connections.get(conn_id)
        if (existing) {
            existing.socket.destroy()
            this.active_connections.delete(conn_id)
        }

        const socket = net.createConnection({ port: remote_port, host: "127.0.0.1" })
        this.active_connections.set(conn_id, { session_id, socket })

        socket.on("data", (chunk: Buffer) => {
            const frame = encode_forward_frame(session_id, conn_id, chunk)
            send_binary(frame)
        })

        socket.on("error", (err: Error) => {
            send_json({
                type: "forward:error",
                session_id,
                conn_id,
                error: err.message
            })
            this.active_connections.delete(conn_id)
        })

        socket.on("close", () => {
            this.active_connections.delete(conn_id)
            send_json({
                type: "forward:close",
                session_id,
                conn_id
            })
        })
    }

    public handle_data(conn_id: number, payload: Uint8Array): void {
        const info = this.active_connections.get(conn_id)
        if (info && !info.socket.destroyed) {
            info.socket.write(payload)
        }
    }

    public handle_close(msg: ForwardCloseMessage): void {
        const info = this.active_connections.get(msg.conn_id)
        if (info) {
            info.socket.destroy()
            this.active_connections.delete(msg.conn_id)
        }
    }

    public handle_session_end(msg: ForwardSessionEndMessage): void {
        for (const [conn_id, info] of this.active_connections.entries()) {
            if (info.session_id === msg.session_id) {
                info.socket.destroy()
                this.active_connections.delete(conn_id)
            }
        }
    }

    public abort_all(): void {
        for (const [, info] of this.active_connections) {
            info.socket.destroy()
        }
        this.active_connections.clear()
    }
}
