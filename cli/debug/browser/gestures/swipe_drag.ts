import {
    normalize_target_input,
    type ActionError,
    type DragOptions,
    type GestureCurve,
    type GestureDirection,
    type GestureDistance,
    type GestureResult,
    type Point2D,
    type RectBox,
    type SwipeOptions,
    type TargetElementSummary,
    type TargetInput
} from "../../shared/protocol"
import { describe_element_brief } from "../dom/dom_utils"
import { compute_anchor_point } from "../dom/locator"
import {
    allocate_pointer_id,
    append_overlay_box,
    append_overlay_dot,
    append_overlay_line,
    begin_synthetic_pointer,
    clip_rect_to_viewport,
    dispatch_touch_event,
    end_synthetic_pointer,
    evaluate_curve,
    get_captured_element,
    invalid_options,
    make_mouse_event,
    make_pointer_event,
    mount_debug_overlay,
    resolve_and_prepare_target,
    resolve_timing_options,
    wait_frames,
    wait_ms
} from "./pointer_common"

interface TrajectorySample {
    t: number
    x: number
    y: number
}

function compute_default_swipe_start(rect: RectBox, direction: GestureDirection): Point2D {
    const box = clip_rect_to_viewport(rect)
    const ratio = direction === "left" || direction === "up" ? 0.8 : 0.2
    if (direction === "left" || direction === "right") {
        return {
            x: Math.round(box.x + box.w * ratio),
            y: Math.round(box.y + box.h * 0.5)
        }
    }
    return {
        x: Math.round(box.x + box.w * 0.5),
        y: Math.round(box.y + box.h * ratio)
    }
}

function compute_swipe_end(
    from: Point2D,
    box: RectBox,
    direction: GestureDirection,
    distance?: GestureDistance
): Point2D {
    const horizontal = direction === "left" || direction === "right"
    const axis_span = Math.max(1, horizontal ? box.w : box.h)
    const dist_px =
        distance === undefined
            ? Math.max(1, Math.round(axis_span * 0.6))
            : distance.unit === "%"
              ? Math.round((axis_span * distance.value) / 100)
              : Math.round(distance.value)

    switch (direction) {
        case "left":
            return { x: from.x - dist_px, y: from.y }
        case "right":
            return { x: from.x + dist_px, y: from.y }
        case "up":
            return { x: from.x, y: from.y - dist_px }
        case "down":
            return { x: from.x, y: from.y + dist_px }
    }
}

function build_frame_ratios(duration_ms: number, has_tail_step: boolean): { body_times: number[]; tail_ms: number } {
    if (!has_tail_step) {
        const steps = Math.max(3, Math.min(240, Math.round(duration_ms / 16)))
        const body_times: number[] = []
        for (let i = 1; i <= steps; i += 1) {
            body_times.push((duration_ms * i) / steps)
        }
        return { body_times, tail_ms: 0 }
    }

    // Reserve a short <10ms final step so velocity trackers throttling move samples every 10ms still measure release velocity
    const tail_ms = duration_ms >= 36 ? 6 : Math.max(4, Math.floor(duration_ms * 0.25))
    const body_span = Math.max(8, duration_ms - tail_ms)
    const body_steps = Math.max(2, Math.min(240, Math.round(body_span / 16)))
    const body_times: number[] = []
    for (let i = 1; i <= body_steps; i += 1) {
        body_times.push((body_span * i) / body_steps)
    }
    return { body_times, tail_ms }
}

function summarize_velocities(samples: TrajectorySample[]): { peak_velocity: number; end_velocity: number } {
    if (samples.length < 2) {
        return { peak_velocity: 0, end_velocity: 0 }
    }

    let peak = 0
    let end = 0
    for (let i = 1; i < samples.length; i += 1) {
        const prev = samples[i - 1]
        const curr = samples[i]
        const dt = Math.max(1, curr.t - prev.t)
        const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y)
        const v = dist / dt
        if (v > peak) peak = v
        if (i === samples.length - 1) end = v
    }

    return {
        peak_velocity: Number(peak.toFixed(2)),
        end_velocity: Number(end.toFixed(2))
    }
}

