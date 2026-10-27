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
    /** Milliseconds since the hub last received a frame from this agent. */
    last_seen_age_ms?: number
}

export interface ExecOptions {
    cmd: string
    cwd?: string
    env?: Record<string, string>
    timeout_ms?: number
    signal?: AbortSignal
}

export type * from "@/file/types"
