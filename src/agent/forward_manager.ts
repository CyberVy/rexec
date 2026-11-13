import net from "node:net"
import type { AgentToHubMessage, ForwardCloseMessage, ForwardOpenMessage, ForwardSessionEndMessage } from "@/protocol"
import { encode_forward_frame } from "@/transport"

function scope_key(client_id: string, session_id: string): string {
    return `${client_id}:${session_id}`
}

export class ForwardManager {
    private sessions: Map<string, Map<number, net.Socket>> = new Map()

    public handle_open(
        msg: ForwardOpenMessage,
        send_json: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void,
        client_id = "default"
    ): void {
        const { session_id, conn_id, remote_port } = msg
        const key = scope_key(client_id, session_id)

        let session_sockets = this.sessions.get(key)
        if (!session_sockets) {
            session_sockets = new Map()
            this.sessions.set(key, session_sockets)
        }

        const existing = session_sockets.get(conn_id)
        if (existing) {
            session_sockets.delete(conn_id)
            existing.destroy()
        }

        const socket = net.createConnection({ port: remote_port, host: "127.0.0.1" })
        session_sockets.set(conn_id, socket)

        socket.on("data", (chunk: Buffer) => {
            const frame = encode_forward_frame(session_id, conn_id, chunk)
            send_binary(frame)
        })

        socket.on("error", (err: Error) => {
            this.delete_socket(key, conn_id, socket)
            send_json({
                type: "forward:error",
                session_id,
                conn_id,
                error: err.message
            })
        })

        socket.on("close", () => {
            if (this.delete_socket(key, conn_id, socket)) {
                send_json({
                    type: "forward:close",
                    session_id,
                    conn_id
                })
            }
        })
    }

    public handle_data(session_id: string, conn_id: number, payload: Uint8Array, client_id = "default"): void {
        const socket = this.sessions.get(scope_key(client_id, session_id))?.get(conn_id)
        if (socket && !socket.destroyed) {
            socket.write(payload)
        }
    }

    public handle_close(msg: ForwardCloseMessage, client_id = "default"): void {
        const key = scope_key(client_id, msg.session_id)
        const session_sockets = this.sessions.get(key)
        const socket = session_sockets?.get(msg.conn_id)
        if (socket) {
            this.delete_socket(key, msg.conn_id, socket)
            socket.destroy()
        }
    }

    public handle_session_end(msg: ForwardSessionEndMessage, client_id = "default"): void {
        const key = scope_key(client_id, msg.session_id)
        const session_sockets = this.sessions.get(key)
        if (!session_sockets) return
        this.sessions.delete(key)
        for (const socket of session_sockets.values()) {
            socket.destroy()
        }
    }

    public cleanup_client(client_id: string): void {
        const prefix = `${client_id}:`
        for (const [key, session_sockets] of this.sessions) {
            if (!key.startsWith(prefix)) continue
            this.sessions.delete(key)
            for (const socket of session_sockets.values()) {
                socket.destroy()
            }
        }
    }

    public abort_all(): void {
        for (const session_sockets of this.sessions.values()) {
            for (const socket of session_sockets.values()) {
                socket.destroy()
            }
        }
        this.sessions.clear()
    }

    private delete_socket(key: string, conn_id: number, socket: net.Socket): boolean {
        const session_sockets = this.sessions.get(key)
        if (!session_sockets || session_sockets.get(conn_id) !== socket) {
            return false
        }
        session_sockets.delete(conn_id)
        if (session_sockets.size === 0) {
            this.sessions.delete(key)
        }
        return true
    }
}
