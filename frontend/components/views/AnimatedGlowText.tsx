"use client"

import { join_classes } from "../utils"
import type { Ref } from "react"

export type AnimatedGlowTextProps = {
    text: string
    duration?: number
    stagger?: number
    className?: string
    ref?: Ref<HTMLDivElement>
}

function AnimatedGlowText({ text, duration = 1.8, stagger = 0.06, className, ref }: AnimatedGlowTextProps) {
    return (
        <div ref={ref} className={join_classes("inline", className)}>
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
