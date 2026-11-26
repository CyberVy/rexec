import { create_swipe_gesture } from "@/infra"
import type { SwipeEndResult } from "@/infra/gestures"
import { view_switcher_controller } from "./ViewSwitcherController"
import type { View } from "./types"

const RELEASE_TRANSITION_CSS = "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)"
const OVERSCROLL_TOLERANCE_PX = 2
const COMMIT_SYNC_FRAMES = 3

export { RELEASE_TRANSITION_CSS }

export function is_in_overscroll(): boolean {
    const max_scroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    return window.scrollY < -OVERSCROLL_TOLERANCE_PX || window.scrollY > max_scroll + OVERSCROLL_TOLERANCE_PX
}

/**
 * Keeps document touchmove scroll-locked across Step 5 animation and the post-Step-6
 * WebKit compositor commit window.
 *
 * On iOS WebKit, window.scrollTo updates the WebContent process immediately while UIKit's
 * UIScrollView syncs contentOffset on a later composited layer-tree commit. Any touch that
 * begins before that commit is anchored to the previous view's offset; letting its touchmove
 * proceed allows UIKit to push the stale offset back over the restored scrollY.
 */
class ScrollSyncBarrier {
    private active = false
    private owner_id: string | null = null
    private has_stale_touch = false
    private commit_frames_done = false
    private raf_id: number | null = null

    private readonly on_touch_start = () => {
        this.has_stale_touch = true
    }

    private readonly on_touch_move = (event: TouchEvent) => {
        if (event.cancelable) event.preventDefault()
    }

    private readonly on_touch_end = (event: TouchEvent) => {
        if (event.touches.length > 0) return
        this.has_stale_touch = false
        if (this.commit_frames_done) {
            this.release()
        }
    }

    public is_active(): boolean {
        return this.active
    }

    public engage(owner_id: string): void {
        this.cancel_pending_raf()
        this.owner_id = owner_id
        this.commit_frames_done = false
        if (this.active) return

        this.active = true
        this.has_stale_touch = false
        document.addEventListener("touchstart", this.on_touch_start, { passive: true, capture: true })
        document.addEventListener("touchmove", this.on_touch_move, { passive: false, capture: true })
        document.addEventListener("touchend", this.on_touch_end, { passive: true, capture: true })
        document.addEventListener("touchcancel", this.on_touch_end, { passive: true, capture: true })
    }

    public release_after_commit(owner_id: string, needs_scroll_sync: boolean): void {
        if (!this.active) {
            if (!needs_scroll_sync) return
            this.engage(owner_id)
        } else {
            this.owner_id = owner_id
        }

        this.cancel_pending_raf()

        if (!needs_scroll_sync) {
            this.commit_frames_done = true
            if (!this.has_stale_touch) {
                this.release()
            }
            return
        }

        let remaining_frames = COMMIT_SYNC_FRAMES
        const tick = () => {
            remaining_frames -= 1
            if (remaining_frames > 0) {
                this.raf_id = requestAnimationFrame(tick)
                return
            }
            this.raf_id = null
            this.commit_frames_done = true
            if (!this.has_stale_touch) {
                this.release()
            }
        }
        this.raf_id = requestAnimationFrame(tick)
    }

    public release(owner_id?: string): void {
        if (owner_id !== undefined && this.owner_id !== owner_id) return
        this.cancel_pending_raf()
        if (!this.active) return

        this.active = false
        this.owner_id = null
        this.has_stale_touch = false
        this.commit_frames_done = false
        document.removeEventListener("touchstart", this.on_touch_start, true)
        document.removeEventListener("touchmove", this.on_touch_move, true)
        document.removeEventListener("touchend", this.on_touch_end, true)
        document.removeEventListener("touchcancel", this.on_touch_end, true)
    }

    private cancel_pending_raf(): void {
        if (this.raf_id !== null) {
            cancelAnimationFrame(this.raf_id)
            this.raf_id = null
        }
    }
}

/** Shared across all ViewSwitcher instances because they coordinate a single document UIScrollView. */
const shared_scroll_barrier = new ScrollSyncBarrier()

export function resolve_remember_scroll<T extends string>(
    view: View<T>,
    keep_alive_default: boolean,
    remember_scroll_default: boolean
): boolean {
    const is_keep_alive = view.keep_alive ?? keep_alive_default
    return is_keep_alive && (view.remember_scroll ?? remember_scroll_default)
}

