"use client"

import { useState } from "react"
import { vibrate } from "@/infra/device.client"
import type { KeyboardEvent, ReactNode, Ref } from "react"

export type StringInputProps = {
    value?: string
    default_value?: string
    placeholder: string
    clear_label: string
    clear_icon: ReactNode
    icon?: ReactNode
    show_clear?: boolean
    submit_button?: ReactNode
    on_change?: (value: string) => void
    on_submit?: (value: string) => void
    auto_focus?: boolean
    input_ref?: Ref<HTMLInputElement>
    shape?: "field" | "pill"
    className?: string
    ref?: Ref<HTMLDivElement>
}

function StringInput({
    value: controlled_value,
    default_value = "",
    placeholder,
    clear_label,
    clear_icon,
    icon,
    show_clear = true,
    submit_button,
    on_change,
    on_submit,
    auto_focus = false,
    input_ref,
    shape = "field",
    className = "",
    ref
}: StringInputProps) {
    const [internal_value, set_internal_value] = useState(
        controlled_value !== undefined ? controlled_value : default_value
    )
    const [prev_controlled_value, set_prev_controlled_value] = useState(controlled_value)

    if (controlled_value !== prev_controlled_value) {
        set_prev_controlled_value(controlled_value)
        if (controlled_value !== undefined) {
            set_internal_value(controlled_value)
        }
    }

    const is_controlled = controlled_value !== undefined
    const current_value = is_controlled ? controlled_value : internal_value

    const handle_change = (new_value: string) => {
        if (!is_controlled) {
            set_internal_value(new_value)
        }
        on_change?.(new_value)
    }

    const handle_clear = () => {
        vibrate()
        if (!is_controlled) {
            set_internal_value("")
        }
        on_change?.("")
    }

    const handle_submit = () => {
        vibrate()
        on_submit?.(current_value)
    }

    const handle_key_down = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === "Enter") {
            event.currentTarget.blur()
            on_submit?.(current_value)
        }
    }

    const is_clear_visible = Boolean(show_clear && current_value)
    const is_submit_visible = Boolean(submit_button)

    let right_padding = "pr-3.5"
    if (is_clear_visible && is_submit_visible) {
        right_padding = "pr-18"
    } else if (is_submit_visible) {
        right_padding = "pr-11"
    } else if (is_clear_visible) {
        right_padding = "pr-9"
    }

    const shape_class = shape === "pill" ? "rounded-full" : "rounded-xl"

    return (
        <div
            ref={ref}
            className={`relative flex items-center w-full py-2 border border-black/10 dark:border-white/10 focus-within:ring-1 focus-within:ring-black/30 dark:focus-within:ring-white/30 ${shape_class} ${className}`}
        >
            {icon && (
                <div className="absolute left-3.5 flex items-center pointer-events-none text-black/40 dark:text-white/40 z-10">
                    {icon}
                </div>
            )}
            <input
                ref={input_ref}
                type="text"
                autoFocus={auto_focus}
                placeholder={placeholder}
                value={current_value}
                onChange={(event) => handle_change(event.target.value)}
                onKeyDown={handle_key_down}
                className={`w-full bg-transparent focus:outline-none transition-all duration-200 text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 ${
                    icon ? "pl-9" : "pl-3.5"
                } ${right_padding}`}
            />
            {(is_clear_visible || is_submit_visible) && (
                <div className="absolute right-2.5 flex items-center gap-1.5 z-10">
                    {is_clear_visible && (
                        <button
                            type="button"
                            onClick={handle_clear}
                            aria-label={clear_label}
                            className="flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-black/40 dark:text-white/40 transition-colors cursor-pointer"
                        >
                            {clear_icon}
                        </button>
                    )}
                    {is_submit_visible && (
                        <button
                            type="button"
                            onClick={handle_submit}
                            className="flex items-center justify-center p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-black/60 dark:text-white/60 transition-colors cursor-pointer"
                        >
                            {submit_button}
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}

export { StringInput }
