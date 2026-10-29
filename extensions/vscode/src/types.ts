export type AgentConnectionStatus = "unconfigured" | "checking" | "connected" | "disconnected" | "error"

export interface RemoteServer {
    id: string
    name: string
    hub_url: string
    token: string
    created_at: number
}

export interface AgentStatusInfo {
    status: AgentConnectionStatus
    server_id?: string
    server_name?: string
    hub_url: string
    token?: string
    node_id?: string
    active_tasks?: number
    error_message?: string
    last_checked?: Date
}

export interface PortForwardInfo {
    local_port: number
    remote_port: number
    active_connections: number
    created_at: Date
}

export interface RexecConfig {
    hub_url: string
    token: string
    refresh_interval_sec: number
    auto_detect_env: boolean
}