interface TransitionSlot<T extends string> {
    id: T
    el: HTMLDivElement
    slot_offset_x: number
    scroll_y: number
    top_offset: number
}

interface TransitionGeometry<T extends string> {
    viewport_width: number
    base_x: number
    spacer_el: HTMLDivElement
    active: TransitionSlot<T>
    prev: TransitionSlot<T> | null
    next: TransitionSlot<T> | null
    slots: TransitionSlot<T>[]
}

type EngineState<T extends string> =
    | { phase: "idle" }
    | {
          phase: "entering"
          pending_dx: number
          raf_id: number
      }
    | {
          phase: "dragging"
          geometry: TransitionGeometry<T>
          current_dx: number
      }
    | {
          phase: "animating"
          geometry: TransitionGeometry<T>
          outcome: "switch" | "return"
          target_slot: TransitionSlot<T>
          cleanup_listeners: () => void
      }

export interface EngineHostSnapshot<T extends string> {
    views: View<T>[]
    active_view_id: T
    keep_alive_default: boolean
    remember_scroll_default: boolean
    container_el: HTMLDivElement | null
    spacer_el: HTMLDivElement | null
    get_panel_el: (view_id: T) => HTMLDivElement | null
}

export interface SwipeTransitionEngineHost<T extends string> {
    get_snapshot: () => EngineHostSnapshot<T>
    ensure_views_mounted: (view_ids: T[]) => void
    on_view_change_start: (view_id: T) => void
    on_transition_settled: (switched_view_id: T | null) => void
}

function clear_panel_transition_styles(el: HTMLDivElement): void {
    delete el.dataset.transitionVisible
    el.style.position = ""
    el.style.top = ""
    el.style.left = ""
    el.style.width = ""
    el.style.height = ""
    el.style.transform = ""
    el.style.transition = ""
    el.style.zIndex = ""
    el.style.removeProperty("--switcher-top-offset")
    el.style.removeProperty("--switcher-bottom-offset")
}

/**
 * Finds the viewport origin (padding-box top-left) of the nearest ancestor that creates a
 * containing block for `position: fixed` descendants, without mutating DOM or forcing reflow.
 */
function measure_containing_block_origin(container_el: HTMLElement): { x: number; y: number } {
    let ancestor = container_el.parentElement
    while (ancestor && ancestor !== document.documentElement) {
        const style = getComputedStyle(ancestor)
        const contain = style.contain || ""
        const will_change = style.willChange || ""
        const creates_containing_block =
            (style.transform && style.transform !== "none") ||
            (style.perspective && style.perspective !== "none") ||
            (style.filter && style.filter !== "none") ||
            (style.backdropFilter && style.backdropFilter !== "none") ||
            /\b(?:paint|layout|strict|content)\b/.test(contain) ||
            /\b(?:transform|perspective|filter|backdrop-filter)\b/.test(will_change)

        if (creates_containing_block) {
            const rect = ancestor.getBoundingClientRect()
            return {
                x: rect.left + (Number.parseFloat(style.borderLeftWidth) || 0),
                y: rect.top + (Number.parseFloat(style.borderTopWidth) || 0)
            }
        }
        ancestor = ancestor.parentElement
    }
    return { x: 0, y: 0 }
}

/**
 * Pure DOM finite-state machine enforcing the strict 6-step swipe transition sequence:
 * 1. touchstart   -> record touch origin without blocking propagation
 * 2. touchmove    -> lock direction; stop propagation if this switcher has a target view, otherwise bubble to parent
 * 3. lock success -> record window.scrollY once, hold height with spacer, compensate containing block, switch to fixed
 * 4. drag move    -> pure GPU translate3d updates with zero React renders
 * 5. touchend     -> threshold check, notify on_view_change_start, run single CSS transform transition
 * 6. settle       -> restore static flow, collapse spacer, restore target window.scrollY once, commit view change
 */
export class SwipeTransitionEngine<T extends string> {
    private readonly switcher_id: string
    private readonly host: SwipeTransitionEngineHost<T>
    private readonly scroll_positions = new Map<T, number>()

    private state: EngineState<T> = { phase: "idle" }
    private unbind_gesture: (() => void) | null = null

