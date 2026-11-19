"use client"

import type { CSSProperties } from "react"
import { HapticContainer } from "@/components/base/HapticContainer"
import { join_classes } from "@/components/utils"
import type { ViewSwitcherToolbarProps } from "./types"
import styles from "./ViewSwitcher.module.css"

/** Presentation only; the parent owns navigation rules and transition state. */
export function ViewSwitcherToolbar<T extends string>({
    views,
    active_view_id,
    toolbar_layout,
    visible,
    interactive,
    active_color,
    on_view_select
}: ViewSwitcherToolbarProps<T>) {
    const is_top = toolbar_layout === "top-floating"
    // Bottom width is 220px: 64px cells plus 14px of padding and border on each side.
    const padding_class = is_top ? "p-0.5" : "px-[9px] py-1"
    const items_spacing_class = is_top ? "p-0.5 gap-0.5" : "p-1"
    const item_radius_class = is_top ? "rounded-[14px]" : "rounded-[18px]"
    // Bottom capsule is 61px: 43px cell, 8px padding on each side, and a 1px border.
    // That matches the native glass height. Top cells follow the label between 80px and 120px.
    const item_size_class = is_top ? "w-[clamp(80px,22vw,120px)] h-7" : "w-16 h-[43px]"
    const glyph_class = is_top ? "" : "[&_svg]:!size-[25px]"

    return (
        <div
            className={join_classes(
                is_top ? styles["viewswitcher-toolbar-top"] : styles["viewswitcher-toolbar-bottom"],
                "fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5",
                "bg-white/40 dark:bg-black/40 backdrop-blur-md",
                "rounded-full",
                padding_class,
                "border border-black/10 dark:border-white/10 shadow-lg",
                styles["viewswitcher-toolbar"],
                !visible && styles["toolbar-hidden"]
            )}
        >
            <div
                className={join_classes(
                    "inline-flex flex-row items-center bg-background/0! backdrop-blur-none!",
                    items_spacing_class
                )}
            >
                {views.map((view) => {
                    const is_active = view.id === active_view_id
                    const custom_active_style =
                        is_active && active_color
                            ? ({
                                  "--viewswitcher-active-light": active_color.light,
                                  "--viewswitcher-active-dark": active_color.dark
                              } as CSSProperties)
                            : undefined
                    const text_class = is_active
                        ? active_color
                            ? styles["toolbar-item-active-custom"]
                            : "text-black dark:text-white"
                        : "text-black/50 dark:text-white/50"

                    return (
                        <button
                            key={view.id}
                            type="button"
                            className="focus-visible:outline-none disabled:pointer-events-none"
                            disabled={!interactive || is_active}
                            onClick={() => on_view_select(view.id)}
                        >
                            <HapticContainer>
                                <span
                                    className={join_classes(
                                        "relative align-middle inline-block px-4 overflow-hidden",
                                        item_radius_class,
                                        "transition duration-300 ease-in-out hover:cursor-pointer",
                                        item_size_class
                                    )}
                                >
                                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
                                        <span
                                            style={custom_active_style}
                                            className={join_classes(
                                                "flex flex-col items-center justify-center transition-all",
                                                glyph_class,
                                                text_class
                                            )}
                                        >
                                            {view.icon}
                                            {view.label && (
                                                <span
                                                    className={join_classes(
                                                        view.icon
                                                            ? "text-[10px] mt-0.5 font-medium leading-none"
                                                            : "text-[10px] sm:text-xs font-semibold",
                                                        is_active && !view.icon ? "font-bold" : ""
                                                    )}
                                                >
                                                    {view.label}
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                </span>
                            </HapticContainer>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
