"use client"

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react"
import type { CSSProperties, TransitionEvent } from "react"
import { create_swipe_gesture } from "@/infra"
import type { SwipeEndResult } from "@/infra/gestures.client"
import type {
    View,
    TransitionGeometry,
    SwipeRelease,
    TransitionState,
    UseViewSwipeGestureOptions,
    UseViewSwipeGestureResult
} from "./types"
import { view_switcher_controller } from "./ViewSwitcherController"

export const RELEASE_TRANSITION_CSS = "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)"

export function resolve_swipe_start<T extends string>(
    transition_state: TransitionState<T>,
    current_active_view_id: T,
    window_scroll_y: number
): { view_id: T; scroll_y: number } {
    if (transition_state.status === "released" && transition_state.release.view_id) {
        return { view_id: transition_state.release.view_id, scroll_y: transition_state.release.scroll_y }
    }
    return { view_id: current_active_view_id, scroll_y: window_scroll_y }
}

export function resolve_swipe_release<T extends string>(
    geometry: TransitionGeometry<T>,
    { should_complete, direction }: SwipeEndResult
): SwipeRelease<T> {
    const is_next = direction === "left"
    const target_view_id = is_next ? geometry.next_view_id : geometry.prev_view_id

    if (should_complete && target_view_id) {
        return {
            outcome: "switch",
            view_id: target_view_id,
            scroll_y: (is_next ? geometry.next_view_scroll_y : geometry.prev_view_scroll_y) ?? 0,
            translation_x: is_next ? -geometry.viewport_width : geometry.viewport_width
        }
    }

    return {
        outcome: "return",
        view_id: geometry.active_view_id,
        scroll_y: geometry.active_view_scroll_y,
        translation_x: 0
    }
}

/**
 * Check if the document is currently in an iOS rubber-band overscroll phase (top or bottom).
 * Gesture interaction and toolbar click triggers are forbidden during overscroll to avoid visual jumping.
 */
export function is_in_overscroll(): boolean {
    const max_scroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    return window.scrollY < 0 || window.scrollY > max_scroll
}

/**
 * Calculates effective DOM translation X offset from raw swipe gesture displacement diff_x
 * considering edge boundaries and swipe permission.
 */
export function calculate_effective_translation_x<T extends string>(
    diff_x: number,
    prev_view_id: T | undefined,
    next_view_id: T | undefined,
    swipe_enabled: boolean
): number {
    if (!swipe_enabled) return 0
    if (diff_x < 0 && !next_view_id) return 0
    if (diff_x > 0 && !prev_view_id) return 0
    return diff_x
}

/** Shared geometry for React rendering and direct DOM updates during gestures. */
export function get_transition_view_layout<T extends string>(
    geometry: TransitionGeometry<T>,
    view_id: T,
    translation_x: number
): { top_offset: number; height: number; transform: string } | null {
    let base_x = 0
    let scroll_y = geometry.active_view_scroll_y

    if (view_id === geometry.prev_view_id) {
        base_x = -geometry.viewport_width
        scroll_y = geometry.prev_view_scroll_y ?? 0
    } else if (view_id === geometry.next_view_id) {
        base_x = geometry.viewport_width
        scroll_y = geometry.next_view_scroll_y ?? 0
    } else if (view_id !== geometry.active_view_id) {
        return null
    }

    const top_offset = geometry.active_view_top - scroll_y
    return {
        top_offset,
        height: geometry.viewport_height - top_offset,
        transform: `translate3d(${base_x + translation_x}px, ${top_offset}px, 0)`
    }
}

export function update_transition_elements<T extends string>(
    geometry: TransitionGeometry<T>,
    elements: Record<string, HTMLDivElement | null>,
    translation_x: number,
    transition?: string
): void {
    for (const view_id of [
        geometry.active_view_id,
        geometry.prev_view_id || undefined,
        geometry.next_view_id || undefined
    ]) {
        if (view_id === undefined) continue
        const element = elements[view_id]
        const layout = get_transition_view_layout(geometry, view_id, translation_x)
        if (!element || !layout) continue
        if (transition !== undefined) element.style.transition = transition
        element.style.transform = layout.transform
    }
}

/**
 * Computes visibility, layout styles, and CSS classes for a given view during transition or idle states.
 */
