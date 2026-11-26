"use client"

import { useState } from "react"
import { HapticContainer } from "../feedback/HapticContainer"
import { join_classes } from "../utils"
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
    className,
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
        const next = current_value === value ? null : value
        if (controlled_value === undefined) {
            set_internal_value(next)
        }
        on_change?.(next)
    }

    return (
        <div ref={ref} className={join_classes("flex flex-wrap gap-1.5 select-none", className)}>
            {items.map((item, index) => {
                const is_selected = item.value === current_value
                return (
                    <button
                        key={item.key ?? `${item.value}-${index}`}
                        type="button"
                        aria-pressed={is_selected}
                        onClick={() => handle_click(item.value)}
                        className={join_classes(
                            "inline-flex items-center cursor-pointer rounded-full border font-medium transition-all duration-150 active:scale-[0.96]",
                            is_selected
                                ? "border-ui-fill-solid bg-ui-fill-solid text-ui-label-inverse shadow-xs"
                                : "border-ui-border bg-ui-fill-subtle text-ui-label-secondary hover:bg-ui-fill-hover hover:text-ui-label-strong"
                        )}
                    >
                        <HapticContainer>
                            <span className="inline-flex items-center">{item.content}</span>
                        </HapticContainer>
                    </button>
                )
            })}
        </div>
    )
}

export { ChoicePills }
