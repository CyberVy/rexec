export {}

declare global {
    interface Window {
        webkit?: {
            messageHandlers?: Record<string, any>
        }
        __TAURI__?: {
            core?: {
                invoke?: <T = any>(cmd: string, payload?: any) => Promise<T>
            }
        }
        __TAURI_INTERNALS__?: unknown
    }
}

declare global {
    interface FileSystemWritableFileStream {
        write(data: string | BufferSource | Blob): Promise<void>
        seek(position: number): Promise<void>
        truncate(size: number): Promise<void>
        close(): Promise<void>
    }

    interface FileSystemFileHandle {
        readonly kind: "file"
        readonly name: string
        createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
        getFile(): Promise<File>
    }

    interface SaveFilePickerOptions {
        suggestedName?: string
        excludeAcceptAllOption?: boolean
        types?: Array<{
            description?: string
            accept: Record<string, string[]>
        }>
        id?: string
        startIn?: string | FileSystemFileHandle
    }

    interface Window {
        showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
    }
}
