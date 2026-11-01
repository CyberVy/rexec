import type { ComponentPropsWithoutRef } from "react"

export type IconProps = ComponentPropsWithoutRef<"svg">

const DEFAULT_ICON_SIZE = 20

export function TerminalIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <polyline points="4 17 10 11 4 5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="19" x2="20" y2="19" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function ExecIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <polygon points="5 3 19 12 5 21 5 3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function RefreshIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
        </svg>
    )
}

export function RunIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
    )
}

export function AbortIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
    )
}

export function EditIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function ClearIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function CopyIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <rect
                x="9"
                y="9"
                width="13"
                height="13"
                rx="2"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function CheckIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <polyline points="20 6 9 17 4 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function NodesIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <rect
                x="2"
                y="2"
                width="20"
                height="8"
                rx="2"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <rect
                x="2"
                y="14"
                width="20"
                height="8"
                rx="2"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <line x1="6" y1="6" x2="6.01" y2="6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="6" y1="18" x2="6.01" y2="18" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function PlusIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <line x1="12" y1="5" x2="12" y2="19" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="5" y1="12" x2="19" y2="12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function TrashIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <polyline points="3 6 5 6 21 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path
                d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function KeyboardIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <rect
                x="2"
                y="4"
                width="20"
                height="16"
                rx="2"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <line x1="6" y1="8" x2="6.01" y2="8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="10" y1="8" x2="10.01" y2="8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="14" y1="8" x2="14.01" y2="8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="18" y1="8" x2="18.01" y2="8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="6" y1="12" x2="6.01" y2="12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="18" y1="12" x2="18.01" y2="12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="10" y1="12" x2="14" y2="12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="8" y1="16" x2="16" y2="16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function FolderIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function FileIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <polyline points="14 2 14 8 20 8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function FolderUpIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <polyline points="9 14 4 9 9 4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function PinIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <line x1="12" y1="17" x2="12" y2="22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path
                d="M5 17h14v-2l-2-2V5a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v8l-2 2v2z"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}
