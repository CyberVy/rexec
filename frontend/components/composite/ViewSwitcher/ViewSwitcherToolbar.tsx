"use client"

import { HapticContainer } from "@/components/base/HapticContainer"
import { join_classes } from "@/components/utils"
import type { ViewSwitcherToolbarProps } from "./types"
import styles from "./ViewSwitcher.module.css"

export type { ViewSwitcherToolbarProps } from "./types"

/** Presentation only; the parent owns navigation rules and transition state. */
export function ViewSwitcherToolbar<T extends string>({
    views,
    active_view_id,
    is_toolbar_visible,
    is_navigation_disabled,
    on_view_select,
    toolbar_layout,
    toolbar_extra_actions,
    toolbar_className,
    toolbar_item_className
}: ViewSwitcherToolbarProps<T>) {
    const is_top = toolbar_layout === "top-floating"
    const padding_class = is_top ? "p-0.5" : "p-1"
    const items_spacing_class = is_top ? "p-0.5 gap-0.5" : "p-1"
    const item_radius_class = is_top ? "rounded-[14px]" : "rounded-[18px]"
    const item_size_class = is_top ? "w-16 h-7" : "w-16 h-10"

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
                !is_toolbar_visible && styles["toolbar-hidden"],
                toolbar_className
            )}
        >
            <div className={join_classes("rounded-full border border-black/10 dark:border-white/10", padding_class)}>
                <div
                    className={join_classes(
                        "inline-flex flex-row items-center bg-background/0! backdrop-blur-none!",
                        items_spacing_class
                    )}
                >
                    {views.map((view) => {
                        const is_active = view.id === active_view_id
                        const active_text_class = view.icon
                            ? "text-red-700 dark:text-red-500"
                            : "text-black dark:text-white"
                        const text_class = is_active ? active_text_class : "text-black/50 dark:text-white/50"
                        return (
                            <button
                                key={view.id}
                                type="button"
                                className="focus-visible:outline-none disabled:pointer-events-none"
                                disabled={is_navigation_disabled || is_active}
                                onClick={() => on_view_select(view.id)}
                            >
                                <HapticContainer>
                                    <span
                                        className={join_classes(
                                            "relative align-middle inline-block px-4 overflow-hidden",
                                            item_radius_class,
                                            "transition duration-300 ease-in-out hover:cursor-pointer",
                                            toolbar_item_className ?? item_size_class
                                        )}
                                    >
                                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
                                            <span
                                                className={join_classes(
                                                    "flex flex-col items-center justify-center transition-all",
                                                    text_class
                                                )}
                                            >
                                                {view.icon}
                                                {view.label && (
                                                    <span
                                                        className={join_classes(
                                                            view.icon
                                                                ? "text-[9px] mt-0.5 font-medium"
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

            {toolbar_extra_actions && (
                <>
                    <div className="w-px h-6 bg-black/15 dark:bg-white/15" />
                    <div className="flex items-center justify-center">{toolbar_extra_actions}</div>
                </>
            )}
        </div>
    )
}
