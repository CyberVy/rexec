"use client"

import { useState } from "react"
import { vibrate } from "@/infra/device.client"
import type { ReactNode, Ref } from "react"

export type ChoicePillItem = {
    key?: string
    value: string
    content: ReactNode
}

export type ChoicePillsProps = {
    items: ChoicePillItem[]
    value?: string | null
    default_value?: string | null
    on_change?: (selected: string | null) => void
    className?: string
    ref?: Ref<HTMLDivElement>
}

function ChoicePills({
    items,
    value: controlled_value,
    default_value = null,
    on_change,
    className = "",
    ref
}: ChoicePillsProps) {
    const [internal_value, set_internal_value] = useState<string | null>(
        controlled_value !== undefined ? controlled_value : default_value
    )
    const [prev_controlled, set_prev_controlled] = useState(controlled_value)

    if (controlled_value !== prev_controlled) {
        set_prev_controlled(controlled_value)
        if (controlled_value !== undefined) {
            set_internal_value(controlled_value)
        }
    }

    const current_value = controlled_value !== undefined ? controlled_value : internal_value

    const handle_click = (value: string) => {
        vibrate()
        const next = current_value === value ? null : value
        if (controlled_value === undefined) {
            set_internal_value(next)
        }
        on_change?.(next)
    }

    return (
        <div ref={ref} className={`flex flex-wrap gap-1.5 select-none ${className}`}>
            {items.map((item, index) => {
                const is_selected = item.value === current_value
                return (
                    <button
                        key={item.key ?? `${item.value}-${index}`}
                        type="button"
                        aria-pressed={is_selected}
                        onClick={() => handle_click(item.value)}
                        className={[
                            "inline-flex items-center cursor-pointer rounded-full border font-medium transition-all duration-150 active:scale-[0.96]",
                            is_selected
                                ? "border-black bg-black text-white shadow-xs dark:border-white dark:bg-white dark:text-black"
                                : "border-black/10 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                        ].join(" ")}
                    >
                        {item.content}
                    </button>
                )
            })}
        </div>
    )
}

export { ChoicePills }