async function run_pointer_gesture(params: {
    mode: "swipe" | "drag"
    pointer_type: "touch" | "mouse"
    direction?: GestureDirection
    curve: GestureCurve
    from: Point2D
    to: Point2D
    duration_ms: number
    hold_start_ms: number
    hold_end_ms: number
    target: TargetElementSummary
    to_target?: TargetElementSummary
    dry_run: boolean
    start_el_fallback?: Element | null
}): Promise<{ ok: true; data: GestureResult } | { ok: false; error: ActionError }> {
    const {
        mode,
        pointer_type,
        direction,
        curve,
        from,
        to,
        duration_ms,
        hold_start_ms,
        hold_end_ms,
        target,
        to_target,
        dry_run,
        start_el_fallback
    } = params

    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance_px = Math.round(Math.hypot(dx, dy))

    if (dry_run) {
        const overlay = mount_debug_overlay(1500)
        append_overlay_box(overlay, target.rect, "#22c55e")
        if (to_target) {
            append_overlay_box(overlay, to_target.rect, "#3b82f6")
        }
        append_overlay_line(overlay, from, to, "#ef4444")
        append_overlay_dot(overlay, from, "#22c55e")
        append_overlay_dot(overlay, to, "#ef4444")

        return {
            ok: true,
            data: {
                mode,
                pointer: pointer_type,
                dry_run: true,
                ...(direction ? { direction } : {}),
                curve,
                from,
                to,
                delta: { x: dx, y: dy },
                distance_px,
                requested_duration_ms: duration_ms,
                actual_duration_ms: 0,
                hold_start_ms,
                hold_end_ms,
                frames: 0,
                peak_velocity: 0,
                end_velocity: 0,
                target,
                ...(to_target ? { to_target } : {})
            }
        }
    }

    const down_target = document.elementFromPoint(from.x, from.y) || start_el_fallback || document.body
    const pointer_id = allocate_pointer_id()
    const samples: TrajectorySample[] = []
    let frames = 0
    const started_at = performance.now()

    begin_synthetic_pointer(pointer_id)

    try {
        let hovered_el: Element | null = down_target
        let pointer_down_not_canceled = true

        const resolve_pointer_target = (x: number, y: number): Element => {
            const captured = get_captured_element(pointer_id)
            if (captured) return captured
            return document.elementFromPoint(x, y) || (down_target.isConnected ? down_target : document.body)
        }

        const resolve_touch_target = (): Element => {
            if (down_target.isConnected) return down_target
            return document.body
        }

        const emit_hover_transition = (next_target: Element, x: number, y: number, buttons: number) => {
            if (hovered_el === next_target) return
            if (hovered_el && hovered_el.isConnected) {
                hovered_el.dispatchEvent(
                    make_pointer_event("pointerout", {
                        pointer_id,
                        pointer_type,
                        x,
                        y,
                        button: 0,
                        buttons,
                        pressure: buttons > 0 ? 0.5 : 0
                    })
                )
                hovered_el.dispatchEvent(
                    make_pointer_event("pointerleave", {
                        pointer_id,
                        pointer_type,
                        x,
                        y,
                        button: 0,
                        buttons,
                        pressure: buttons > 0 ? 0.5 : 0,
                        bubbles: false
                    })
                )
                if (pointer_type === "mouse") {
                    hovered_el.dispatchEvent(make_mouse_event("mouseout", { x, y, button: 0, buttons }))
                    hovered_el.dispatchEvent(
                        make_mouse_event("mouseleave", { x, y, button: 0, buttons, bubbles: false })
                    )
                }
            }
            next_target.dispatchEvent(
                make_pointer_event("pointerover", {
                    pointer_id,
                    pointer_type,
                    x,
                    y,
                    button: 0,
                    buttons,
                    pressure: buttons > 0 ? 0.5 : 0
                })
            )
            next_target.dispatchEvent(
                make_pointer_event("pointerenter", {
                    pointer_id,
                    pointer_type,
                    x,
                    y,
                    button: 0,
                    buttons,
                    pressure: buttons > 0 ? 0.5 : 0,
                    bubbles: false
                })
            )
            if (pointer_type === "mouse") {
                next_target.dispatchEvent(make_mouse_event("mouseover", { x, y, button: 0, buttons }))
                next_target.dispatchEvent(make_mouse_event("mouseenter", { x, y, button: 0, buttons, bubbles: false }))
            }
            hovered_el = next_target
        }

        const emit_move = (x: number, y: number) => {
            const rx = Math.round(x * 10) / 10
            const ry = Math.round(y * 10) / 10
            const ptr_target = resolve_pointer_target(rx, ry)
            if (!get_captured_element(pointer_id)) {
                emit_hover_transition(ptr_target, rx, ry, 1)
            }
            ptr_target.dispatchEvent(
                make_pointer_event("pointermove", {
                    pointer_id,
                    pointer_type,
                    x: rx,
                    y: ry,
                    button: 0,
                    buttons: 1,
                    pressure: 0.5
                })
            )

            if (pointer_type === "touch") {
                dispatch_touch_event(resolve_touch_target(), "touchmove", pointer_id, rx, ry)
            } else if (pointer_down_not_canceled) {
                ptr_target.dispatchEvent(make_mouse_event("mousemove", { x: rx, y: ry, button: 0, buttons: 1 }))
            }

            samples.push({ t: performance.now(), x: rx, y: ry })
            frames += 1
        }

        // 1. Pointer Down
        down_target.dispatchEvent(
            make_pointer_event("pointerover", {
                pointer_id,
                pointer_type,
                x: from.x,
                y: from.y,
                button: 0,
                buttons: 0,
                pressure: 0
            })
        )
        down_target.dispatchEvent(
            make_pointer_event("pointerenter", {
                pointer_id,
                pointer_type,
                x: from.x,
                y: from.y,
                button: 0,
                buttons: 0,
                pressure: 0,
                bubbles: false
            })
        )
        if (pointer_type === "mouse") {
            down_target.dispatchEvent(make_mouse_event("mouseover", { x: from.x, y: from.y, button: 0, buttons: 0 }))
            down_target.dispatchEvent(
                make_mouse_event("mouseenter", { x: from.x, y: from.y, button: 0, buttons: 0, bubbles: false })
            )
        }

        pointer_down_not_canceled = down_target.dispatchEvent(
            make_pointer_event("pointerdown", {
                pointer_id,
                pointer_type,
                x: from.x,
                y: from.y,
                button: 0,
                buttons: 1,
                pressure: 0.5
            })
        )

        if (pointer_type === "touch") {
            dispatch_touch_event(down_target, "touchstart", pointer_id, from.x, from.y)
        } else if (pointer_down_not_canceled) {
            down_target.dispatchEvent(
                make_mouse_event("mousedown", { x: from.x, y: from.y, button: 0, buttons: 1, detail: 1 })
            )
        }

        samples.push({ t: performance.now(), x: from.x, y: from.y })

        if (hold_start_ms > 0) {
            await wait_ms(hold_start_ms)
        }

        // 2. Interpolated Trajectory Moves
        const move_start_t = performance.now()
        const { body_times, tail_ms } = build_frame_ratios(duration_ms, hold_end_ms === 0)
        const body_end_t = body_times[body_times.length - 1] ?? duration_ms

        for (let i = 0; i < body_times.length; i += 1) {
            const rel_t = body_times[i]
            const is_last_body = i === body_times.length - 1
            const now_elapsed = performance.now() - move_start_t

            // Skip intermediate schedule ticks already superseded by a delayed timer to prevent catch-up velocity spikes
            if (!is_last_body && now_elapsed >= body_times[i + 1]) {
                continue
            }

            if (now_elapsed < rel_t) {
                await wait_ms(Math.max(1, rel_t - now_elapsed))
            }

            const progress_t = is_last_body ? rel_t : Math.min(body_end_t, performance.now() - move_start_t)
            const eased = evaluate_curve(curve, progress_t / duration_ms)
            emit_move(from.x + dx * eased, from.y + dy * eased)
        }

        if (tail_ms > 0) {
            // Schedule final tail relative to penultimate frame completion to stay cleanly below 10ms sampling throttles
            await wait_ms(tail_ms)
            emit_move(to.x, to.y)
        }

        // 3. Optional End-Hold Settle
        if (hold_end_ms > 0) {
            if (hold_end_ms >= 15) {
                const settle_wait = Math.min(16, Math.floor(hold_end_ms / 2))
                await wait_ms(settle_wait)
                emit_move(to.x, to.y)
                await wait_ms(Math.max(1, hold_end_ms - settle_wait))
            } else {
                await wait_ms(hold_end_ms)
            }
        }

        // 4. Pointer Up
        const up_target = resolve_pointer_target(to.x, to.y)
        up_target.dispatchEvent(
            make_pointer_event("pointerup", {
                pointer_id,
                pointer_type,
                x: to.x,
                y: to.y,
                button: 0,
                buttons: 0,
                pressure: 0
            })
        )

        if (pointer_type === "touch") {
            dispatch_touch_event(resolve_touch_target(), "touchend", pointer_id, to.x, to.y)
            up_target.dispatchEvent(
                make_pointer_event("pointerout", {
                    pointer_id,
                    pointer_type: "touch",
                    x: to.x,
                    y: to.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0
                })
            )
            up_target.dispatchEvent(
                make_pointer_event("pointerleave", {
                    pointer_id,
                    pointer_type: "touch",
                    x: to.x,
                    y: to.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0,
                    bubbles: false
                })
            )
        } else if (pointer_down_not_canceled) {
            up_target.dispatchEvent(make_mouse_event("mouseup", { x: to.x, y: to.y, button: 0, buttons: 0, detail: 1 }))
        }
    } finally {
        end_synthetic_pointer(pointer_id)
    }

    const actual_duration_ms = Math.round(performance.now() - started_at)
    const { peak_velocity, end_velocity } = summarize_velocities(samples)

    await wait_frames(1)

    return {
        ok: true,
        data: {
            mode,
            pointer: pointer_type,
            dry_run: false,
            ...(direction ? { direction } : {}),
            curve,
            from,
            to,
            delta: { x: dx, y: dy },
            distance_px,
            requested_duration_ms: duration_ms,
            actual_duration_ms,
            hold_start_ms,
            hold_end_ms,
            frames,
            peak_velocity,
            end_velocity,
            target,
            ...(to_target ? { to_target } : {})
        }
    }
}

