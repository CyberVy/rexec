"use client"

import { useState } from "react"
import { HapticContainer } from "../feedback/HapticContainer"
import { join_classes } from "../utils"
import type { KeyboardEvent, ReactNode, Ref } from "react"

export type TextFieldProps = {
    value?: string
    default_value?: string
    placeholder?: string
    clear_label?: string
    clear_icon?: ReactNode
    icon?: ReactNode
    show_clear?: boolean
    submit_button?: ReactNode
    on_change?: (value: string) => void
    on_submit?: (value: string) => void
    auto_focus?: boolean
    input_ref?: Ref<HTMLInputElement>
    input_class_name?: string
    shape?: "field" | "pill"
    className?: string
    ref?: Ref<HTMLDivElement>
}

function TextField({
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
    input_class_name,
    shape = "field",
    className,
    ref
}: TextFieldProps) {
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
        if (!is_controlled) {
            set_internal_value("")
        }
        on_change?.("")
    }

    const handle_submit = () => {
        on_submit?.(current_value)
    }

    const handle_key_down = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === "Enter") {
            event.currentTarget.blur()
            on_submit?.(current_value)
        }
    }

    const is_clear_visible = Boolean(show_clear && clear_icon && current_value)
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
            className={join_classes(
                "relative flex items-center w-full py-2 border border-(--ui-border) focus-within:ring-1 focus-within:ring-(--ui-border-strong)",
                shape_class,
                className
            )}
        >
            {icon && (
                <div className="absolute left-3.5 flex items-center pointer-events-none text-(--ui-tertiary-label) z-10">
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
                className={join_classes(
                    "w-full bg-transparent focus:outline-none transition-all duration-200 text-black dark:text-white placeholder:text-(--ui-tertiary-label)",
                    icon ? "pl-9" : "pl-3.5",
                    right_padding,
                    input_class_name
                )}
            />
            {(is_clear_visible || is_submit_visible) && (
                <div className="absolute right-2.5 flex items-center gap-1.5 z-10">
                    {is_clear_visible && (
                        <button
                            type="button"
                            onClick={handle_clear}
                            aria-label={clear_label}
                            className="flex items-center justify-center rounded-full hover:bg-(--ui-fill-hover) text-(--ui-tertiary-label) transition-colors cursor-pointer"
                        >
                            <HapticContainer>
                                <span className="flex items-center justify-center">{clear_icon}</span>
                            </HapticContainer>
                        </button>
                    )}
                    {is_submit_visible && (
                        <button
                            type="button"
                            onClick={handle_submit}
                            className="flex items-center justify-center p-1 rounded-full hover:bg-(--ui-fill-hover) text-black/60 dark:text-white/60 transition-colors cursor-pointer"
                        >
                            <HapticContainer>
                                <span className="flex items-center justify-center">{submit_button}</span>
                            </HapticContainer>
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}

export { TextField }
