"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useId, useRef } from "react"
import type { ComponentPropsWithoutRef } from "react"
import { useMergedRef } from "@/components/hooks"
import { join_classes } from "@/components/utils"
import { view_switcher_controller } from "./ViewSwitcherController"
import { useViewSwitcher } from "./useViewSwitcher"
import { is_native_toolbar_active, useNativeToolbar } from "./native_toolbar"
import { ViewSwitcherToolbar } from "./ViewSwitcherToolbar"
import {
    useViewSwipeGesture,
    compute_view_render_config,
    is_in_overscroll,
    evaluate_toolbar_visibility
} from "./useViewSwipeGesture"
import type { ViewSwitcherProps } from "./types"

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
    ref,
    ...props
}: ViewSwitcherProps<T>) {
    const fallback_id = useId()
    const switcher_instance_id = id ?? fallback_id

    // State setup: controlled vs uncontrolled active view ID
    const [internal_active_view_id, set_internal_active_view_id] = useState<T>(default_active_view_id ?? views[0]?.id)
    const current_active_view_id = active_view_id !== undefined ? active_view_id : internal_active_view_id

    // Container DOM ref forwarding
    const container_element_ref = useRef<HTMLDivElement | null>(null)
    const set_container_element_ref = useMergedRef(container_element_ref, ref)

    // Scroll positions and switching lock refs
    const scroll_positions_ref = useRef<Record<string, number>>({})
    const is_switching_view_ref = useRef<boolean>(false)

    // Derive active view configuration flags
    const active_view_index = views.findIndex((v) => v.id === current_active_view_id)
    const active_view = views[active_view_index]
    const active_view_keep_alive = active_view?.keep_alive ?? keep_alive_default
    const active_view_remember_scroll = active_view_keep_alive && (active_view?.remember_scroll ?? remember_scroll)
    const active_swipe_enabled = active_view?.swipe_enabled
    const should_hide_toolbar = active_view?.should_hide_toolbar
    const active_overscroll_enabled = active_view?.overscroll_enabled ?? true

    const commit_view_change = useCallback(
        (view_id: T) => {
            if (active_view_id === undefined) set_internal_active_view_id(view_id)
            on_view_change?.(view_id)
        },
        [active_view_id, on_view_change]
    )

    // Swipe gesture transition engine
    const {
        transition_state,
        is_transitioning,
        target_view_id,
        set_view_element,
        handle_transition_end,
        reset_transition
    } = useViewSwipeGesture({
        switcher_instance_id,
        views,
        current_active_view_id,
        active_view_index,
        active_swipe_enabled,
        container_element_ref,
        scroll_positions_ref,
        commit_view_change
    })

    // Window scroll listener: records scroll position and updates toolbar visibility
    useEffect(() => {
        const handle_scroll = () => {
            if (is_switching_view_ref.current || is_transitioning) return

            const current_scroll_y = window.scrollY
            if (active_view_remember_scroll) {
                scroll_positions_ref.current[current_active_view_id] = current_scroll_y
            }

            if (should_hide_toolbar !== undefined) {
                const is_visible = evaluate_toolbar_visibility(should_hide_toolbar, current_scroll_y)
                view_switcher_controller.set_toolbar_visible(switcher_instance_id, is_visible)
            }
        }

        window.addEventListener("scroll", handle_scroll, { passive: true })
        return () => window.removeEventListener("scroll", handle_scroll)
    }, [
        switcher_instance_id,
        current_active_view_id,
        active_view_remember_scroll,
        should_hide_toolbar,
        is_transitioning
    ])

    // Restore scroll position synchronously pre-paint on active view change or transition end
    useLayoutEffect(() => {
        if (is_transitioning) return

        is_switching_view_ref.current = true

        const target_scroll_y = active_view_remember_scroll
            ? (scroll_positions_ref.current[current_active_view_id] ?? 0)
            : 0
        window.scrollTo(0, target_scroll_y)
        scroll_positions_ref.current[current_active_view_id] = target_scroll_y

        is_switching_view_ref.current = false
    }, [current_active_view_id, active_view_remember_scroll, is_transitioning])

    // Sync toolbar visibility independently so rule updates never trigger unexpected scrollTo jumps
    useLayoutEffect(() => {
        if (is_transitioning) return

        const current_scroll_y = active_view_remember_scroll
            ? (scroll_positions_ref.current[current_active_view_id] ?? window.scrollY)
            : window.scrollY
        const is_visible = evaluate_toolbar_visibility(should_hide_toolbar, current_scroll_y)
        view_switcher_controller.set_toolbar_visible(switcher_instance_id, is_visible)
    }, [
        current_active_view_id,
        active_view_remember_scroll,
        is_transitioning,
        should_hide_toolbar,
        switcher_instance_id
    ])

    // Controller integration
    const { is_toolbar_visible, has_other_transitioning } = useViewSwitcher(switcher_instance_id)

    const switch_view = useCallback(
        (target_view_id: string) => {
            const target = views.find((v) => v.id === target_view_id)
            if (!target) return
            reset_transition()
            commit_view_change(target.id)
        },
        [views, reset_transition, commit_view_change]
    )

    // Register instance with ViewSwitcherController on mount
    useEffect(() => {
        return view_switcher_controller.register(switcher_instance_id, {
            id: switcher_instance_id,
            is_toolbar_visible: true,
            is_transitioning,
            active_view_id: current_active_view_id,
            target_view_id,
            overscroll_enabled: active_overscroll_enabled
        })
    }, [switcher_instance_id])

    // Keep controller synchronized with instance transition and active view states
    useEffect(() => {
        view_switcher_controller.update_instance(switcher_instance_id, {
            is_transitioning,
            active_view_id: current_active_view_id,
            target_view_id,
            overscroll_enabled: active_overscroll_enabled
        })
    }, [
        switcher_instance_id,
        transition_state,
        current_active_view_id,
        is_transitioning,
        target_view_id,
        active_overscroll_enabled
    ])

    // React to event-driven "switch_view" CustomEvent from controller
    useEffect(() => {
        const handle_switch = (e: Event) => {
            const custom_event = e as CustomEvent<{ switcher_id: string; view_id: string }>
            if (custom_event.detail && custom_event.detail.switcher_id === switcher_instance_id) {
                switch_view(custom_event.detail.view_id)
            }
        }
        view_switcher_controller.addEventListener("switch_view", handle_switch)
        return () => {
            view_switcher_controller.removeEventListener("switch_view", handle_switch)
        }
    }, [switcher_instance_id, switch_view])

    // Toolbar navigation button click handler
    const handle_toolbar_click = (view_id: T) => {
        if (is_transitioning || view_id === current_active_view_id) return
        if (is_in_overscroll()) return
        if (has_other_transitioning) return

        commit_view_change(view_id)
    }

    const native_toolbar_active = is_native_toolbar_active()
    useNativeToolbar({
        enabled: native_toolbar_active,
        switcher_id: switcher_instance_id,
        layout: toolbar_layout,
        views,
        active_id: current_active_view_id,
        visible: is_toolbar_visible,
        interaction_enabled: !(is_transitioning || has_other_transitioning),
        on_select: handle_toolbar_click
    })

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

                return (
                    <ViewSwitcherPanel
                        key={view.id}
                        view_id={view.id}
                        on_element_ref={set_view_element}
                        className={render_config.view_class}
                        style={render_config.style}
                        onTransitionEnd={render_config.is_view_active_in_transition ? handle_transition_end : undefined}
                    >
                        {view.content}
                    </ViewSwitcherPanel>
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

            {native_toolbar_active ? null : (
                <ViewSwitcherToolbar
                    views={views}
                    active_view_id={current_active_view_id}
                    is_toolbar_visible={is_toolbar_visible}
                    is_navigation_disabled={is_transitioning || has_other_transitioning}
                    on_view_select={handle_toolbar_click}
                    toolbar_layout={toolbar_layout}
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
