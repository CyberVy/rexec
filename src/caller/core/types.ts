export interface CallerOptions {
    hub_url: string
    token: string
    keep_alive?: boolean
}

export { HUB_ROUTES } from "@/protocol"
export type {
    AgentChannelName,
    ApiErrorResponse,
    ApiSuccessResponse,
    ExecKillRequestPayload,
    ExecKillResponse,
    ExecRequestPayload,
    FilePushResponse,
    HubChannelHealth,
    HubHealthResponse,
    HubRouteKey,
    HubRoutePath,
    HubStatus,
    PtySessionInfo
} from "@/protocol"

export interface PtyOptions {
    session_id?: string
    offset?: number
    file?: string
    args?: string[]
    cwd?: string
    cols?: number
    rows?: number
    term?: string
    orphan_ttl_ms?: number
    persistent?: boolean
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
