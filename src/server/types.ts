export interface Env {
    REXEC_HUB: DurableObjectNamespace
}

export interface AgentSession {
    token: string
    node_id: string
    hostname?: string
    ws: WebSocket
    connected_at: number
}
