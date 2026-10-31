export interface CallerOptions {
    hub_url: string
    token: string
}

export interface HubStatus {
    status: string
    agent_connected: boolean
    node_id?: string
    active_tasks: number
    connected_agents?: number
}

export interface PtyOptions {
    session_id?: string
    file?: string
    args?: string[]
    cwd?: string
    cols?: number
    rows?: number
    term?: string
    orphan_ttl_ms?: number
    signal?: AbortSignal
}

export interface ExecOptions {
    cmd: string
    cwd?: string
    env?: Record<string, string>
    timeout_ms?: number
    signal?: AbortSignal
}

export type * from "@/file/types"
