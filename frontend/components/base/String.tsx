"use client"

import type { ComponentPropsWithRef } from "react"

type AnimatedGlowTextProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
    text?: string
    duration?: number
    stagger?: number
    tailwind_cls_for_string_item?: string
}

function AnimatedGlowText({
    text = "Hello World",
    duration = 1.8,
    stagger = 0.06,
    tailwind_cls_for_string_item = "",
    className = "",
    ref,
    ...props
}: AnimatedGlowTextProps) {
    return (
        <div {...props} ref={ref} className={["inline", className].filter(Boolean).join(" ")}>
            {text.split("").map((ch, index) => (
                <span
                    key={index}
                    className={`animate-pulse brightness-125 ${tailwind_cls_for_string_item}`}
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
