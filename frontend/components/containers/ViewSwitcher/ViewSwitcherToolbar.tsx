"use client"

import type { CSSProperties } from "react"
import { useController } from "../../hooks"
import { HapticContainer } from "../../feedback/HapticContainer"
import { join_classes } from "../../utils"
import {
    INITIAL_VIEW_SWITCHER_STATE,
    resolve_host_status,
    resolve_toolbar_active_color,
    view_switcher_controller
} from "./ViewSwitcherController"
import { is_native_toolbar_active, useNativeToolbar } from "./native_toolbar"
import type { ToolbarColor, ToolbarLayout, View, ViewSwitcherToolbarProps } from "./types"
import styles from "./ViewSwitcher.module.css"

/**
 * Isolated controller subscriber for web and iOS native toolbars.
 * Keeping this subscription out of ViewSwitcher ensures toolbar preview/visibility
 * changes during Step 3-5 never trigger panel tree re-renders.
 */
export function ViewSwitcherToolbarHost<T extends string>({
    switcher_id,
    host_switcher_id,
    host_view_id,
    views,
    active_view_id,
    toolbar_layout,
    toolbar_suppressed,
    active_color,
    on_view_select
}: {
    switcher_id: string
    host_switcher_id: string | null
    host_view_id: string | null
    views: View<T>[]
    active_view_id: T
    toolbar_layout: ToolbarLayout
    toolbar_suppressed: boolean
    active_color?: ToolbarColor
    on_view_select: (view_id: T) => boolean
}) {
    const controller_state = useController(view_switcher_controller, {
        events: "change",
        server_snapshot: INITIAL_VIEW_SWITCHER_STATE
    })

    const { is_host_visible, is_host_transitioning } = resolve_host_status(
        controller_state,
        host_switcher_id,
        host_view_id
    )
    const instance = controller_state.instances[switcher_id]
    const visual_active_view_id = (instance?.preview_view_id as T | null) ?? active_view_id
    const visual_active_view = views.find((view) => view.id === visual_active_view_id)

    const is_interactive = controller_state.active_transition_switcher_id === null
    const is_visible = !visual_active_view?.hide_toolbar && !controller_state.is_toolbar_hidden
    const resolved_active_color = resolve_toolbar_active_color(
        controller_state,
        switcher_id,
        visual_active_view_id,
        visual_active_view?.active_color,
        active_color
    )

    const native_toolbar_active = is_native_toolbar_active()
    useNativeToolbar({
        enabled: native_toolbar_active && is_host_visible && !toolbar_suppressed,
        host_transitioning: is_host_transitioning,
        switcher_id,
        layout: toolbar_layout,
        views,
        active_id: visual_active_view_id,
        active_color: resolved_active_color,
        visible: is_visible,
        interactive: is_interactive,
        on_select: on_view_select
    })

    if (native_toolbar_active || toolbar_suppressed) return null

    return (
        <ViewSwitcherToolbar
            views={views}
            active_view_id={visual_active_view_id}
            toolbar_layout={toolbar_layout}
            visible={is_visible}
            interactive={is_interactive}
            active_color={resolved_active_color}
            on_view_select={on_view_select}
        />
    )
}

/** Presentation only; ViewSwitcherToolbarHost owns reactive controller state. */
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
                "bg-ui-surface-glass backdrop-blur-md",
                "rounded-full",
                padding_class,
                "border border-ui-border shadow-lg",
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
                            : "text-ui-label-strong"
                        : "text-ui-label-secondary"

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
