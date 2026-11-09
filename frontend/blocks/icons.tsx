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

export type LaunchLogoProps = ComponentPropsWithoutRef<"svg"> & {
    size?: number
}

export function LaunchLogo({ size = 192, width, height, className = "", ...props }: LaunchLogoProps) {
    const final_size = size ?? width ?? 192
    return (
        <svg
            width={final_size}
            height={final_size}
            viewBox="0 0 192 192"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`rexec-launch-logo ${className}`}
            {...props}
        >
            <defs>
                <radialGradient id="rexec-hub-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.8" />
                    <stop offset="30%" stopColor="currentColor" stopOpacity="0.5" />
                    <stop offset="65%" stopColor="currentColor" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </radialGradient>
                <filter id="rexec-neon-glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="1.5" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <style>{`
                    .rexec-path-lobe {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: rexec_draw_mesh 0.48s cubic-bezier(0.16, 1, 0.3, 1) 0.03s forwards;
                    }
                    .rexec-path-tail {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: rexec_draw_mesh 0.48s cubic-bezier(0.16, 1, 0.3, 1) 0.22s forwards;
                    }
                    .rexec-path-inner {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: rexec_draw_mesh 0.48s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
                    }
                    .rexec-path-radial {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: rexec_draw_mesh 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.16s forwards;
                    }
                    .rexec-node-spine, .rexec-node-outer, .rexec-node-inner, .rexec-node-tail {
                        opacity: 0;
                    }
                    .rexec-node-inner {
                        animation: rexec_node_appear 0.22s ease-out 0.19s forwards;
                    }
                    .rexec-node-outer {
                        animation: rexec_node_appear 0.22s ease-out 0.28s forwards;
                    }
                    .rexec-node-spine {
                        animation: rexec_node_appear 0.22s ease-out 0.35s forwards;
                    }
                    .rexec-node-tail {
                        animation: rexec_node_appear 0.22s ease-out 0.41s forwards;
                    }
                    .rexec-hub-halo {
                        transform: scale(0.3);
                        opacity: 0;
                        animation: rexec_hub_glow 0.42s cubic-bezier(0.16, 1, 0.3, 1) 0.42s forwards,
                                   rexec_hub_idle 1.8s ease-in-out 0.9s infinite alternate;
                    }
                    .rexec-hub-core {
                        transform: scale(0);
                        opacity: 0;
                        animation: rexec_hub_core 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) 0.46s forwards;
                    }
                    .rexec-wave-primary {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: rexec_wave_shoot 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.58s forwards;
                    }
                    .rexec-wave-secondary {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: rexec_wave_shoot 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.62s forwards;
                    }
                    .rexec-arrow-head {
                        transform: scale(0);
                        opacity: 0;
                        animation: rexec_arrow_head 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) 0.8s forwards;
                    }
                    @keyframes rexec_draw_mesh {
                        0% {
                            stroke-dashoffset: 100;
                            opacity: 0;
                        }
                        20% {
                            opacity: 0.8;
                        }
                        100% {
                            stroke-dashoffset: 0;
                            opacity: 0.85;
                        }
                    }
                    @keyframes rexec_node_appear {
                        0% {
                            opacity: 0;
                        }
                        100% {
                            opacity: 1;
                        }
                    }
                    @keyframes rexec_hub_core {
                        0% {
                            transform: scale(0);
                            opacity: 0;
                        }
                        60% {
                            transform: scale(1.3);
                            opacity: 1;
                        }
                        100% {
                            transform: scale(1);
                            opacity: 1;
                        }
                    }
                    @keyframes rexec_wave_shoot {
                        0% {
                            stroke-dashoffset: 100;
                            opacity: 0;
                        }
                        15% {
                            opacity: 1;
                        }
                        100% {
                            stroke-dashoffset: 0;
                            opacity: 1;
                        }
                    }
                    @keyframes rexec_arrow_head {
                        0% {
                            transform: scale(0);
                            opacity: 0;
                        }
                        65% {
                            transform: scale(1.25);
                            opacity: 1;
                        }
                        100% {
                            transform: scale(1);
                            opacity: 1;
                        }
                    }
                    /* Light Mode hub glow defaults */
                    @keyframes rexec_hub_glow {
                        0% {
                            transform: scale(0.3);
                            opacity: 0;
                        }
                        50% {
                            transform: scale(1.35);
                            opacity: 0.35;
                        }
                        100% {
                            transform: scale(1);
                            opacity: 0.22;
                        }
                    }
                    @keyframes rexec_hub_idle {
                        0% {
                            transform: scale(1);
                            opacity: 0.22;
                        }
                        100% {
                            transform: scale(1.15);
                            opacity: 0.35;
                        }
                    }
                    /* Dark Mode hub glow overrides */
                    @media (prefers-color-scheme: dark) {
                        @keyframes rexec_hub_glow {
                            0% {
                                transform: scale(0.3);
                                opacity: 0;
                            }
                            50% {
                                transform: scale(1.35);
                                opacity: 0.95;
                            }
                            100% {
                                transform: scale(1);
                                opacity: 0.75;
                            }
                        }
                        @keyframes rexec_hub_idle {
                            0% {
                                transform: scale(1);
                                opacity: 0.75;
                            }
                            100% {
                                transform: scale(1.15);
                                opacity: 0.9;
                            }
                        }
                    }
                `}</style>
            </defs>

            {/* Mesh & Lobes */}
            <g stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                {/* Top dome */}
                <path
                    className="rexec-path-lobe"
                    pathLength={100}
                    d="M 63 60 C 63 42, 128 42, 128 60"
                    strokeWidth="1.8"
                />
                {/* Left upper lobe */}
                <path
                    className="rexec-path-lobe"
                    pathLength={100}
                    d="M 63 60 C 45 60, 38 75, 38 93"
                    strokeWidth="1.8"
                />
                {/* Left lower lobe */}
                <path
                    className="rexec-path-lobe"
                    pathLength={100}
                    d="M 38 93 C 38 112, 50 128, 62 129 C 72 130, 85 127, 96 124"
                    strokeWidth="1.8"
                />
                {/* Right upper lobe */}
                <path
                    className="rexec-path-lobe"
                    pathLength={100}
                    d="M 128 60 C 146 60, 154 75, 154 95"
                    strokeWidth="1.8"
                />
                {/* Right lower lobe */}
                <path
                    className="rexec-path-lobe"
                    pathLength={100}
                    d="M 154 95 C 154 112, 142 124, 114 126"
                    strokeWidth="1.8"
                />
                {/* Tail */}
                <path className="rexec-path-tail" pathLength={100} d="M 96 124 L 121 143 L 114 126" strokeWidth="1.8" />

                {/* Inner curves */}
                <path
                    className="rexec-path-inner"
                    pathLength={100}
                    d="M 96 47 C 76 60, 70 80, 66 95 C 62 110, 70 120, 96 124"
                    strokeWidth="1.2"
                    strokeOpacity="0.8"
                />
                <path
                    className="rexec-path-inner"
                    pathLength={100}
                    d="M 96 47 C 116 60, 122 80, 124 100 C 126 110, 120 120, 96 124"
                    strokeWidth="1.2"
                    strokeOpacity="0.8"
                />
                <path
                    className="rexec-path-inner"
                    pathLength={100}
                    d="M 96 47 L 96 124"
                    strokeWidth="1.2"
                    strokeOpacity="0.8"
                />

                {/* Radial lines */}
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 38 93 L 96 90 L 154 95"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 63 60 L 96 90 L 128 60"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 58 72 L 96 67 L 133 72"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 58 72 L 66 95 L 73 117 L 96 90 L 118 117 L 134 118"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 80 58 L 96 90 L 112 58"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 38 93 L 66 95 L 57 118 L 73 117 L 96 124"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 124 100 L 118 117 L 114 126"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
                <path
                    className="rexec-path-radial"
                    pathLength={100}
                    d="M 124 100 L 134 118 L 154 95"
                    strokeWidth="1.2"
                    strokeOpacity="0.75"
                />
            </g>

            {/* Network Nodes */}
            <g fill="currentColor">
                {/* Spine & top */}
                <circle className="rexec-node-spine" cx="96" cy="47" r="2.8" />
                <circle className="rexec-node-spine" cx="96" cy="67" r="2.2" />
                <circle className="rexec-node-spine" cx="96" cy="124" r="2.8" />
                <circle className="rexec-node-tail" cx="121" cy="143" r="2.8" />

                {/* Outer nodes */}
                <circle className="rexec-node-outer" cx="63" cy="60" r="2.8" />
                <circle className="rexec-node-outer" cx="128" cy="60" r="2.8" />
                <circle className="rexec-node-outer" cx="38" cy="93" r="2.8" />
                <circle className="rexec-node-outer" cx="154" cy="95" r="2.8" />
                <circle className="rexec-node-outer" cx="57" cy="118" r="2.5" />
                <circle className="rexec-node-outer" cx="134" cy="118" r="2.5" />
                <circle className="rexec-node-outer" cx="62" cy="129" r="2.2" />

                {/* Inner nodes */}
                <circle className="rexec-node-inner" cx="80" cy="58" r="2.3" />
                <circle className="rexec-node-inner" cx="112" cy="58" r="2.3" />
                <circle className="rexec-node-inner" cx="58" cy="72" r="2.4" />
                <circle className="rexec-node-inner" cx="133" cy="72" r="2.4" />
                <circle className="rexec-node-inner" cx="66" cy="95" r="2.3" />
                <circle className="rexec-node-inner" cx="73" cy="117" r="2.3" />
                <circle className="rexec-node-inner" cx="118" cy="117" r="2.3" />
                <circle className="rexec-node-inner" cx="124" cy="100" r="2.3" />
            </g>

            {/* Center Hub Halo & Core (centered at 0, 0 inside translate group) */}
            <g transform="translate(96, 90)">
                <circle className="rexec-hub-halo" cx="0" cy="0" r="16" fill="url(#rexec-hub-glow)" />
                <circle
                    className="rexec-hub-core"
                    cx="0"
                    cy="0"
                    r="4"
                    fill="currentColor"
                    filter="url(#rexec-neon-glow)"
                />
            </g>

            {/* Wave Arrow */}
            <g
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#rexec-neon-glow)"
            >
                <path
                    className="rexec-wave-primary"
                    pathLength={100}
                    d="M 98 89.5 Q 106 83, 113 90 T 127 96 Q 134 94, 144 94"
                    strokeWidth="2.5"
                />
                <path
                    className="rexec-wave-secondary"
                    pathLength={100}
                    d="M 100 92.5 Q 107 86, 114 93 T 128 99 Q 133 97, 140 97"
                    strokeWidth="1.4"
                    strokeOpacity="0.75"
                />
                {/* Arrow Head (centered at 0, 0 inside translate group) */}
                <g transform="translate(141.5, 94)">
                    <path
                        className="rexec-arrow-head"
                        d="M -4.5 -6 L 4.5 0 L -4.5 6 Z"
                        fill="currentColor"
                        strokeWidth="1"
                    />
                </g>
            </g>
        </svg>
    )
}