    constructor(switcher_id: string, host: SwipeTransitionEngineHost<T>) {
        this.switcher_id = switcher_id
        this.host = host
    }

    public is_busy(): boolean {
        return this.state.phase !== "idle"
    }

    public begin_scroll_sync_barrier(): void {
        shared_scroll_barrier.release_after_commit(this.switcher_id, true)
    }

    public record_scroll(view_id: T, remember_scroll: boolean): void {
        if (!remember_scroll) return
        this.scroll_positions.set(view_id, window.scrollY)
    }

    public get_restore_scroll_y(view_id: T, remember_scroll: boolean): number {
        if (!remember_scroll) return 0
        return this.scroll_positions.get(view_id) ?? 0
    }

    public bind(container_el: HTMLDivElement): void {
        this.unbind()

        const swipe_gesture = create_swipe_gesture({
            enabled: (direction) => {
                if (this.state.phase !== "idle" || shared_scroll_barrier.is_active()) return false
                if (view_switcher_controller.is_transition_locked()) return false
                if (is_in_overscroll()) return false

                const { views, active_view_id } = this.host.get_snapshot()
                const active_index = views.findIndex((view) => view.id === active_view_id)
                if (active_index === -1) return false

                const active_view = views[active_index]
                if (active_view.swipe_enabled === false) return false
                if (direction === "right" && active_index <= 0) return false
                if (direction === "left" && active_index >= views.length - 1) return false

                return true
            },
            on_start: () => this.schedule_enter_dragging(),
            on_move: (diff_x) => this.update_drag(diff_x),
            on_end: (result) => this.finish_drag(result),
            stop_propagation: true,
            prevent_default: true
        })

        this.unbind_gesture = swipe_gesture.bind(container_el)
    }

    public unbind(): void {
        if (this.unbind_gesture) {
            this.unbind_gesture()
            this.unbind_gesture = null
        }
    }

    public destroy(): void {
        this.unbind()
        shared_scroll_barrier.release(this.switcher_id)

        if (this.state.phase === "idle") return

        const current_state = this.state
        this.state = { phase: "idle" }

        if (current_state.phase === "entering") {
            cancelAnimationFrame(current_state.raf_id)
            view_switcher_controller.release_transition(this.switcher_id)
            return
        }

        if (current_state.phase === "animating") {
            current_state.cleanup_listeners()
        }

        for (const slot of current_state.geometry.slots) {
            clear_panel_transition_styles(slot.el)
        }
        current_state.geometry.spacer_el.style.display = "none"
        current_state.geometry.spacer_el.style.height = ""

        view_switcher_controller.release_transition(this.switcher_id)
    }

    // ============================================================================
    // Step 3: Claim lock in touchmove (< 0.1ms), commit fixed layout on next rAF
    // ============================================================================

    private schedule_enter_dragging(): boolean {
        if (this.state.phase !== "idle") return false
        if (!view_switcher_controller.claim_transition(this.switcher_id)) return false

        const raf_id = requestAnimationFrame(() => {
            this.commit_enter_dragging()
        })

        this.state = {
            phase: "entering",
            pending_dx: 0,
            raf_id
        }

        return true
    }

