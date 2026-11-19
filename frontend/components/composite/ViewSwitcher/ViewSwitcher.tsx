"use client"

import { createContext, useState, useEffect, useLayoutEffect, useCallback, useContext, useId, useRef } from "react"
import type { ComponentPropsWithoutRef } from "react"
import { useController, useMergedRef } from "@/components/hooks"
import { join_classes } from "@/components/utils"
import {
    INITIAL_VIEW_SWITCHER_STATE,
    resolve_toolbar_active_color,
    view_switcher_controller
} from "./ViewSwitcherController"
import { is_native_toolbar_active, useNativeToolbar } from "./native_toolbar"
import { ViewSwitcherToolbar } from "./ViewSwitcherToolbar"
import { useViewSwipeGesture, compute_view_render_config, is_in_overscroll } from "./useViewSwipeGesture"
import type { SwitchViewEventDetail, ViewSwitcherProps } from "./types"

interface HostContextValue {
    switcher_id: string | null
    is_visible: boolean
    is_transitioning: boolean
    is_toolbar_hidden: boolean
}

const ViewSwitcherHostContext = createContext<HostContextValue>({
    switcher_id: null,
    is_visible: true,
    is_transitioning: false,
    is_toolbar_hidden: false
})

const overscroll_disabled_switchers = new Set<string>()

function sync_root_overscroll(): void {
    if (typeof document === "undefined") return
    document.documentElement.style.overscrollBehaviorY = overscroll_disabled_switchers.size > 0 ? "none" : ""
}

function useRootOverscrollLock(switcher_id: string, disabled: boolean): void {
    useEffect(() => {
        if (!disabled) return
        overscroll_disabled_switchers.add(switcher_id)
        sync_root_overscroll()
        return () => {
            overscroll_disabled_switchers.delete(switcher_id)
            sync_root_overscroll()
        }
    }, [switcher_id, disabled])
}

/**
 * ARCHITECTURAL DESIGN NOTE: Window Scroll vs. Container Scroll on iOS Safari
 *
 * We use global Window Scroll instead of container scroll (`overflow-y: auto` on views)
 * because container scroll on iOS Safari behaves unpredictably:
 * 1. It causes nested scroll chaining (momentum overscroll conflicts between body and container).
 * 2. Fixed elements (like bottom toolbars) fail to anchor correctly relative to Safe Areas because
 *    iOS requires document-level scrolling to dynamically fold/unfold browser bars.
 *
 * How we animate horizontal swipe transitions with Window Scroll:
 * 1. Transitioning views are set to `position: "fixed"` to pull them out of the document flow
 *    so they can be placed side-by-side (`left: 0` vs `left: 100% / -100%`).
 * 2. Since `fixed` elements stay static relative to the viewport, we manually offset their `top`
 *    by subtracting the active/target scroll positions to align them vertically.
 * 3. A height spacer placeholder is rendered at the bottom of the container to prevent the document height
 *    from collapsing to 0 during transition (which would reset `window.scrollY` to 0).
 */
