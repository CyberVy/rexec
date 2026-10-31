import type { ComponentPropsWithoutRef } from "react"

type IconProps = ComponentPropsWithoutRef<"svg">

const DEFAULT_ICON_SIZE = 24

function SearchIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.25" fill="none" />
            <path
                d="M15 15L20 20"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function BackIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M9 17L4 12L9 7"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path d="M20 10H6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20 14H6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function ForwardIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M15 17L20 12L15 7"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path d="M4 10H18" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 14H18" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function SettingIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M10.15 3.14L9.85 4.93C9.36 5.12 8.91 5.39 8.5 5.7L6.75 5.1L5.1 6.75L5.7 8.5C5.39 8.91 5.12 9.36 4.93 9.85L3.14 10.15V13.85L4.93 14.15C5.12 14.64 5.39 15.09 5.7 15.5L5.1 17.25L6.75 18.9L8.5 18.3C8.91 18.61 9.36 18.88 9.85 19.07L10.15 20.86H13.85L14.15 19.07C14.64 18.88 15.09 18.61 15.5 18.3L17.25 18.9L18.9 17.25L18.3 15.5C18.61 15.09 18.88 14.64 19.07 14.15L20.86 13.85V10.15L19.07 9.85C18.88 9.36 18.61 8.91 18.3 8.5L18.9 6.75L17.25 5.1L15.5 5.7C15.09 5.39 14.64 5.12 14.15 4.93L13.85 3.14H10.15Z"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.25" />
        </svg>
    )
}

function CloseIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M18 6L6 18M6 6L18 18"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function ChevronDownIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M6 9L12 15L18 9"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function FilterIcon({ width = DEFAULT_ICON_SIZE, height = DEFAULT_ICON_SIZE, ...props }: IconProps) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                d="M4 6H20M7 12H17M10 18H14"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export { SearchIcon, BackIcon, ForwardIcon, SettingIcon, CloseIcon, ChevronDownIcon, FilterIcon }