export async function perform_swipe(
    raw_target: TargetInput | string | undefined,
    options: SwipeOptions
): Promise<{ ok: true; data: GestureResult } | { ok: false; error: ActionError }> {
    const pointer_type = options.pointer ?? "touch"
    const curve = options.curve ?? "linear"
    const scroll_into_view = options.scroll_into_view !== false

    let from: Point2D
    let area_box: RectBox
    let target_summary: TargetElementSummary
    let start_el_fallback: Element | null = null

    if (raw_target !== undefined) {
        const prepared = await resolve_and_prepare_target(raw_target, scroll_into_view, {
            check_disabled: true,
            check_obscured: true,
            compute_point: (rect, input) =>
                input.anchor
                    ? compute_anchor_point(rect, input.anchor)
                    : compute_default_swipe_start(rect, options.direction)
        })
        if (!prepared.ok) {
            return { ok: false, error: prepared.error }
        }
        const t = prepared.target
        from = t.point
        area_box =
            t.kind === "element"
                ? clip_rect_to_viewport(t.rect)
                : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
        start_el_fallback = t.el
        const hit_el = document.elementFromPoint(from.x, from.y) || t.el || document.body
        target_summary = {
            role: t.role,
            name: t.name,
            locator: t.locator,
            hit_element: describe_element_brief(hit_el),
            rect: t.rect
        }
    } else {
        area_box = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
        from = compute_default_swipe_start(area_box, options.direction)
        const hit_el = document.elementFromPoint(from.x, from.y) || document.body
        start_el_fallback = hit_el
        target_summary = {
            role: "viewport",
            name: document.title || "",
            locator: `${from.x},${from.y}`,
            hit_element: describe_element_brief(hit_el),
            rect: area_box
        }
    }

    if (options.distance !== undefined && (!Number.isFinite(options.distance.value) || options.distance.value <= 0)) {
        return invalid_options("Swipe distance must be greater than 0.")
    }

    const to = compute_swipe_end(from, area_box, options.direction, options.distance)
    const distance_px = Math.round(Math.hypot(to.x - from.x, to.y - from.y))
    if (distance_px < 1) {
        return invalid_options("Computed swipe distance is less than 1px.")
    }

    const timing = resolve_timing_options(options, 0, distance_px)
    if (!timing.ok) {
        return timing
    }

    return run_pointer_gesture({
        mode: "swipe",
        pointer_type,
        direction: options.direction,
        curve,
        from,
        to,
        duration_ms: timing.duration_ms,
        hold_start_ms: timing.hold_start_ms,
        hold_end_ms: timing.hold_end_ms,
        target: target_summary,
        dry_run: options.dry_run ?? false,
        start_el_fallback
    })
}

