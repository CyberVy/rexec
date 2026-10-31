export type StreamType = "stdout" | "stderr"

export { ChannelDomain, TRANSFER_ID_BYTES, FORWARD_HEADER_BYTES, TRANSFER_HEADER_BYTES } from "@/transport/framing"

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
    type: "task:exec"
    task_id: string
    cmd: string
    cwd?: string
    env?: Record<string, string>
}

export interface TaskChunkMessage {
    type: "task:chunk"
    task_id: string
    stream: StreamType
    data: string
}

export interface TaskExitMessage {
    type: "task:exit"
    task_id: string
    code: number | null
    signal?: string | null
}

export interface TaskKillMessage {
    type: "task:kill"
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
// Forward Domain Messages (Port Forwarding Signaling)
// ==========================================
export interface ForwardOpenMessage {
    type: "forward:open"
    session_id: string
    conn_id: number
    remote_port: number
}

export interface ForwardCloseMessage {
    type: "forward:close"
    session_id: string
    conn_id: number
    reason?: string
}

export interface ForwardErrorMessage {
    type: "forward:error"
    session_id: string
    conn_id: number
    error: string
}

export interface ForwardSessionEndMessage {
    type: "forward:session_end"
    session_id: string
}

// ==========================================
// PTY Domain Messages (Interactive Terminal)
// ==========================================
export interface PtyOpenMessage {
    type: "pty:open"
    session_id: string
    file: string
    args?: string[]
    cwd?: string
    cols: number
    rows: number
    term?: string
    orphan_ttl_ms?: number
}

export interface PtyResizeMessage {
    type: "pty:resize"
    session_id: string
    cols: number
    rows: number
}

export interface PtyCloseMessage {
    type: "pty:close"
    session_id: string
}

export interface PtyDetachMessage {
    type: "pty:detach"
    session_id: string
}

export interface PtyAttachMessage {
    type: "pty:attach"
    session_id: string
    cols?: number
    rows?: number
}

export interface PtyExitMessage {
    type: "pty:exit"
    session_id: string
    code: number
    signal: number
}

export interface PtyErrorMessage {
    type: "pty:error"
    session_id: string
    error: string
}

export interface PtySessionInfo {
    session_id: string
    status: "attached" | "detached"
    command: string
    cwd?: string
    started_at: number
    detached_at?: number
    orphan_ttl_ms: number
    remaining_ttl_ms?: number
    buffered_bytes: number
}

export interface PtyListReqMessage {
    type: "pty:list_req"
    req_id: string
}

export interface PtyListResMessage {
    type: "pty:list_res"
    req_id: string
    sessions: PtySessionInfo[]
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
    | ForwardCloseMessage
    | ForwardErrorMessage
    | PtyExitMessage
    | PtyErrorMessage
    | PtyListResMessage

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
    | ForwardOpenMessage
    | ForwardCloseMessage
    | ForwardSessionEndMessage
    | PtyOpenMessage
    | PtyResizeMessage
    | PtyCloseMessage
    | PtyDetachMessage
    | PtyAttachMessage
    | PtyListReqMessage

// ==========================================
// HTTP API Route Manifest & Registry (SSOT)
// ==========================================
export const HUB_ROUTES = {
    HEALTH: { path: "/health", method: "GET" },
    PTY_LIST: { path: "/pty/list", method: "GET" },
    PTY_KILL: { path: "/pty/kill", method: "POST" },
    EXEC: { path: "/exec", method: "POST" },
    EXEC_KILL: { path: "/exec/kill", method: "POST" },
    FILE_PULL: { path: "/file/pull", method: "GET" },
    FILE_PUSH: { path: "/file/push", method: "POST" },
    WS: { path: "/ws", method: "WS" },
    WS_FORWARD: { path: "/ws/forward", method: "WS" },
    WS_PTY: { path: "/ws/pty", method: "WS" }
} as const

export type HubRouteKey = keyof typeof HUB_ROUTES
export type HubRoutePath = (typeof HUB_ROUTES)[HubRouteKey]["path"]

// ==========================================
// HTTP API Contracts (Hub Endpoints)
// ==========================================

export interface ApiSuccessResponse {
    status: "ok"
}

export interface ApiErrorResponse {
    error: string
}

// 1. /health
export interface HubHealthResponse {
    status: "ok"
    agent_connected: boolean
    active_tasks: number
    node_id?: string
    connected_agents?: number
}

export type HubStatus = HubHealthResponse

// 2. /exec & /exec/kill
export interface ExecRequestPayload {
    cmd: string
    cwd?: string
    env?: Record<string, string>
    timeout_ms?: number
}

export interface ExecStartEvent {
    type: "start"
    task_id: string
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

export interface ExecKillRequestPayload {
    task_id: string
}

export interface ExecKillResponse {
    status: "ok"
}

// 3. /pty/kill (Note: /pty/list returns PtySessionInfo[])
export interface PtyKillRequestPayload {
    session_id: string
}

export interface PtyKillResponse {
    status: "ok"
}

// 4. /file/push
export interface FilePushResponse {
    status: "ok"
    size: number
    sha256?: string
}
