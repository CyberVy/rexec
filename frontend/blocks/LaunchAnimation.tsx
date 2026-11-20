"use client"

import { useCallback, type ComponentPropsWithoutRef } from "react"
import { join_classes } from "@/components/utils"

type LaunchLogoProps = ComponentPropsWithoutRef<"svg"> & {
    size?: number
}

function LaunchLogo({ size = 192, width, height, className = "", ...props }: LaunchLogoProps) {
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

export type LaunchAnimationProps = {
    className?: string
    on_finish?: () => void
}

function LaunchAnimation({ className, on_finish }: LaunchAnimationProps) {
    const attach_launch_timer = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node) return
            const finish_timer = setTimeout(() => {
                on_finish?.()
            }, 1500)

            return () => {
                clearTimeout(finish_timer)
            }
        },
        [on_finish]
    )

    return (
        <div
            ref={attach_launch_timer}
            className={join_classes(
                "fixed inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white select-none overflow-hidden transition-opacity duration-300 ease-out",
                className
            )}
        >
            <LaunchLogo size={170} className="mb-8 shrink-0 text-black dark:text-white" />
        </div>
    )
}

export { LaunchAnimation }
