export type StreamType = "stdout" | "stderr"

export interface AgentRegisterMessage {
    type: "register"
    node_id?: string
    hostname?: string
}

export interface HubRegisteredMessage {
    type: "registered"
    node_id: string
}

export interface TaskExecMessage {
    type: "exec"
    task_id: string
    cmd: string
    cwd?: string
    env?: Record<string, string>
}

export interface TaskChunkMessage {
    type: "chunk"
    task_id: string
    stream: StreamType
    data: string
}

export interface TaskExitMessage {
    type: "exit"
    task_id: string
    code: number | null
    signal?: string | null
}

export interface TaskKillMessage {
    type: "kill"
    task_id: string
    signal?: string
}

export interface PingMessage {
    type: "ping"
}

export interface PongMessage {
    type: "pong"
}

export type AgentToHubMessage = AgentRegisterMessage | TaskChunkMessage | TaskExitMessage | PingMessage | PongMessage

export type HubToAgentMessage = HubRegisteredMessage | TaskExecMessage | TaskKillMessage | PingMessage | PongMessage

export interface ExecRequestPayload {
    cmd: string
    cwd?: string
    env?: Record<string, string>
    timeout_ms?: number
}

export interface SseChunkEvent {
    type: "stdout" | "stderr"
    data: string
}

export interface SseExitEvent {
    type: "exit"
    code: number
    signal?: string | null
}

export interface SseErrorEvent {
    type: "error"
    message: string
}