export async function perform_drag(
    raw_target: TargetInput | string,
    options: DragOptions
): Promise<{ ok: true; data: GestureResult } | { ok: false; error: ActionError }> {
    const has_to = options.to !== undefined
    const has_by = options.by !== undefined
    if (has_to === has_by) {
        return invalid_options("Drag requires exactly one of `to` or `by`.")
    }

    const pointer_type = options.pointer ?? "mouse"
    const curve = options.curve ?? "ease-in-out"
    const scroll_into_view = options.scroll_into_view !== false

    const prepared_from = await resolve_and_prepare_target(raw_target, scroll_into_view, {
        check_disabled: true,
        check_obscured: true
    })
    if (!prepared_from.ok) {
        return { ok: false, error: prepared_from.error }
    }

    const from_info = prepared_from.target
    const from = from_info.point
    const start_hit = document.elementFromPoint(from.x, from.y) || from_info.el || document.body
    const target_summary: TargetElementSummary = {
        role: from_info.role,
        name: from_info.name,
        locator: from_info.locator,
        hit_element: describe_element_brief(start_hit),
        rect: from_info.rect
    }

    let to: Point2D
    let to_summary: TargetElementSummary | undefined

    if (options.by) {
        to = {
            x: Math.round(from.x + options.by.x),
            y: Math.round(from.y + options.by.y)
        }
    } else {
        const dest_input = normalize_target_input(options.to!)
        const prepared_to = await resolve_and_prepare_target(dest_input, false, {
            check_disabled: false,
            check_obscured: false
        })
        if (!prepared_to.ok) {
            return { ok: false, error: prepared_to.error }
        }
        const dest_info = prepared_to.target
        to = dest_info.point
        const dest_hit = document.elementFromPoint(to.x, to.y) || dest_info.el || document.body
        to_summary = {
            role: dest_info.role,
            name: dest_info.name,
            locator: dest_info.locator,
            hit_element: describe_element_brief(dest_hit),
            rect: dest_info.rect
        }
    }

    const distance_px = Math.round(Math.hypot(to.x - from.x, to.y - from.y))
    if (distance_px < 1) {
        return invalid_options("Drag start and destination resolve to the same coordinate (< 1px).")
    }

    const timing = resolve_timing_options(options, 60, distance_px)
    if (!timing.ok) {
        return timing
    }

    return run_pointer_gesture({
        mode: "drag",
        pointer_type,
        curve,
        from,
        to,
        duration_ms: timing.duration_ms,
        hold_start_ms: timing.hold_start_ms,
        hold_end_ms: timing.hold_end_ms,
        target: target_summary,
        to_target: to_summary,
        dry_run: options.dry_run ?? false,
        start_el_fallback: from_info.el
    })
}
