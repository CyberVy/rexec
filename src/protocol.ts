export type StreamType = "stdout" | "stderr"

export const TRANSFER_ID_BYTES = 16

export interface FileMetadata {
    path: string
    size: number
    mtime?: number
    mode?: number
    is_directory?: boolean
}

// ==========================================
// Core Session Messages
// ==========================================
export interface AgentRegisterMessage {
    type: "register"
    node_id?: string
    hostname?: string
}

export interface HubRegisteredMessage {
    type: "registered"
    node_id: string
}

export interface PingMessage {
    type: "ping"
}

export interface PongMessage {
    type: "pong"
}

// ==========================================
// Task Domain Messages (Remote Execution)
// ==========================================
export interface TaskExecMessage {
    type: "task:exec" | "exec"
    task_id: string
    cmd: string
    cwd?: string
    env?: Record<string, string>
}

export interface TaskChunkMessage {
    type: "task:chunk" | "chunk"
    task_id: string
    stream: StreamType
    data: string
}

export interface TaskExitMessage {
    type: "task:exit" | "exit"
    task_id: string
    code: number | null
    signal?: string | null
}

export interface TaskKillMessage {
    type: "task:kill" | "kill"
    task_id: string
    signal?: string
}

// ==========================================
// Transfer Domain Messages (File Transfer Signaling)
// ==========================================
export interface FilePullStartMessage {
    type: "file:pull_start"
    transfer_id: string
    path: string
    recursive?: boolean
}

export interface FilePullMetaMessage {
    type: "file:pull_meta"
    transfer_id: string
    meta: FileMetadata
}

export interface FilePullEndMessage {
    type: "file:pull_end"
    transfer_id: string
    sha256?: string
}

export interface FilePushStartMessage {
    type: "file:push_start"
    transfer_id: string
    path: string
    size: number
    mode?: number
    recursive?: boolean
}

export interface FilePushEndMessage {
    type: "file:push_end"
    transfer_id: string
    sha256?: string
}

export interface TransferErrorMessage {
    type: "transfer:error"
    transfer_id: string
    error: string
}

// ==========================================
// Message Unions
// ==========================================
export type AgentToHubMessage =
    | AgentRegisterMessage
    | TaskChunkMessage
    | TaskExitMessage
    | PingMessage
    | PongMessage
    | FilePullMetaMessage
    | FilePullEndMessage
    | FilePushEndMessage
    | TransferErrorMessage

export type HubToAgentMessage =
    | HubRegisteredMessage
    | TaskExecMessage
    | TaskKillMessage
    | PingMessage
    | PongMessage
    | FilePullStartMessage
    | FilePushStartMessage
    | FilePushEndMessage
    | TransferErrorMessage

// ==========================================
// HTTP Payload Contracts
// ==========================================
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