    private commit_enter_dragging(): boolean {
        if (this.state.phase !== "entering") return false

        const initial_raw_dx = this.state.pending_dx
        const snapshot = this.host.get_snapshot()
        const { views, active_view_id, keep_alive_default, remember_scroll_default, container_el, spacer_el } = snapshot
        const active_index = views.findIndex((view) => view.id === active_view_id)

        if (active_index === -1 || !container_el || !spacer_el) {
            this.state = { phase: "idle" }
            view_switcher_controller.release_transition(this.switcher_id)
            return false
        }

        const active_view = views[active_index]
        const prev_view = active_index > 0 ? views[active_index - 1] : null
        const next_view = active_index < views.length - 1 ? views[active_index + 1] : null

        const missing_neighbor_ids: T[] = []
        if (prev_view && !snapshot.get_panel_el(prev_view.id)) missing_neighbor_ids.push(prev_view.id)
        if (next_view && !snapshot.get_panel_el(next_view.id)) missing_neighbor_ids.push(next_view.id)
        if (missing_neighbor_ids.length > 0) {
            this.host.ensure_views_mounted(missing_neighbor_ids)
        }

        const active_el = snapshot.get_panel_el(active_view.id)
        if (!active_el) {
            this.state = { phase: "idle" }
            view_switcher_controller.release_transition(this.switcher_id)
            return false
        }

        // Single synchronous read pass before ANY DOM writes
        const active_scroll_y = window.scrollY
        if (resolve_remember_scroll(active_view, keep_alive_default, remember_scroll_default)) {
            this.scroll_positions.set(active_view.id, active_scroll_y)
        }

        const active_rect = active_el.getBoundingClientRect()
        const active_height = active_el.offsetHeight
        const viewport_width = container_el.clientWidth || window.innerWidth
        const viewport_height = window.innerHeight
        const doc_top = active_rect.top + active_scroll_y
        const cb_origin = measure_containing_block_origin(container_el)
        const base_x = active_rect.left - cb_origin.x

        let initial_dx = initial_raw_dx
        if (initial_dx < 0 && !next_view) initial_dx = 0
        if (initial_dx > 0 && !prev_view) initial_dx = 0
        initial_dx = Math.max(-viewport_width, Math.min(viewport_width, initial_dx))

        // Single pure write pass: hold spacer first, then promote participating panels to fixed
        spacer_el.style.height = `${active_height}px`
        spacer_el.style.display = "block"

        const prepare_slot = (view: View<T>, slot_offset_x: number, is_active: boolean): TransitionSlot<T> | null => {
            const el = snapshot.get_panel_el(view.id)
            if (!el) return null

            const remember = resolve_remember_scroll(view, keep_alive_default, remember_scroll_default)
            const scroll_y = is_active ? active_scroll_y : remember ? (this.scroll_positions.get(view.id) ?? 0) : 0
            const viewport_y = doc_top - scroll_y
            const top_offset = viewport_y - cb_origin.y
            const box_height = Math.max(0, viewport_height - viewport_y)
            const bottom_offset = Math.max(0, viewport_y - viewport_height)

            el.dataset.transitionVisible = "true"
            el.style.position = "fixed"
            el.style.top = "0px"
            el.style.left = "0px"
            el.style.width = `${viewport_width}px`
            el.style.height = `${box_height}px`
            el.style.zIndex = "10"
            el.style.transition = "none"
            el.style.setProperty("--switcher-top-offset", `${viewport_y}px`)
            el.style.setProperty("--switcher-bottom-offset", `${bottom_offset}px`)
            el.style.transform = `translate3d(${base_x + slot_offset_x + initial_dx}px, ${top_offset}px, 0)`

            return {
                id: view.id,
                el,
                slot_offset_x,
                scroll_y,
                top_offset
            }
        }

        const active_slot = prepare_slot(active_view, 0, true)
        if (!active_slot) {
            clear_panel_transition_styles(active_el)
            spacer_el.style.display = "none"
            spacer_el.style.height = ""
            this.state = { phase: "idle" }
            view_switcher_controller.release_transition(this.switcher_id)
            return false
        }

        const prev_slot = prev_view ? prepare_slot(prev_view, -viewport_width, false) : null
        const next_slot = next_view ? prepare_slot(next_view, viewport_width, false) : null

        const slots: TransitionSlot<T>[] = [active_slot]
        if (prev_slot) slots.push(prev_slot)
        if (next_slot) slots.push(next_slot)

        const geometry: TransitionGeometry<T> = {
            viewport_width,
            base_x,
            spacer_el,
            active: active_slot,
            prev: prev_slot,
            next: next_slot,
            slots
        }

        this.state = {
            phase: "dragging",
            geometry,
            current_dx: initial_dx
        }

        view_switcher_controller.notify_transition_started(this.switcher_id)
        return true
    }

    // ============================================================================
    // Step 4: Pure GPU transformX tracking during drag
    // ============================================================================

    private update_drag(raw_dx: number): void {
        if (this.state.phase === "entering") {
            this.state.pending_dx = raw_dx
            return
        }
        if (this.state.phase !== "dragging") return

        const { geometry } = this.state
        let dx = raw_dx
        if (dx < 0 && !geometry.next) dx = 0
        if (dx > 0 && !geometry.prev) dx = 0
        dx = Math.max(-geometry.viewport_width, Math.min(geometry.viewport_width, dx))

        this.state.current_dx = dx

        for (const slot of geometry.slots) {
            slot.el.style.transform = `translate3d(${geometry.base_x + slot.slot_offset_x + dx}px, ${slot.top_offset}px, 0)`
        }
    }

