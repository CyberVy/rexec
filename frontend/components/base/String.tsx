"use client"

import type { Ref } from "react"

type AnimatedGlowTextProps = {
    text: string
    duration?: number
    stagger?: number
    className?: string
    ref?: Ref<HTMLDivElement>
}

function AnimatedGlowText({ text, duration = 1.8, stagger = 0.06, className = "", ref }: AnimatedGlowTextProps) {
    return (
        <div ref={ref} className={["inline", className].filter(Boolean).join(" ")}>
            {text.split("").map((ch, index) => (
                <span
                    key={index}
                    className="animate-pulse brightness-125"
                    style={{
                        animationDelay: `${index * stagger}s`,
                        animationDuration: `${duration}s`
                    }}
                >
                    {ch}
                </span>
            ))}
        </div>
    )
}

export { AnimatedGlowText }