export function ViewSwitcher<T extends string = string>({
    id,
    views,
    active_view_id,
    default_active_view_id,
    on_view_change,
    keep_alive_default = false,
    remember_scroll = true,
    className,
    toolbar_layout = "bottom-floating",
    toolbar_hidden = false,
    active_color,
    ref,
    ...props
}: ViewSwitcherProps<T>) {
    const fallback_id = useId()
    const switcher_instance_id = id ?? fallback_id
    const {
        switcher_id: host_switcher_id,
        is_visible: is_host_visible,
        is_transitioning: is_host_transitioning,
        is_toolbar_hidden: is_host_toolbar_hidden
    } = useContext(ViewSwitcherHostContext)

    const [internal_active_view_id, set_internal_active_view_id] = useState<T>(default_active_view_id ?? views[0]?.id)
    const current_active_view_id = active_view_id !== undefined ? active_view_id : internal_active_view_id

    const container_element_ref = useRef<HTMLDivElement | null>(null)
    const set_container_element_ref = useMergedRef(container_element_ref, ref)

    const scroll_positions_ref = useRef<Record<string, number>>({})
    const is_switching_view_ref = useRef<boolean>(false)

    const active_view_index = views.findIndex((v) => v.id === current_active_view_id)
    const active_view = views[active_view_index]
    const active_view_keep_alive = active_view?.keep_alive ?? keep_alive_default
    const active_view_remember_scroll = active_view_keep_alive && (active_view?.remember_scroll ?? remember_scroll)
    const active_swipe_enabled = active_view?.swipe_enabled ?? true
    const active_overscroll_enabled = active_view?.overscroll_enabled ?? true

    const commit_view_change = useCallback(
        (view_id: T) => {
            if (active_view_id === undefined) set_internal_active_view_id(view_id)
            on_view_change?.(view_id)
        },
        [active_view_id, on_view_change]
    )

    const { transition_state, is_transitioning, set_view_element, handle_transition_end, reset_transition } =
        useViewSwipeGesture({
            switcher_instance_id,
            views,
            current_active_view_id,
            active_view_index,
            active_swipe_enabled,
            container_element_ref,
            scroll_positions_ref,
            commit_view_change
        })

    useRootOverscrollLock(switcher_instance_id, is_host_visible && !active_overscroll_enabled)

    // Window scroll listener: records scroll position for keep-alive views
    useEffect(() => {
        if (!active_view_remember_scroll) return
        const handle_scroll = () => {
            if (!is_host_visible || is_switching_view_ref.current || is_transitioning) return
            scroll_positions_ref.current[current_active_view_id] = window.scrollY
        }

        window.addEventListener("scroll", handle_scroll, { passive: true })
        return () => window.removeEventListener("scroll", handle_scroll)
    }, [is_host_visible, current_active_view_id, active_view_remember_scroll, is_transitioning])

    // Restore scroll position synchronously pre-paint on active view change or transition end
    useLayoutEffect(() => {
        if (!is_host_visible || is_transitioning) return

        is_switching_view_ref.current = true

        const target_scroll_y = active_view_remember_scroll
            ? (scroll_positions_ref.current[current_active_view_id] ?? 0)
            : 0
        window.scrollTo(0, target_scroll_y)
        scroll_positions_ref.current[current_active_view_id] = target_scroll_y

        is_switching_view_ref.current = false
    }, [is_host_visible, current_active_view_id, active_view_remember_scroll, is_transitioning])

    const controller_state = useController(view_switcher_controller, {
        events: "change",
        server_snapshot: INITIAL_VIEW_SWITCHER_STATE
    })

    const switch_view = useCallback(
        (target_view_id: string) => {
            const target = views.find((v) => v.id === target_view_id)
            if (!target) return
            reset_transition()
            commit_view_change(target.id)
        },
        [views, reset_transition, commit_view_change]
    )

    // Register instance with controller on mount
    useEffect(() => {
        return view_switcher_controller.register({
            id: switcher_instance_id,
            parent_id: host_switcher_id,
            active_view_id: current_active_view_id,
            is_transitioning
        })
    }, [switcher_instance_id])

    // Keep parent_id and active_view_id synced in controller
    useLayoutEffect(() => {
        view_switcher_controller.update_instance(switcher_instance_id, {
            parent_id: host_switcher_id,
            active_view_id: current_active_view_id
        })
    }, [switcher_instance_id, host_switcher_id, current_active_view_id])

    // React to imperative switch_view events from controller
    useEffect(() => {
        const handle_switch = (e: Event) => {
            const custom_event = e as CustomEvent<SwitchViewEventDetail>
            if (!custom_event.detail || custom_event.detail.switcher_id !== switcher_instance_id) return
            switch_view(custom_event.detail.view_id)
        }
        view_switcher_controller.addEventListener("switch_view", handle_switch)
        return () => {
            view_switcher_controller.removeEventListener("switch_view", handle_switch)
        }
    }, [switcher_instance_id, switch_view])

    const has_other_transitioning = view_switcher_controller.has_other_transitioning(switcher_instance_id)
    const is_toolbar_interactive = !is_transitioning && !has_other_transitioning
    const is_toolbar_visible = !active_view?.hide_toolbar && !controller_state.is_toolbar_hidden
    const is_toolbar_suppressed = is_host_toolbar_hidden || toolbar_hidden
    const resolved_active_color = resolve_toolbar_active_color(
        controller_state,
        switcher_instance_id,
        current_active_view_id,
        active_view?.active_color,
        active_color
    )

    const handle_toolbar_click = (view_id: T): boolean => {
        if (!is_toolbar_interactive || view_id === current_active_view_id) return false
        if (is_in_overscroll()) return false

        commit_view_change(view_id)
        return true
    }

    const native_toolbar_active = is_native_toolbar_active()
    useNativeToolbar({
        enabled: native_toolbar_active && is_host_visible && !is_toolbar_suppressed,
        host_transitioning: is_host_transitioning,
        switcher_id: switcher_instance_id,
        layout: toolbar_layout,
        views,
        active_id: current_active_view_id,
        active_color: resolved_active_color,
        visible: is_toolbar_visible,
        interactive: is_toolbar_interactive,
        on_select: handle_toolbar_click
    })

    const is_subtree_transitioning = is_host_transitioning || is_transitioning

    return (
        <div
            ref={set_container_element_ref}
            className={join_classes("w-full min-h-[calc(100vh-env(safe-area-inset-top))]", className)}
            {...props}
        >
            {views.map((view) => {
                const render_config = compute_view_render_config(
                    view,
                    current_active_view_id,
                    keep_alive_default,
                    transition_state
                )
                if (!render_config) return null

                const is_panel_visible =
                    is_host_visible && transition_state.status === "idle" && view.id === current_active_view_id

                return (
                    <ViewSwitcherHostContext
                        key={view.id}
                        value={{
                            switcher_id: switcher_instance_id,
                            is_visible: is_panel_visible,
                            is_transitioning: is_subtree_transitioning,
                            is_toolbar_hidden: is_toolbar_suppressed
                        }}
                    >
                        <ViewSwitcherPanel
                            view_id={view.id}
                            on_element_ref={set_view_element}
                            className={render_config.view_class}
                            style={render_config.style}
                            onTransitionEnd={
                                render_config.is_view_active_in_transition ? handle_transition_end : undefined
                            }
                        >
                            {view.content}
                        </ViewSwitcherPanel>
                    </ViewSwitcherHostContext>
                )
            })}

            {/* Spacer to prevent document height collapse and window.scrollY reset during fixed transition */}
            {transition_state.status !== "idle" && (
                <div
                    className="w-full min-h-[calc(100vh-env(safe-area-inset-top))]"
                    style={{
                        height: Math.max(
                            transition_state.active_view_height,
                            (transition_state.prev_view_scroll_y ?? 0) + transition_state.viewport_height,
                            (transition_state.next_view_scroll_y ?? 0) + transition_state.viewport_height
                        )
                    }}
                />
            )}

            {native_toolbar_active || is_toolbar_suppressed ? null : (
                <ViewSwitcherToolbar
                    views={views}
                    active_view_id={current_active_view_id}
                    toolbar_layout={toolbar_layout}
                    visible={is_toolbar_visible}
                    interactive={is_toolbar_interactive}
                    active_color={resolved_active_color}
                    on_view_select={handle_toolbar_click}
                />
            )}
        </div>
    )
}

function ViewSwitcherPanel<T extends string>({
    view_id,
    on_element_ref,
    ...props
}: ComponentPropsWithoutRef<"div"> & {
    view_id: T
    on_element_ref: (view_id: T, el: HTMLDivElement | null) => void
}) {
    const attach_panel_ref = useCallback(
        (el: HTMLDivElement | null) => {
            on_element_ref(view_id, el)
        },
        [on_element_ref, view_id]
    )

    return <div {...props} ref={attach_panel_ref} />
}
