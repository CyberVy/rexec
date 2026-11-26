"use client"

import { useCallback, useState } from "react"
import { Popover } from "../presentation/Popover"
import { join_classes } from "../utils"
import { Text } from "../views/Text"
import { Button } from "./Button"
import { Menu } from "./Menu"

import type { ReactNode, Ref } from "react"
import type { MenuItem } from "./Menu"

export type SelectOption<T extends string = string> = {
    value: T
    label: ReactNode
    description?: ReactNode
    icon?: ReactNode
    disabled?: boolean
}

export type SelectProps<T extends string = string> = {
    options: SelectOption<T>[]
    value?: T
    default_value?: T
    on_change?: (value: T, option: SelectOption<T>) => void
    placeholder?: ReactNode
    indicator?: ReactNode
    selected_indicator?: ReactNode
    disabled?: boolean
    align?: "left" | "right"
    placement?: "bottom" | "top"
    menu_class_name?: string
    trigger_class_name?: string
    className?: string
    aria_label?: string
    ref?: Ref<HTMLDivElement>
}

const PANEL_POSITION_CLASS: Record<"bottom" | "top", Record<"left" | "right", string>> = {
    bottom: {
        left: "top-full left-0 mt-1.5 origin-top-left",
        right: "top-full right-0 mt-1.5 origin-top-right"
    },
    top: {
        left: "bottom-full left-0 mb-1.5 origin-bottom-left",
        right: "bottom-full right-0 mb-1.5 origin-bottom-right"
    }
}

/**
 * Pull-down option picker composed from Button, Popover, and Menu.
 * Icon-agnostic: callers provide their own trigger/selected indicators if desired.
 */
function Select<T extends string = string>({
    options,
    value: controlled_value,
    default_value,
    on_change,
    placeholder,
    indicator,
    selected_indicator,
    disabled = false,
    align = "right",
    placement = "bottom",
    menu_class_name,
    trigger_class_name,
    className,
    aria_label,
    ref
}: SelectProps<T>) {
    const [is_open, set_is_open] = useState(false)
    const [internal_value, set_internal_value] = useState<T | undefined>(default_value)
    const current_value = controlled_value !== undefined ? controlled_value : internal_value
    const selected_option = options.find((opt) => opt.value === current_value)

    const handle_select = useCallback(
        (key: string) => {
            const matched = options.find((opt) => opt.value === key)
            if (!matched || matched.disabled) return
            if (controlled_value === undefined) {
                set_internal_value(matched.value)
            }
            on_change?.(matched.value, matched)
            set_is_open(false)
        },
        [controlled_value, on_change, options]
    )

    const menu_items: MenuItem[] = options.map((opt) => ({
        key: opt.value,
        icon: opt.icon,
        label: (
            <Text variant="caption" weight="medium" tone="inherit" truncate>
                {opt.label}
            </Text>
        ),
        description: opt.description ? (
            <Text variant="footnote" tone="secondary" truncate>
                {opt.description}
            </Text>
        ) : undefined,
        trailing: opt.value === current_value ? selected_indicator : undefined,
        disabled: opt.disabled
    }))

    return (
        <Popover
            ref={ref}
            open={is_open && !disabled}
            on_close={() => set_is_open(false)}
            className={className}
            panel_class_name={PANEL_POSITION_CLASS[placement][align]}
            trigger={
                <Button
                    variant="secondary"
                    size="auto"
                    disabled={disabled}
                    aria-label={aria_label}
                    aria-haspopup="listbox"
                    aria-expanded={is_open}
                    onClick={() => {
                        if (!disabled) set_is_open((prev) => !prev)
                    }}
                    className={join_classes("px-2.5 py-1.5 text-xs font-medium", trigger_class_name)}
                >
                    <span className="flex w-full items-center justify-between gap-2">
                        <span className="truncate">{selected_option ? selected_option.label : placeholder}</span>
                        {indicator != null && (
                            <span
                                aria-hidden="true"
                                className={join_classes(
                                    "inline-flex shrink-0 items-center transition-transform duration-200",
                                    is_open && "rotate-180"
                                )}
                            >
                                {indicator}
                            </span>
                        )}
                    </span>
                </Button>
            }
        >
            <Menu
                className={join_classes(
                    "min-w-36 w-max max-h-60 overflow-y-auto overscroll-none no-scrollbar shadow-2xl",
                    menu_class_name
                )}
                accent_color="var(--ui-label-strong)"
                selected_key={current_value}
                on_select={handle_select}
                sections={[{ items: menu_items }]}
            />
        </Popover>
    )
}

export { Select }
