import type {
    ActionError,
    LongPressOptions,
    LongPressResult,
    Point2D,
    TargetElementSummary,
    TargetInput
} from "../../shared/protocol"
import { describe_element_brief } from "../dom/dom_utils"
import {
    allocate_pointer_id,
    append_overlay_box,
    append_overlay_dot,
    begin_synthetic_pointer,
    dispatch_touch_event,
    end_synthetic_pointer,
    get_captured_element,
    invalid_options,
    make_mouse_event,
    make_pointer_event,
    MAX_TOTAL_GESTURE_MS,
    mount_debug_overlay,
    resolve_and_prepare_target,
    wait_frames,
    wait_ms
} from "./pointer_common"

const DEFAULT_LONG_PRESS_DURATION_MS = 600

function dispatch_hover_boundary(
    target: Element,
    boundary: "enter" | "leave",
    pointer_id: number,
    pointer_type: "touch" | "mouse",
    point: Point2D
): void {
    const over_type = boundary === "enter" ? "pointerover" : "pointerout"
    const edge_type = boundary === "enter" ? "pointerenter" : "pointerleave"

    target.dispatchEvent(
        make_pointer_event(over_type, {
            pointer_id,
            pointer_type,
            x: point.x,
            y: point.y,
            button: 0,
            buttons: 0,
            pressure: 0
        })
    )
    target.dispatchEvent(
        make_pointer_event(edge_type, {
            pointer_id,
            pointer_type,
            x: point.x,
            y: point.y,
            button: 0,
            buttons: 0,
            pressure: 0,
            bubbles: false
        })
    )

    if (pointer_type === "mouse" && boundary === "enter") {
        target.dispatchEvent(make_mouse_event("mouseover", { x: point.x, y: point.y, button: 0, buttons: 0 }))
        target.dispatchEvent(
            make_mouse_event("mouseenter", { x: point.x, y: point.y, button: 0, buttons: 0, bubbles: false })
        )
    }
}

/** Perform a stationary press-and-hold gesture on a resolved target for `duration_ms`. */
export async function perform_long_press(
    raw_target: TargetInput | string,
    options?: LongPressOptions
): Promise<{ ok: true; data: LongPressResult } | { ok: false; error: ActionError }> {
    const pointer_type = options?.pointer ?? "touch"
    if (pointer_type !== "touch" && pointer_type !== "mouse") {
        return invalid_options(`Invalid pointer type: ${String(options?.pointer)} (expected "touch" or "mouse").`)
    }

    const raw_duration = options?.duration_ms ?? DEFAULT_LONG_PRESS_DURATION_MS
    if (!Number.isFinite(raw_duration) || raw_duration <= 0) {
        return invalid_options(`duration_ms must be a positive number, got: ${String(options?.duration_ms)}.`)
    }
    const duration_ms = Math.max(1, Math.round(raw_duration))
    if (duration_ms > MAX_TOTAL_GESTURE_MS) {
        return invalid_options(
            `Long press duration (${duration_ms}ms) exceeds bridge safety limit (${MAX_TOTAL_GESTURE_MS}ms).`
        )
    }

    const prepared = await resolve_and_prepare_target(raw_target, options?.scroll_into_view !== false)
    if (!prepared.ok) {
        return { ok: false, error: prepared.error }
    }

    const target_info = prepared.target
    const { point, rect, el: target_el } = target_info
    const down_target = document.elementFromPoint(point.x, point.y) || target_el || document.body
    const target_summary: TargetElementSummary = {
        role: target_info.role,
        name: target_info.name,
        locator: target_info.locator,
        hit_element: describe_element_brief(down_target),
        rect
    }

    const dry_run = options?.dry_run ?? false
    if (dry_run) {
        const overlay = mount_debug_overlay(1200)
        append_overlay_box(overlay, rect)
        append_overlay_dot(overlay, point)
        return {
            ok: true,
            data: {
                mode: "long_press",
                pointer: pointer_type,
                dry_run: true,
                point,
                requested_duration_ms: duration_ms,
                actual_duration_ms: 0,
                target: target_summary
            }
        }
    }

    const pointer_id = allocate_pointer_id()
    const started_at = performance.now()
    begin_synthetic_pointer(pointer_id)

    try {
        dispatch_hover_boundary(down_target, "enter", pointer_id, pointer_type, point)

        const pointer_down_not_canceled = down_target.dispatchEvent(
            make_pointer_event("pointerdown", {
                pointer_id,
                pointer_type,
                x: point.x,
                y: point.y,
                button: 0,
                buttons: 1,
                pressure: 0.5
            })
        )

        if (pointer_type === "touch") {
            dispatch_touch_event(down_target, "touchstart", pointer_id, point.x, point.y)
        } else if (pointer_down_not_canceled) {
            down_target.dispatchEvent(
                make_mouse_event("mousedown", { x: point.x, y: point.y, button: 0, buttons: 1, detail: 1 })
            )
        }

        await wait_ms(duration_ms)

        const captured = get_captured_element(pointer_id)
        const up_target =
            captured ??
            (pointer_type === "touch" && down_target.isConnected
                ? down_target
                : document.elementFromPoint(point.x, point.y) ||
                  (down_target.isConnected ? down_target : document.body))

        up_target.dispatchEvent(
            make_pointer_event("pointerup", {
                pointer_id,
                pointer_type,
                x: point.x,
                y: point.y,
                button: 0,
                buttons: 0,
                pressure: 0
            })
        )

        if (pointer_type === "touch") {
            const touch_target = down_target.isConnected ? down_target : document.body
            dispatch_touch_event(touch_target, "touchend", pointer_id, point.x, point.y)
            dispatch_hover_boundary(up_target, "leave", pointer_id, pointer_type, point)
        } else if (pointer_down_not_canceled) {
            up_target.dispatchEvent(
                make_mouse_event("mouseup", { x: point.x, y: point.y, button: 0, buttons: 0, detail: 1 })
            )
        }
    } finally {
        end_synthetic_pointer(pointer_id)
    }

    const actual_duration_ms = Math.round(performance.now() - started_at)
    await wait_frames(1)

    return {
        ok: true,
        data: {
            mode: "long_press",
            pointer: pointer_type,
            dry_run: false,
            point,
            requested_duration_ms: duration_ms,
            actual_duration_ms,
            target: target_summary
        }
    }
}
