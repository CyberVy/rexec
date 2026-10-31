"use client"

import { useState } from "react"
import { SearchIcon } from "@/components/icons"
import { vibrate } from "@/infra/device.client"

export type StringInputProps = Omit<React.ComponentPropsWithRef<"div">, "children"> & {
    value?: string
    default_value?: string
    placeholder?: string
    icon?: React.ReactNode
    show_clear?: boolean
    submit_button?: boolean | React.ReactNode
    on_change?: (value: string) => void
    on_submit?: (value: string) => void
    input_ref?: React.Ref<HTMLInputElement>
    input_class_name?: string
}

function StringInput({
    value: controlled_value,
    default_value = "",
    placeholder = "",
    icon,
    show_clear = true,
    submit_button,
    on_change,
    on_submit,
    input_ref,
    className = "",
    input_class_name = "",
    ref,
    ...props
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

    const current_value = controlled_value !== undefined ? controlled_value : internal_value

    const handle_change = (new_value: string) => {
        set_internal_value(new_value)
        on_change?.(new_value)
    }

    const handle_clear = () => {
        vibrate()
        set_internal_value("")
        on_change?.("")
    }

    const handle_submit = () => {
        vibrate()
        on_submit?.(current_value)
    }

    const handle_key_down = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.currentTarget.blur()
            on_submit?.(current_value)
        }
    }

    const is_clear_visible = Boolean(show_clear && current_value)
    const is_submit_visible = Boolean(submit_button)

    let right_padding = "pr-3.5"
    if (is_clear_visible && is_submit_visible) {
        right_padding = "pr-16"
    } else if (is_clear_visible || is_submit_visible) {
        right_padding = "pr-9"
    }

    return (
        <div {...props} ref={ref} className={`relative flex items-center w-full ${className}`}>
            {icon && (
                <div className="absolute left-3.5 flex items-center pointer-events-none text-black/40 dark:text-white/40 z-10">
                    {icon}
                </div>
            )}
            <input
                ref={input_ref}
                type="text"
                placeholder={placeholder}
                value={current_value}
                onChange={(e) => handle_change(e.target.value)}
                onKeyDown={handle_key_down}
                className={`w-full text-sm bg-transparent focus:outline-none transition-all duration-200 text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 ${input_class_name} ${
                    icon ? "pl-9" : "pl-3.5"
                } ${right_padding}`}
            />
            {is_clear_visible && (
                <button
                    type="button"
                    onClick={handle_clear}
                    className={`absolute flex items-center justify-center w-5 h-5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-black/40 dark:text-white/40 transition-colors cursor-pointer z-10 ${
                        is_submit_visible ? "right-12" : "right-3"
                    }`}
                >
                    ✕
                </button>
            )}
            {is_submit_visible && (
                <button
                    type="button"
                    onClick={handle_submit}
                    className="absolute right-2.5 flex items-center justify-center p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-black/60 dark:text-white/60 transition-colors cursor-pointer z-10"
                >
                    {typeof submit_button === "boolean" ? <SearchIcon width={24} height={24} /> : submit_button}
                </button>
            )}
        </div>
    )
}

export { StringInput }
