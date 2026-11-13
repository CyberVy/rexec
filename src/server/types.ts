import type { AgentChannelName } from "../protocol"

export interface Env {
    REXEC_HUB: DurableObjectNamespace
}

export interface AgentGroup {
    token: string
    instance_id: string
    node_id: string
    hostname?: string
    connected_at: number
    channels: Partial<Record<AgentChannelName, WebSocket>>
}