export function compute_view_render_config<T extends string>(
    view: View<T>,
    current_active_view_id: T,
    keep_alive_default: boolean,
    transition_state: TransitionState<T>
): { view_class: string; style: CSSProperties; is_view_active_in_transition: boolean } | null {
    const is_active = view.id === current_active_view_id
    const is_keep_alive = view.keep_alive ?? keep_alive_default

    const is_view_active_in_transition =
        transition_state.status !== "idle" && transition_state.active_view_id === view.id
    const translation_x = transition_state.status === "released" ? transition_state.release.translation_x : 0
    const layout =
        transition_state.status === "idle" ? null : get_transition_view_layout(transition_state, view.id, translation_x)

    if (!is_active && !is_keep_alive && !layout) return null

    const style: CSSProperties = layout
        ? {
              position: "fixed",
              top: 0,
              left: 0,
              width: "100%",
              height: `${layout.height}px`,
              transform: layout.transform,
              transition: transition_state.status === "released" ? RELEASE_TRANSITION_CSS : "none",
              zIndex: 10,
              ["--switcher-top-offset" as string]: `${layout.top_offset}px`,
              ["--switcher-bottom-offset" as string]: `${layout.top_offset}px`
          }
        : {}
    const view_class = layout ? "block" : is_active ? "block w-full" : "hidden"

    return { view_class, style, is_view_active_in_transition }
}

