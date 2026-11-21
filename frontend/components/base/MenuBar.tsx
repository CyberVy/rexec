"use client"

import { vibrate } from "@/infra/device.client"
import { useCallback, useState } from "react"

import type { CSSProperties, ReactNode, Ref } from "react"

const DEFAULT_ACCENT_COLOR = "var(--ui-accent, #0a84ff)"

type VerticalMenuBarItem = {
    // Unique key for selection and React list rendering.
    key: string
    // Primary text content shown in the menu row.
    label: ReactNode
    // Optional secondary text shown below the label.
    description?: ReactNode
    // Optional leading visual, typically an icon.
    icon?: ReactNode
    // Optional badge shown on the right side, such as a count or status.
    badge?: ReactNode
    // Optional trailing content, such as a chevron or shortcut hint.
    trailing?: ReactNode
    // Prevents clicking and dims the visual state.
    disabled?: boolean
    // Visual tone for the item. Destructive renders in red when not selected.
    tone?: "default" | "destructive"
    // Per-item click handler invoked after the component-level on_select.
    on_click?: () => void
}

type VerticalMenuBarSection = {
    // Optional stable key for React list rendering.
    key?: string
    // Optional section heading shown above the item list.
    title?: ReactNode
    // Optional supporting text shown below the section title.
    caption?: ReactNode
    // Items rendered inside this section.
    items: VerticalMenuBarItem[]
}

type VerticalMenuBarProps = {
    sections: VerticalMenuBarSection[]
    selected_key?: string
    default_selected_key?: string
    on_select?: (key: string, item: VerticalMenuBarItem) => void
    header?: ReactNode
    footer?: ReactNode
    enable_vibration?: boolean
    accent_color?: string
    className?: string
    ref?: Ref<HTMLDivElement>
}

function VerticalMenuBar({
    sections,
    selected_key,
    default_selected_key,
    on_select,
    header,
    footer,
    enable_vibration = true,
    accent_color = DEFAULT_ACCENT_COLOR,
    className = "",
    ref
}: VerticalMenuBarProps) {
    const [inner_selected_key, set_inner_selected_key] = useState(default_selected_key)
    const current_selected_key = selected_key ?? inner_selected_key

    const handle_select = useCallback(
        (item: VerticalMenuBarItem) => {
            if (item.disabled) {
                return
            }
            if (enable_vibration) {
                vibrate()
            }
            if (selected_key === undefined) {
                set_inner_selected_key(item.key)
            }
            on_select?.(item.key, item)
            item.on_click?.()
        },
        [enable_vibration, on_select, selected_key]
    )

    return (
        <div
            ref={ref}
            style={
                {
                    "--vertical-menu-accent-color": accent_color,
                    "--vertical-menu-accent-soft-color": `color-mix(in srgb, ${accent_color} 18%, transparent)`,
                    "--vertical-menu-accent-border-color": `color-mix(in srgb, ${accent_color} 28%, white)`,
                    "--vertical-menu-destructive-color": "var(--ui-destructive, #ff3b30)",
                    "--vertical-menu-destructive-hover-color": "var(--ui-destructive-hover, #ff453a)"
                } as CSSProperties
            }
            className={[
                "rounded-2xl border border-black/10 bg-white/80 p-1 text-black/90 shadow-[0_12px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-xl",
                "dark:border-white/10 dark:bg-[#181818]/85 dark:text-white/90 dark:shadow-[0_16px_36px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]",
                className
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {header && <div className="px-2.5 pb-1.5 pt-1 text-black/50 dark:text-white/50">{header}</div>}

            <div className="flex flex-col gap-0.5">
                {sections.map((section, section_index) => {
                    return (
                        <section
                            key={section.key || `${section_index}`}
                            className={[
                                "flex flex-col gap-0.5",
                                section_index > 0 ? "pt-1 mt-0.5 border-t border-black/6 dark:border-white/6" : ""
                            ]
                                .filter(Boolean)
                                .join(" ")}
                        >
                            {(section.title || section.caption) && (
                                <div className="px-2.5 py-1">
                                    {section.title && (
                                        <div className="font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
                                            {section.title}
                                        </div>
                                    )}
                                    {section.caption && (
                                        <div className="mt-0.5 text-black/45 dark:text-white/45">{section.caption}</div>
                                    )}
                                </div>
                            )}

                            <div className="flex flex-col gap-0.5">
                                {section.items.map((item) => {
                                    const is_selected = item.key === current_selected_key
                                    const is_destructive = item.tone === "destructive"

                                    return (
                                        <button
                                            key={item.key}
                                            type="button"
                                            disabled={item.disabled}
                                            aria-current={is_selected ? "page" : undefined}
                                            onClick={() => {
                                                handle_select(item)
                                            }}
                                            className={[
                                                "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150 ease-out",
                                                item.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                                                is_selected
                                                    ? "bg-(--vertical-menu-accent-soft-color) text-(--vertical-menu-accent-color) font-medium"
                                                    : "hover:bg-black/5 active:bg-black/8 active:scale-[0.985] dark:hover:bg-white/10 dark:active:bg-white/15"
                                            ]
                                                .filter(Boolean)
                                                .join(" ")}
                                        >
                                            {item.icon && (
                                                <span
                                                    aria-hidden="true"
                                                    className={[
                                                        "flex shrink-0 items-center justify-center transition-colors duration-150",
                                                        is_selected
                                                            ? "text-(--vertical-menu-accent-color)"
                                                            : "text-black/60 group-hover:text-black/90 dark:text-white/60 dark:group-hover:text-white/90",
                                                        is_destructive && !is_selected
                                                            ? "text-(--vertical-menu-destructive-color) group-hover:text-(--vertical-menu-destructive-hover-color)"
                                                            : ""
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" ")}
                                                >
                                                    {item.icon}
                                                </span>
                                            )}

                                            <span className="min-w-0 flex-1">
                                                <span
                                                    className={[
                                                        "block truncate font-medium",
                                                        is_selected ? "text-(--vertical-menu-accent-color)" : "",
                                                        is_destructive && !is_selected
                                                            ? "text-(--vertical-menu-destructive-color)"
                                                            : ""
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" ")}
                                                >
                                                    {item.label}
                                                </span>
                                                {item.description && (
                                                    <span className="mt-0.5 block truncate text-black/45 dark:text-white/45">
                                                        {item.description}
                                                    </span>
                                                )}
                                            </span>

                                            {(item.badge || item.trailing) && (
                                                <span className="ml-2 flex shrink-0 items-center gap-1.5">
                                                    {item.badge && (
                                                        <span
                                                            className={[
                                                                "rounded-md font-medium",
                                                                is_selected
                                                                    ? "bg-(--vertical-menu-accent-color) text-white"
                                                                    : "bg-black/6 text-black/55 dark:bg-white/10 dark:text-white/65"
                                                            ]
                                                                .filter(Boolean)
                                                                .join(" ")}
                                                        >
                                                            {item.badge}
                                                        </span>
                                                    )}
                                                    {item.trailing && (
                                                        <span className="text-black/35 transition-transform duration-150 group-hover:translate-x-0.5 dark:text-white/35">
                                                            {item.trailing}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </section>
                    )
                })}
            </div>

            {footer && (
                <div className="px-2.5 pb-1 pt-1.5 border-t border-black/6 dark:border-white/6 text-black/50 dark:text-white/50">
                    {footer}
                </div>
            )}
        </div>
    )
}

VerticalMenuBar.displayName = "VerticalMenuBar"

export type { VerticalMenuBarItem, VerticalMenuBarProps, VerticalMenuBarSection }
export { VerticalMenuBar }
