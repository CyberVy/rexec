/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_NATIVE_ENTRY_URL: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare const process: {
    readonly env: {
        readonly NODE_ENV?: string
    }
}