export function useViewSwipeGesture<T extends string>({
    switcher_instance_id,
    views,
    current_active_view_id,
    active_view_index,
    active_swipe_enabled,
    container_element_ref,
    scroll_positions_ref,
    commit_view_change
}: UseViewSwipeGestureOptions<T>): UseViewSwipeGestureResult<T> {
    const [transition_state, set_transition_state] = useState<TransitionState<T>>({ status: "idle" })
    const [prev_active_view_id, set_prev_active_view_id] = useState<T>(current_active_view_id)
    const transition_state_ref = useRef<TransitionState<T>>({ status: "idle" })
    const view_elements_ref = useRef<Record<string, HTMLDivElement | null>>({})

    if (prev_active_view_id !== current_active_view_id) {
        set_prev_active_view_id(current_active_view_id)
        const is_matching_release =
            transition_state.status === "released" &&
            transition_state.release.outcome === "switch" &&
            transition_state.release.view_id === current_active_view_id
        if (transition_state.status !== "idle" && !is_matching_release) {
            set_transition_state({ status: "idle" })
        }
    }

    const is_transitioning = transition_state.status !== "idle"

    const set_transition = useCallback(
        (next: TransitionState<T>) => {
            transition_state_ref.current = next
            set_transition_state(next)
            view_switcher_controller.update_instance(switcher_instance_id, {
                is_transitioning: next.status !== "idle"
            })
        },
        [switcher_instance_id]
    )

    useLayoutEffect(() => {
        if (transition_state.status === "idle") {
            transition_state_ref.current = transition_state
            view_switcher_controller.update_instance(switcher_instance_id, { is_transitioning: false })
        }
    }, [transition_state, switcher_instance_id])

    const set_view_element = useCallback((view_id: T, element: HTMLDivElement | null) => {
        if (element) view_elements_ref.current[view_id] = element
        else delete view_elements_ref.current[view_id]
    }, [])

    const context_ref = useRef({
        current_active_view_id,
        views,
        active_view_index,
        active_swipe_enabled,
        commit_view_change
    })

    useLayoutEffect(() => {
        context_ref.current = {
            current_active_view_id,
            views,
            active_view_index,
            active_swipe_enabled,
            commit_view_change
        }
    })

    const reset_transition = useCallback(() => {
        if (transition_state_ref.current.status !== "idle") {
            set_transition({ status: "idle" })
        }
    }, [set_transition])

    const handle_transition_end = useCallback(
        (e?: TransitionEvent) => {
            if (e && e.target !== e.currentTarget) return
            if (transition_state_ref.current.status === "released") {
                set_transition({ status: "idle" })
            }
        },
        [set_transition]
    )

    // Safety fallback: ensure transition recovers to idle even if browser drops transitionend event
    useEffect(() => {
        if (transition_state.status !== "released") return
        const timer = setTimeout(() => {
            set_transition({ status: "idle" })
        }, 350)
        return () => clearTimeout(timer)
    }, [transition_state.status, set_transition])

    // Lock touchmove document scrolling while transition animation is active
    useEffect(() => {
        if (!is_transitioning) return
        const prevent_scroll = (e: TouchEvent) => {
            if (e.cancelable) e.preventDefault()
        }
        document.addEventListener("touchmove", prevent_scroll, { passive: false })
        return () => document.removeEventListener("touchmove", prevent_scroll)
    }, [is_transitioning])

    // Bind horizontal swipe gesture handlers
    useEffect(() => {
        const container_element = container_element_ref.current
        if (!container_element) return

        const swipe_gesture = create_swipe_gesture({
            enabled: (swipe_direction) => {
                const {
                    active_swipe_enabled: swipe_enabled,
                    active_view_index: curr_idx,
                    views: all_views
                } = context_ref.current

                // Forbid swipe during iOS overscroll/bounce
                if (is_in_overscroll()) return false

                if (view_switcher_controller.has_other_transitioning(switcher_instance_id)) return false

                if (transition_state_ref.current.status === "dragging") {
                    // Recover from lost events without leaking the touch to an outer switcher
                    set_transition({ status: "idle" })
                }

                if (!swipe_enabled) return false
                if (swipe_direction === "right" && curr_idx <= 0) return false
                if (swipe_direction === "left" && curr_idx >= all_views.length - 1) return false

                return true
            },
            on_start: () => {
                const current_ts = transition_state_ref.current
                const { current_active_view_id: active_id, views: all_views } = context_ref.current

                const { view_id: resolved_id, scroll_y: active_scroll_y } = resolve_swipe_start(
                    current_ts,
                    active_id,
                    window.scrollY
                )
                if (current_ts.status === "idle") {
                    scroll_positions_ref.current[resolved_id] = active_scroll_y
                }

                const active_idx = all_views.findIndex((v) => v.id === resolved_id)
                if (active_idx === -1) return false

                const prev_id = all_views[active_idx - 1]?.id
                const next_id = all_views[active_idx + 1]?.id
                if (!prev_id && !next_id) return false

                const prev_scroll_y = prev_id === undefined ? 0 : (scroll_positions_ref.current[prev_id] ?? 0)
                const next_scroll_y = next_id === undefined ? 0 : (scroll_positions_ref.current[next_id] ?? 0)

                let active_height = 0
                let active_view_top = 0
                const active_child = view_elements_ref.current[resolved_id]
                if (active_child) {
                    active_height = active_child.offsetHeight
                    const rect = active_child.getBoundingClientRect()
                    active_view_top =
                        current_ts.status !== "idle" ? current_ts.active_view_top : rect.top + active_scroll_y
                }

                const container_width = container_element.clientWidth || window.innerWidth

                set_transition({
                    status: "dragging",
                    active_view_id: resolved_id,
                    active_view_height: active_height,
                    active_view_scroll_y: active_scroll_y,
                    active_view_top,
                    viewport_height: window.innerHeight,
                    viewport_width: container_width,
                    prev_view_id: prev_id,
                    prev_view_scroll_y: prev_scroll_y,
                    next_view_id: next_id,
                    next_view_scroll_y: next_scroll_y
                })
                return true
            },
            on_move: (delta_x) => {
                const current_transition = transition_state_ref.current
                if (current_transition.status !== "dragging") return

                const { prev_view_id, next_view_id } = current_transition
                const { active_swipe_enabled: swipe_enabled } = context_ref.current

                const effective_translation_x = calculate_effective_translation_x(
                    delta_x,
                    prev_view_id,
                    next_view_id,
                    swipe_enabled
                )
                update_transition_elements(
                    current_transition,
                    view_elements_ref.current,
                    effective_translation_x,
                    "none"
                )
            },
            on_end: (swipe_result) => {
                const current_transition = transition_state_ref.current
                if (current_transition.status === "idle") return

                const release = resolve_swipe_release(current_transition, swipe_result)
                const { prev_view_id, next_view_id } = current_transition
                const { active_swipe_enabled: swipe_enabled, commit_view_change: commit } = context_ref.current
                const current_translation_x = calculate_effective_translation_x(
                    swipe_result.diff_x,
                    prev_view_id,
                    next_view_id,
                    swipe_enabled
                )

                if (Math.abs(current_translation_x - release.translation_x) < 1) {
                    set_transition({ status: "idle" })
                    if (release.outcome === "switch") {
                        commit(release.view_id)
                    }
                    return
                }

                update_transition_elements(
                    current_transition,
                    view_elements_ref.current,
                    release.translation_x,
                    RELEASE_TRANSITION_CSS
                )

                set_transition({
                    ...current_transition,
                    status: "released",
                    release
                })
                if (release.outcome === "switch") {
                    commit(release.view_id)
                }
            },
            stop_propagation: true
        })

        return swipe_gesture.bind(container_element)
    }, [container_element_ref, switcher_instance_id, scroll_positions_ref, set_transition])

    return {
        transition_state,
        is_transitioning,
        set_view_element,
        handle_transition_end,
        reset_transition
    }
}
