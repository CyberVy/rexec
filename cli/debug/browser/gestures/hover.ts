import type {
    ActionError,
    GestureCurve,
    HoverOptions,
    HoverResult,
    Point2D,
    TargetElementSummary,
    TargetInput
} from "../../shared/protocol"
import { describe_element_brief } from "../dom/dom_utils"
import {
    allocate_pointer_id,
    append_overlay_box,
    append_overlay_dot,
    append_overlay_line,
    evaluate_curve,
    invalid_options,
    make_mouse_event,
    make_pointer_event,
    mount_debug_overlay,
    resolve_and_prepare_target,
    resolve_timing_options,
    summarize_dom_element,
    wait_frames,
    wait_ms
} from "./pointer_common"

const VALID_CURVES = new Set<GestureCurve>(["linear", "ease-in", "ease-out", "ease-in-out"])

let active_hover_state: {
    element: Element
    point: Point2D
    pointer_id: number
} | null = null

function build_target_summary(
    resolved_target: Extract<Awaited<ReturnType<typeof resolve_and_prepare_target>>, { ok: true }>["target"],
    hit_fallback: Element | null
): TargetElementSummary {
    const hit_el = document.elementFromPoint(resolved_target.point.x, resolved_target.point.y) || hit_fallback
    if (resolved_target.kind === "element" && resolved_target.el) {
        return {
            role: resolved_target.role,
            name: resolved_target.name,
            locator: resolved_target.locator,
            hit_element: describe_element_brief(hit_el || resolved_target.el),
            rect: resolved_target.rect
        }
    }
    if (hit_el) {
        return summarize_dom_element(hit_el, hit_el)
    }
    return {
        role: resolved_target.role,
        name: resolved_target.name,
        locator: resolved_target.locator,
        hit_element: describe_element_brief(hit_el),
        rect: resolved_target.rect
    }
}

function collect_ancestors_outer_to_inner(element: Element): Element[] {
    const chain: Element[] = []
    let current: Element | null = element
    while (current) {
        chain.push(current)
        current = current.parentElement
    }
    chain.reverse()
    return chain
}

function transition_hover_target(
    prev_el: Element | null,
    next_el: Element | null,
    point: Point2D,
    pointer_id: number
): Element | null {
    const safe_prev = prev_el && prev_el.isConnected ? prev_el : null
    if (safe_prev === next_el) {
        return next_el
    }

    if (safe_prev) {
        safe_prev.dispatchEvent(
            make_pointer_event("pointerout", {
                pointer_id,
                pointer_type: "mouse",
                x: point.x,
                y: point.y,
                button: 0,
                buttons: 0,
                pressure: 0,
                related_target: next_el
            })
        )
        safe_prev.dispatchEvent(
            make_mouse_event("mouseout", {
                x: point.x,
                y: point.y,
                button: 0,
                buttons: 0,
                related_target: next_el
            })
        )

        let exited: Element | null = safe_prev
        while (exited && (!next_el || !exited.contains(next_el))) {
            exited.dispatchEvent(
                make_pointer_event("pointerleave", {
                    pointer_id,
                    pointer_type: "mouse",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0,
                    bubbles: false,
                    related_target: next_el
                })
            )
            exited.dispatchEvent(
                make_mouse_event("mouseleave", {
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    bubbles: false,
                    related_target: next_el
                })
            )
            exited = exited.parentElement
        }
    }

    if (next_el && next_el.isConnected) {
        next_el.dispatchEvent(
            make_pointer_event("pointerover", {
                pointer_id,
                pointer_type: "mouse",
                x: point.x,
                y: point.y,
                button: 0,
                buttons: 0,
                pressure: 0,
                related_target: safe_prev
            })
        )
        next_el.dispatchEvent(
            make_mouse_event("mouseover", {
                x: point.x,
                y: point.y,
                button: 0,
                buttons: 0,
                related_target: safe_prev
            })
        )

        const ancestors = collect_ancestors_outer_to_inner(next_el)
        for (const ancestor of ancestors) {
            if (safe_prev && ancestor.contains(safe_prev)) {
                continue
            }
            ancestor.dispatchEvent(
                make_pointer_event("pointerenter", {
                    pointer_id,
                    pointer_type: "mouse",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0,
                    bubbles: false,
                    related_target: safe_prev
                })
            )
            ancestor.dispatchEvent(
                make_mouse_event("mouseenter", {
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    bubbles: false,
                    related_target: safe_prev
                })
            )
        }
    }

    return next_el
}

