import type { FileMetadata } from "@/protocol"

export interface Env {
    REXEC_HUB: DurableObjectNamespace
}

export interface ActiveTask {
    token: string
    writer: WritableStreamDefaultWriter<Uint8Array>
    timeout_id?: ReturnType<typeof setTimeout>
    encoder: TextEncoder
    write_queue: Promise<void>
}

export interface ActivePull {
    token: string
    writer: WritableStreamDefaultWriter<Uint8Array>
    resolve_meta: (meta: FileMetadata) => void
    reject_meta: (err: Error) => void
    meta_received: boolean
    timeout_id?: ReturnType<typeof setTimeout>
    write_queue: Promise<void>
}

export interface ActivePush {
    token: string
    resolve_push: (result: { sha256?: string }) => void
    reject_push: (err: Error) => void
    timeout_id?: ReturnType<typeof setTimeout>
}

export interface AgentSession {
    token: string
    node_id: string
    hostname?: string
    ws: WebSocket
    connected_at: number
}

export interface ActiveForwardSession {
    session_id: string
    token: string
    caller_ws: WebSocket
    agent_ws: WebSocket
    remote_port: number
}
