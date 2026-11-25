"use client"

import { useCallback, useState } from "react"
import { HapticContainer } from "../feedback/HapticContainer"
import { join_classes } from "../utils"
import { Text } from "../views/Text"

import type { CSSProperties, ReactNode, Ref } from "react"

const DEFAULT_ACCENT_COLOR = "var(--ui-accent, #0a84ff)"

export type MenuItem = {
    key: string
    label: ReactNode
    description?: ReactNode
    icon?: ReactNode
    badge?: ReactNode
    trailing?: ReactNode
    disabled?: boolean
    tone?: "default" | "destructive"
    on_click?: () => void
}

export type MenuSection = {
    key?: string
    title?: ReactNode
    caption?: ReactNode
    items: MenuItem[]
}

export type MenuProps = {
    sections: MenuSection[]
    selected_key?: string
    default_selected_key?: string
    on_select?: (key: string, item: MenuItem) => void
    header?: ReactNode
    footer?: ReactNode
    enable_haptic?: boolean
    accent_color?: string
    className?: string
    ref?: Ref<HTMLDivElement>
}

function Menu({
    sections,
    selected_key,
    default_selected_key,
    on_select,
    header,
    footer,
    enable_haptic = true,
    accent_color = DEFAULT_ACCENT_COLOR,
    className,
    ref
}: MenuProps) {
    const [inner_selected_key, set_inner_selected_key] = useState(default_selected_key)
    const current_selected_key = selected_key ?? inner_selected_key

    const handle_select = useCallback(
        (item: MenuItem) => {
            if (item.disabled) {
                return
            }
            if (selected_key === undefined) {
                set_inner_selected_key(item.key)
            }
            on_select?.(item.key, item)
            item.on_click?.()
        },
        [on_select, selected_key]
    )

    return (
        <div
            ref={ref}
            style={
                {
                    "--menu-accent-color": accent_color,
                    "--menu-accent-soft-color": `color-mix(in srgb, ${accent_color} 18%, transparent)`,
                    "--menu-destructive-color": "var(--ui-destructive, #ff3b30)",
                    "--menu-destructive-hover-color": "var(--ui-destructive-hover, #ff453a)"
                } as CSSProperties
            }
            className={join_classes(
                "rounded-2xl border border-(--ui-border) bg-(--ui-surface-elevated) p-1 text-(--ui-label) shadow-[0_12px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-xl",
                "dark:shadow-[0_16px_36px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]",
                className
            )}
        >
            {header && <div className="px-2.5 pb-1.5 pt-1">{header}</div>}

            <div className="flex flex-col gap-0.5">
                {sections.map((section, section_index) => (
                    <section
                        key={section.key || `${section_index}`}
                        className={join_classes(
                            "flex flex-col gap-0.5",
                            section_index > 0 && "pt-1 mt-0.5 border-t border-(--ui-separator)"
                        )}
                    >
                        {(section.title || section.caption) && (
                            <div className="flex flex-col gap-0.5 px-2.5 py-1">
                                {typeof section.title === "string" ? (
                                    <Text variant="overline" tone="tertiary" truncate>
                                        {section.title}
                                    </Text>
                                ) : (
                                    section.title
                                )}
                                {typeof section.caption === "string" ? (
                                    <Text variant="footnote" tone="secondary">
                                        {section.caption}
                                    </Text>
                                ) : (
                                    section.caption
                                )}
                            </div>
                        )}

                        <div className="flex flex-col gap-0.5">
                            {section.items.map((item) => {
                                const is_selected = item.key === current_selected_key
                                const is_destructive = item.tone === "destructive"

                                const item_content = (
                                    <span className="flex w-full items-center gap-2.5">
                                        {item.icon && (
                                            <span
                                                aria-hidden="true"
                                                className={join_classes(
                                                    "flex shrink-0 items-center justify-center transition-colors duration-150",
                                                    is_selected
                                                        ? "text-(--menu-accent-color)"
                                                        : "text-black/60 group-hover:text-black/90 dark:text-white/60 dark:group-hover:text-white/90",
                                                    is_destructive &&
                                                        !is_selected &&
                                                        "text-(--menu-destructive-color) group-hover:text-(--menu-destructive-hover-color)"
                                                )}
                                            >
                                                {item.icon}
                                            </span>
                                        )}

                                        <span className="flex min-w-0 flex-1 flex-col">
                                            {typeof item.label === "string" ? (
                                                <Text variant="callout" tone="inherit" truncate>
                                                    {item.label}
                                                </Text>
                                            ) : (
                                                item.label
                                            )}
                                            {typeof item.description === "string" ? (
                                                <Text variant="footnote" tone="secondary" truncate>
                                                    {item.description}
                                                </Text>
                                            ) : (
                                                item.description
                                            )}
                                        </span>

                                        {(item.badge || item.trailing) && (
                                            <span className="ml-2 flex shrink-0 items-center gap-1.5">
                                                {item.badge}
                                                {item.trailing && (
                                                    <span className="transition-transform duration-150 group-hover:translate-x-0.5">
                                                        {item.trailing}
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                    </span>
                                )

                                return (
                                    <button
                                        key={item.key}
                                        type="button"
                                        disabled={item.disabled}
                                        aria-current={is_selected ? "page" : undefined}
                                        onClick={() => handle_select(item)}
                                        className={join_classes(
                                            "group relative flex w-full items-center rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150 ease-out",
                                            item.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                                            is_selected
                                                ? "bg-(--menu-accent-soft-color) text-(--menu-accent-color)"
                                                : "hover:bg-(--ui-fill-subtle) active:bg-black/8 active:scale-[0.985] dark:active:bg-white/15",
                                            is_destructive && !is_selected && "text-(--menu-destructive-color)"
                                        )}
                                    >
                                        {enable_haptic ? (
                                            <HapticContainer disabled={item.disabled}>{item_content}</HapticContainer>
                                        ) : (
                                            item_content
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </section>
                ))}
            </div>

            {footer && <div className="border-t border-(--ui-separator) px-2.5 pt-1.5 pb-1">{footer}</div>}
        </div>
    )
}

Menu.displayName = "Menu"

export { Menu }
