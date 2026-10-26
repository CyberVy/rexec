export interface ProgressInfo {
    transferred: number
    total: number
    speed: number
}

export interface FileSource {
    stream: ReadableStream<Uint8Array>
    size: number
    is_directory: boolean
    mtime?: number
    mode?: number
    cleanup?: () => void
}

export interface FileSink {
    stream: WritableStream<Uint8Array>
    wait_for_finish: () => Promise<void>
    cleanup?: () => void
}

export interface PullOptions {
    recursive?: boolean
    signal?: AbortSignal
    on_progress?: (info: ProgressInfo, chunk: Uint8Array) => void
}

export interface PushOptions {
    signal?: AbortSignal
    on_progress?: (info: ProgressInfo, chunk: Uint8Array) => void
}

export interface PullResult {
    transferred: number
    is_directory: boolean
}

export interface PushResult {
    transferred: number
    is_directory: boolean
    sha256?: string
}

// Aliases for compatibility
export type TransferSource = FileSource
export type TransferSink = FileSink