function dispatch_hover_move(element: Element, point: Point2D, pointer_id: number): void {
    element.dispatchEvent(
        make_pointer_event("pointermove", {
            pointer_id,
            pointer_type: "mouse",
            x: point.x,
            y: point.y,
            button: -1,
            buttons: 0,
            pressure: 0
        })
    )
    element.dispatchEvent(
        make_mouse_event("mousemove", {
            x: point.x,
            y: point.y,
            button: 0,
            buttons: 0
        })
    )
}

/**
 * Move an unpressed desktop mouse pointer (`pointerType: "mouse"`, `buttons: 0`) onto a target element
 * or coordinate, firing `pointerover`/`pointerenter`/`mouseover`/`mouseenter` and `pointermove`/`mousemove`,
 * with optional `--from`, smooth curved interpolation, `--hold <ms>`, and `--leave`.
 */
export async function perform_hover(
    raw_target: TargetInput | string,
    options?: HoverOptions
): Promise<{ ok: true; data: HoverResult } | { ok: false; error: ActionError }> {
    const curve: GestureCurve = options?.curve ?? "ease-out"
    if (!VALID_CURVES.has(curve)) {
        return invalid_options(
            `Invalid curve: ${String(options?.curve)} (expected linear, ease-in, ease-out, ease-in-out).`
        )
    }

    const scroll_into_view = options?.scroll_into_view !== false
    const dry_run = options?.dry_run === true
    const leave = options?.leave === true

    const resolved_to = await resolve_and_prepare_target(raw_target, scroll_into_view, {
        check_disabled: true,
        check_obscured: true
    })
    if (!resolved_to.ok) {
        return { ok: false, error: resolved_to.error }
    }

    const to_info = resolved_to.target
    const to = { x: Math.round(to_info.point.x), y: Math.round(to_info.point.y) }
    const to_fallback = to_info.el || document.elementFromPoint(to.x, to.y) || document.body
    const to_summary = build_target_summary(to_info, to_fallback)

    let from: Point2D
    let from_summary: TargetElementSummary | undefined
    let from_fallback: Element | null = null

    if (options?.from !== undefined) {
        const resolved_from = await resolve_and_prepare_target(options.from, false, {
            check_disabled: false,
            check_obscured: false
        })
        if (!resolved_from.ok) {
            return { ok: false, error: resolved_from.error }
        }
        const from_info = resolved_from.target
        from = { x: Math.round(from_info.point.x), y: Math.round(from_info.point.y) }
        from_fallback = from_info.el || document.elementFromPoint(from.x, from.y) || document.body
        from_summary = build_target_summary(from_info, from_fallback)
    } else if (active_hover_state) {
        if (!active_hover_state.element.isConnected) {
            active_hover_state = null
            from = to
        } else {
            from = active_hover_state.point
        }
    } else {
        from = to
    }

    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance_px = Math.round(Math.hypot(dx, dy))

    const has_explicit_timing =
        options?.speed !== undefined ||
        options?.duration_ms !== undefined ||
        options?.velocity !== undefined ||
        options?.instant !== undefined

    const timing = resolve_timing_options(
        distance_px === 0 && !has_explicit_timing
            ? {
                  instant: true,
                  hold_end_ms: options?.hold_ms ?? 0
              }
            : {
                  speed: options?.speed,
                  duration_ms: options?.duration_ms,
                  velocity: options?.velocity,
                  instant: options?.instant,
                  hold_end_ms: options?.hold_ms ?? 0
              },
        0,
        distance_px
    )
    if (!timing.ok) {
        return timing
    }

    const duration_ms = timing.duration_ms
    const hold_ms = timing.hold_end_ms

    if (dry_run) {
        const overlay = mount_debug_overlay(1400)
        append_overlay_box(overlay, to_summary.rect, "#06b6d4")
        if (from_summary) {
            append_overlay_box(overlay, from_summary.rect, "#3b82f6")
        }
        if (distance_px > 0) {
            append_overlay_line(overlay, from, to, "#06b6d4")
            append_overlay_dot(overlay, from, "#3b82f6")
        }
        append_overlay_dot(overlay, to, "#06b6d4")

        return {
            ok: true,
            data: {
                mode: "hover",
                dry_run: true,
                curve,
                from,
                to,
                distance_px,
                requested_duration_ms: duration_ms,
                actual_duration_ms: 0,
                hold_ms,
                frames: 0,
                left: leave,
                target: to_summary,
                ...(from_summary ? { from_target: from_summary } : {})
            }
        }
    }

    const pointer_id = active_hover_state?.pointer_id ?? allocate_pointer_id()
    let current_hovered: Element | null = active_hover_state?.element ?? null
    if (current_hovered && !current_hovered.isConnected) {
        current_hovered = null
    }

    const started_at = performance.now()
    let frames = 0

    const step_to = (rx: number, ry: number, fallback: Element | null) => {
        const pt = { x: Math.round(rx), y: Math.round(ry) }
        const hit =
            document.elementFromPoint(pt.x, pt.y) ||
            (fallback && fallback.isConnected ? fallback : null) ||
            document.body
        current_hovered = transition_hover_target(current_hovered, hit, pt, pointer_id)
        if (current_hovered) {
            dispatch_hover_move(current_hovered, pt, pointer_id)
        }
        frames += 1
    }

    if (options?.from !== undefined || distance_px > 0) {
        step_to(from.x, from.y, from_fallback ?? to_fallback)
    }

    if (duration_ms > 0) {
        const steps = Math.max(2, Math.min(240, Math.round(duration_ms / 16)))
        const step_times: number[] = []
        for (let i = 1; i <= steps; i += 1) {
            step_times.push((duration_ms * i) / steps)
        }

        const move_start_t = performance.now()
        for (let i = 0; i < step_times.length; i += 1) {
            const rel_t = step_times[i]
            const is_last = i === step_times.length - 1
            const now_elapsed = performance.now() - move_start_t
            if (!is_last && now_elapsed >= step_times[i + 1]) {
                continue
            }
            if (now_elapsed < rel_t) {
                await wait_ms(Math.max(1, rel_t - now_elapsed))
            }
            const progress = is_last ? 1 : Math.min(1, (performance.now() - move_start_t) / duration_ms)
            const eased = evaluate_curve(curve, progress)
            step_to(from.x + dx * eased, from.y + dy * eased, to_fallback)
        }
    } else if (distance_px > 0 || options?.from === undefined) {
        step_to(to.x, to.y, to_fallback)
    }

    if (hold_ms > 0) {
        await wait_ms(hold_ms)
    }

    if (leave) {
        transition_hover_target(current_hovered, null, to, pointer_id)
        active_hover_state = null
    } else if (current_hovered && current_hovered.isConnected) {
        active_hover_state = {
            element: current_hovered,
            point: to,
            pointer_id
        }
    } else {
        active_hover_state = null
    }

    await wait_frames(1)

    return {
        ok: true,
        data: {
            mode: "hover",
            dry_run: false,
            curve,
            from,
            to,
            distance_px,
            requested_duration_ms: duration_ms,
            actual_duration_ms: Math.max(0, Math.round(performance.now() - started_at - hold_ms)),
            hold_ms,
            frames,
            left: leave,
            target: to_summary,
            ...(from_summary ? { from_target: from_summary } : {})
        }
    }
}
