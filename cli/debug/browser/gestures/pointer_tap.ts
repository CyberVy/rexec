import type { ActionError, TapOptions, TapResult, TargetInput } from "../../shared/protocol"
import { describe_element_brief } from "../dom/dom_utils"
import {
    allocate_pointer_id,
    append_overlay_box,
    append_overlay_dot,
    begin_synthetic_pointer,
    dispatch_touch_event,
    end_synthetic_pointer,
    make_mouse_event,
    make_pointer_event,
    mount_debug_overlay,
    resolve_and_prepare_target,
    trigger_click_action,
    wait_frames,
    wait_ms
} from "./pointer_common"

export async function perform_tap_or_click(
    raw_target: TargetInput | string,
    mode: "tap" | "click",
    options?: TapOptions
): Promise<{ ok: true; data: TapResult } | { ok: false; error: ActionError }> {
    const prepared = await resolve_and_prepare_target(raw_target, options?.scroll_into_view !== false)
    if (!prepared.ok) {
        return { ok: false, error: prepared.error }
    }

    const pointer_type: "mouse" | "touch" = options?.pointer ?? (mode === "tap" ? "touch" : "mouse")
    const button_name: "left" | "right" = options?.button ?? "left"
    const button_code = button_name === "right" ? 2 : 0
    const buttons_mask = button_name === "right" ? 2 : 1

    const target_info = prepared.target
    const { point, rect, el: target_el } = target_info
    const dispatch_target = document.elementFromPoint(point.x, point.y) || target_el || document.body

    const dry_run = options?.dry_run ?? false
    if (dry_run) {
        const overlay = mount_debug_overlay(1200)
        append_overlay_box(overlay, rect)
        append_overlay_dot(overlay, point)
        return {
            ok: true,
            data: {
                mode,
                pointer: pointer_type,
                button: button_name,
                dry_run: true,
                point,
                target: {
                    role: target_info.role,
                    name: target_info.name,
                    locator: target_info.locator,
                    hit_element: describe_element_brief(dispatch_target),
                    rect
                }
            }
        }
    }

    const pointer_id = allocate_pointer_id()
    begin_synthetic_pointer(pointer_id)

    try {
        if (pointer_type === "touch") {
            dispatch_target.dispatchEvent(
                make_pointer_event("pointerover", {
                    pointer_id,
                    pointer_type: "touch",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0
                })
            )
            dispatch_target.dispatchEvent(
                make_pointer_event("pointerenter", {
                    pointer_id,
                    pointer_type: "touch",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0,
                    bubbles: false
                })
            )
            const pointer_down_not_canceled = dispatch_target.dispatchEvent(
                make_pointer_event("pointerdown", {
                    pointer_id,
                    pointer_type: "touch",
                    x: point.x,
                    y: point.y,
                    button: button_code,
                    buttons: buttons_mask,
                    pressure: 0.5
                })
            )
            const touch_start_not_canceled = dispatch_touch_event(
                dispatch_target,
                "touchstart",
                pointer_id,
                point.x,
                point.y
            )

            await wait_ms(16)

            dispatch_target.dispatchEvent(
                make_pointer_event("pointerup", {
                    pointer_id,
                    pointer_type: "touch",
                    x: point.x,
                    y: point.y,
                    button: button_code,
                    buttons: 0,
                    pressure: 0
                })
            )
            const touch_end_not_canceled = dispatch_touch_event(
                dispatch_target,
                "touchend",
                pointer_id,
                point.x,
                point.y
            )
            dispatch_target.dispatchEvent(
                make_pointer_event("pointerout", {
                    pointer_id,
                    pointer_type: "touch",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0
                })
            )
            dispatch_target.dispatchEvent(
                make_pointer_event("pointerleave", {
                    pointer_id,
                    pointer_type: "touch",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0,
                    bubbles: false
                })
            )

            if (touch_start_not_canceled && touch_end_not_canceled) {
                if (pointer_down_not_canceled) {
                    dispatch_target.dispatchEvent(
                        make_mouse_event("mouseover", { x: point.x, y: point.y, button: 0, buttons: 0 })
                    )
                    dispatch_target.dispatchEvent(
                        make_mouse_event("mousedown", {
                            x: point.x,
                            y: point.y,
                            button: button_code,
                            buttons: buttons_mask,
                            detail: 1
                        })
                    )
                    dispatch_target.dispatchEvent(
                        make_mouse_event("mouseup", {
                            x: point.x,
                            y: point.y,
                            button: button_code,
                            buttons: 0,
                            detail: 1
                        })
                    )
                }

                if (button_code === 0) {
                    trigger_click_action(dispatch_target, point.x, point.y)
                } else if (button_code === 2) {
                    dispatch_target.dispatchEvent(
                        make_mouse_event("contextmenu", {
                            x: point.x,
                            y: point.y,
                            button: 2,
                            buttons: 0
                        })
                    )
                }
            }
        } else {
            dispatch_target.dispatchEvent(
                make_pointer_event("pointerover", {
                    pointer_id,
                    pointer_type: "mouse",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0
                })
            )
            dispatch_target.dispatchEvent(
                make_pointer_event("pointerenter", {
                    pointer_id,
                    pointer_type: "mouse",
                    x: point.x,
                    y: point.y,
                    button: 0,
                    buttons: 0,
                    pressure: 0,
                    bubbles: false
                })
            )
            dispatch_target.dispatchEvent(
                make_mouse_event("mouseover", { x: point.x, y: point.y, button: 0, buttons: 0 })
            )
            dispatch_target.dispatchEvent(
                make_mouse_event("mouseenter", { x: point.x, y: point.y, button: 0, buttons: 0, bubbles: false })
            )

            const pointer_down_not_canceled = dispatch_target.dispatchEvent(
                make_pointer_event("pointerdown", {
                    pointer_id,
                    pointer_type: "mouse",
                    x: point.x,
                    y: point.y,
                    button: button_code,
                    buttons: buttons_mask,
                    pressure: 0.5
                })
            )
            if (pointer_down_not_canceled) {
                dispatch_target.dispatchEvent(
                    make_mouse_event("mousedown", {
                        x: point.x,
                        y: point.y,
                        button: button_code,
                        buttons: buttons_mask,
                        detail: 1
                    })
                )
            }

            await wait_ms(16)

            dispatch_target.dispatchEvent(
                make_pointer_event("pointerup", {
                    pointer_id,
                    pointer_type: "mouse",
                    x: point.x,
                    y: point.y,
                    button: button_code,
                    buttons: 0,
                    pressure: 0
                })
            )
            if (pointer_down_not_canceled) {
                dispatch_target.dispatchEvent(
                    make_mouse_event("mouseup", {
                        x: point.x,
                        y: point.y,
                        button: button_code,
                        buttons: 0,
                        detail: 1
                    })
                )
            }

            if (button_code === 0) {
                trigger_click_action(dispatch_target, point.x, point.y)
            } else if (button_code === 2) {
                dispatch_target.dispatchEvent(
                    make_mouse_event("contextmenu", {
                        x: point.x,
                        y: point.y,
                        button: 2,
                        buttons: 0
                    })
                )
            }
        }
    } finally {
        end_synthetic_pointer(pointer_id)
    }

    await wait_frames(1)

    return {
        ok: true,
        data: {
            mode,
            pointer: pointer_type,
            button: button_name,
            dry_run: false,
            point,
            target: {
                role: target_info.role,
                name: target_info.name,
                locator: target_info.locator,
                hit_element: describe_element_brief(dispatch_target),
                rect
            }
        }
    }
}
