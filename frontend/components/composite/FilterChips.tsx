"use client"

import { useState } from "react"
import { vibrate } from "@/infra/device.client"
import type { ComponentPropsWithRef } from "react"

export type FilterChipsProps = Omit<ComponentPropsWithRef<"div">, "children" | "onChange"> & {
    items: string[]
    value?: string | null
    default_value?: string | null
    on_change?: (selected: string | null) => void
    item_class_name?: string
    size?: "sm" | "md"
}

function FilterChips({
    items,
    value: controlled_value,
    default_value = null,
    on_change,
    item_class_name = "",
    size = "sm",
    className = "",
    ref,
    ...props
}: FilterChipsProps) {
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

    const handle_click = (item: string) => {
        vibrate()
        const next = current_value === item ? null : item
        if (controlled_value === undefined) {
            set_internal_value(next)
        }
        on_change?.(next)
    }

    const size_class = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm"

    return (
        <div ref={ref} className={`flex flex-wrap gap-1.5 select-none ${className}`} {...props}>
            {items.map((item, index) => {
                const is_selected = item === current_value
                return (
                    <button
                        key={`${item}-${index}`}
                        type="button"
                        aria-pressed={is_selected}
                        onClick={() => handle_click(item)}
                        className={[
                            "cursor-pointer rounded-full border font-medium transition-all duration-150 active:scale-[0.96]",
                            size_class,
                            is_selected
                                ? "border-black bg-black text-white shadow-xs dark:border-white dark:bg-white dark:text-black"
                                : "border-black/10 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white",
                            item_class_name
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        {item}
                    </button>
                )
            })}
        </div>
    )
}

export { FilterChips }
