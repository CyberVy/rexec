"use client"

import { vibrate } from "@/infra/device.client"

import type { CSSProperties, ReactNode, Ref } from "react"

const DEFAULT_TRACK_COLOR = "var(--ui-checkbox-track, #e9e9ea)"
const DEFAULT_CHECKED_COLOR = "var(--ui-checkbox-checked, #34c759)"

export type CheckboxProps = {
    label?: ReactNode
    input_ref?: Ref<HTMLInputElement>
    checked?: boolean
    default_checked?: boolean
    disabled?: boolean
    name?: string
    on_change?: (checked: boolean) => void
    track_color?: string
    checked_color?: string
    className?: string
    ref?: Ref<HTMLLabelElement>
}

const Checkbox = function Checkbox({
    label,
    input_ref,
    checked,
    default_checked,
    disabled,
    name,
    on_change,
    track_color = DEFAULT_TRACK_COLOR,
    checked_color = DEFAULT_CHECKED_COLOR,
    className,
    ref
}: CheckboxProps) {
    return (
        <label
            ref={ref}
            className={[
                "inline-flex select-none items-center gap-3",
                disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                className
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {label}
            <span className="relative h-7.75 w-12.75 shrink-0">
                <input
                    type="checkbox"
                    checked={checked}
                    defaultChecked={default_checked}
                    disabled={disabled}
                    name={name}
                    onChange={(event) => {
                        on_change?.(event.target.checked)
                        vibrate()
                    }}
                    ref={input_ref}
                    className="peer sr-only"
                />
                <span
                    aria-hidden="true"
                    style={
                        {
                            "--checkbox-background-color": track_color,
                            "--checkbox-active-color": checked_color,
                            "--checkbox-active-shadow-color": `color-mix(in srgb, ${checked_color} 35%, transparent)`
                        } as CSSProperties
                    }
                    className={[
                        "pointer-events-none absolute inset-0 rounded-full border border-black/5",
                        "bg-(--checkbox-background-color)",
                        "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04),inset_0_1px_2px_rgba(0,0,0,0.08)]",
                        "transition-all duration-200 ease-out",
                        "peer-focus-visible:shadow-[0_0_0_3px_rgba(10,132,255,0.22),inset_0_1px_0_rgba(255,255,255,0.98),0_0.5px_1px_rgba(0,0,0,0.16),0_3px_8px_rgba(0,0,0,0.08)]",
                        "peer-checked:border-(--checkbox-active-color)",
                        "peer-checked:bg-(--checkbox-active-color)",
                        "peer-checked:shadow-[inset_0_0_0_1px_var(--checkbox-active-shadow-color)]",
                        "peer-disabled:bg-[#f1f1f3] peer-disabled:shadow-none"
                    ]
                        .filter(Boolean)
                        .join(" ")}
                />
                <span
                    aria-hidden="true"
                    className={[
                        "pointer-events-none absolute left-0.5 top-0.5 h-6.75 w-6.75 rounded-full bg-white",
                        "shadow-[0_1px_3px_rgba(0,0,0,0.24),0_0.5px_1px_rgba(0,0,0,0.12)]",
                        "transition-transform duration-300 ease-in-out",
                        "peer-checked:translate-x-5"
                    ]
                        .filter(Boolean)
                        .join(" ")}
                />
            </span>
        </label>
    )
}

export { Checkbox }