    // ============================================================================
    // Step 5: Threshold check & CSS release transition
    // ============================================================================

    private finish_drag(result: SwipeEndResult): void {
        if (this.state.phase === "entering") {
            cancelAnimationFrame(this.state.raf_id)
            if (!result.should_complete) {
                this.state = { phase: "idle" }
                view_switcher_controller.release_transition(this.switcher_id)
                return
            }
            if (!this.commit_enter_dragging()) return
        }

        if (this.state.phase !== "dragging") return

        const { geometry, current_dx } = this.state
        const is_next = result.direction === "left"
        const candidate = is_next ? geometry.next : geometry.prev
        const will_switch = result.should_complete && candidate !== null

        const outcome: "switch" | "return" = will_switch ? "switch" : "return"
        const target_slot = will_switch ? candidate : geometry.active
        const target_dx = will_switch ? (is_next ? -geometry.viewport_width : geometry.viewport_width) : 0

        if (outcome === "switch") {
            view_switcher_controller.notify_transition_preview(this.switcher_id, target_slot.id)
            this.host.on_view_change_start(target_slot.id)
        }

        // If already at target offset, CSS transition will not fire transitionend; settle immediately
        if (Math.abs(current_dx - target_dx) < 0.5) {
            this.settle(geometry, outcome, target_slot)
            return
        }

        // Flush current_dx as the before-change style so same-frame touchmove+touchend never skips transition
        void geometry.active.el.offsetWidth

        shared_scroll_barrier.engage(this.switcher_id)

        const on_transition_end = (event: TransitionEvent) => {
            if (event.target !== geometry.active.el || event.propertyName !== "transform") return
            this.settle(geometry, outcome, target_slot)
        }

        geometry.active.el.addEventListener("transitionend", on_transition_end)

        const cleanup_listeners = () => {
            geometry.active.el.removeEventListener("transitionend", on_transition_end)
        }

        this.state = {
            phase: "animating",
            geometry,
            outcome,
            target_slot,
            cleanup_listeners
        }

        for (const slot of geometry.slots) {
            slot.el.style.transition = RELEASE_TRANSITION_CSS
            slot.el.style.transform = `translate3d(${geometry.base_x + slot.slot_offset_x + target_dx}px, ${slot.top_offset}px, 0)`
        }
    }

    // ============================================================================
    // Step 6: Restore static flow, collapse spacer, restore target scroll once
    // ============================================================================

    private settle(
        geometry: TransitionGeometry<T>,
        outcome: "switch" | "return",
        target_slot: TransitionSlot<T>
    ): void {
        if (this.state.phase === "idle") return

        const prev_state = this.state
        this.state = { phase: "idle" }

        if (prev_state.phase === "animating") {
            prev_state.cleanup_listeners()
        }

        // 1. Return all participating panels to static flow
        for (const slot of geometry.slots) {
            clear_panel_transition_styles(slot.el)
        }

        // 2. Flip panel visibility in DOM synchronously before scroll restore
        if (outcome === "switch") {
            geometry.active.el.dataset.active = "false"
            target_slot.el.dataset.active = "true"
        }

        // 3. Remove spacer so document height equals target view's real height
        geometry.spacer_el.style.display = "none"
        geometry.spacer_el.style.height = ""

        // 4. Restore target view's scroll height exactly once (including return if iOS UIScrollView drifted during drag)
        const needs_scroll_restore = outcome === "switch" || Math.abs(window.scrollY - target_slot.scroll_y) >= 1
        if (needs_scroll_restore) {
            window.scrollTo(0, target_slot.scroll_y)
        }

        // 5. Hold shared scroll-lock barrier until WebKit commits scrollY to UIKit and any stale touch lifts
        shared_scroll_barrier.release_after_commit(this.switcher_id, needs_scroll_restore)

        // 6. Release global transition lock and notify React
        view_switcher_controller.release_transition(this.switcher_id, outcome === "switch" ? target_slot.id : undefined)
        this.host.on_transition_settled(outcome === "switch" ? target_slot.id : null)
    }
}
