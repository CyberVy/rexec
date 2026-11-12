import {
    normalize_target_input,
    type ActionError,
    type Point2D,
    type TapOptions,
    type TapResult,
    type TargetInput
} from "../../shared/protocol"
import {
    describe_element_brief,
    hit_test_point,
    is_element_disabled,
    is_rect_in_viewport,
    to_rect_box
} from "../dom/dom_utils"
import { compute_anchor_point, resolve_target } from "../dom/locator"

let next_pointer_id = 10

function wait_ms(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms)
    })
}

function wait_frames(count = 1): Promise<void> {
    return new Promise((resolve) => {
        let remaining = count
        const step = () => {
            remaining -= 1
            if (remaining <= 0) {
                resolve()
            } else {
                window.requestAnimationFrame(step)
            }
        }
        window.requestAnimationFrame(step)
    })
}

function show_dry_run_marker(rect: { x: number; y: number; w: number; h: number }, point: Point2D): void {
    const overlay = document.createElement("div")
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.cssText = ["position:fixed", "inset:0", "pointer-events:none", "z-index:2147483647"].join(";")

    const box = document.createElement("div")
    box.style.cssText = [
        "position:fixed",
        `left:${rect.x}px`,
        `top:${rect.y}px`,
        `width:${Math.max(2, rect.w)}px`,
        `height:${Math.max(2, rect.h)}px`,
        "border:2px solid #22c55e",
        "background:rgba(34,197,94,0.12)",
        "box-sizing:border-box",
        "border-radius:4px"
    ].join(";")

    const dot = document.createElement("div")
    dot.style.cssText = [
        "position:fixed",
        `left:${point.x - 6}px`,
        `top:${point.y - 6}px`,
        "width:12px",
        "height:12px",
        "border-radius:9999px",
        "background:#ef4444",
        "border:2px solid #ffffff",
        "box-shadow:0 0 0 2px rgba(0,0,0,0.25)"
    ].join(";")

    overlay.appendChild(box)
    overlay.appendChild(dot)
    document.documentElement.appendChild(overlay)
    window.setTimeout(() => overlay.remove(), 1200)
}

function make_pointer_event(
    type: string,
    params: {
        pointer_id: number
        pointer_type: "mouse" | "touch"
        x: number
        y: number
        button: number
        buttons: number
        pressure: number
        bubbles?: boolean
    }
): PointerEvent {
    return new PointerEvent(type, {
        bubbles: params.bubbles ?? true,
        cancelable: true,
        composed: true,
        view: window,
        pointerId: params.pointer_id,
        pointerType: params.pointer_type,
        isPrimary: true,
        width: params.pointer_type === "touch" ? 24 : 1,
        height: params.pointer_type === "touch" ? 24 : 1,
        clientX: params.x,
        clientY: params.y,
        screenX: params.x,
        screenY: params.y,
        button: params.button,
        buttons: params.buttons,
        pressure: params.pressure
    })
}

function make_mouse_event(
    type: string,
    params: {
        x: number
        y: number
        button: number
        buttons: number
        detail?: number
        bubbles?: boolean
    }
): MouseEvent {
    return new MouseEvent(type, {
        bubbles: params.bubbles ?? true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: params.x,
        clientY: params.y,
        screenX: params.x,
        screenY: params.y,
        button: params.button,
        buttons: params.buttons,
        detail: params.detail ?? 0
    })
}

function dispatch_touch_event(
    target: Element,
    type: "touchstart" | "touchend",
    touch_id: number,
    x: number,
    y: number
): boolean {
    if (typeof Touch !== "function" || typeof TouchEvent !== "function") {
        return true
    }

    try {
        const touch = new Touch({
            identifier: touch_id,
            target,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            pageX: x + window.scrollX,
            pageY: y + window.scrollY,
            radiusX: 12,
            radiusY: 12,
            force: type === "touchstart" ? 0.5 : 0
        })
        const active = type === "touchstart" ? [touch] : []
        const event = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            touches: active,
            targetTouches: active,
            changedTouches: [touch]
        })
        return target.dispatchEvent(event)
    } catch {
        return true
    }
}

function trigger_click_action(target: Element, x: number, y: number): void {
    let html_target: Element | null = target
    while (html_target && !(html_target instanceof HTMLElement)) {
        html_target = html_target.parentElement
    }
    if (html_target instanceof HTMLElement) {
        html_target.click()
        return
    }
    target.dispatchEvent(make_mouse_event("click", { x, y, button: 0, buttons: 0, detail: 1 }))
}

export async function perform_tap_or_click(
    raw_target: TargetInput | string,
    mode: "tap" | "click",
    options?: TapOptions
): Promise<{ ok: true; data: TapResult } | { ok: false; error: ActionError }> {
    const input = normalize_target_input(raw_target)
    const resolved = resolve_target(input)
    if (!resolved.ok) {
        return { ok: false, error: resolved.error }
    }

    const pointer_type: "mouse" | "touch" = options?.pointer ?? (mode === "tap" ? "touch" : "mouse")
    const button_name: "left" | "right" = options?.button ?? "left"
    const button_code = button_name === "right" ? 2 : 0
    const buttons_mask = button_name === "right" ? 2 : 1

    const target_info = resolved.target
    let point = target_info.point
    let rect = target_info.rect
    const target_el = target_info.el

    if (target_el && target_info.kind === "element") {
        if (is_element_disabled(target_el)) {
            return {
                ok: false,
                error: {
                    code: "DISABLED",
                    message: `Target ${target_info.role} ${target_info.name ? `"${target_info.name}" ` : ""}is disabled.`
                }
            }
        }

        const should_scroll = options?.scroll_into_view !== false
        if (should_scroll && !is_rect_in_viewport(rect)) {
            target_el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
            await wait_frames(1)
            rect = to_rect_box(target_el.getBoundingClientRect())
            point = compute_anchor_point(rect, input.anchor)
        }

        const hit = hit_test_point(target_el, point.x, point.y)
        if (!hit.ok) {
            return {
                ok: false,
                error: {
                    code: "OBSCURED",
                    message: `Target ${target_info.locator} at (${point.x}, ${point.y}) is obscured by ${describe_element_brief(hit.hit)}.`,
                    obscured_by: describe_element_brief(hit.hit)
                }
            }
        }
    }

    const dispatch_target = document.elementFromPoint(point.x, point.y) || target_el || document.body

    const dry_run = options?.dry_run ?? false
    if (dry_run) {
        show_dry_run_marker(rect, point)
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

    const pointer_id = next_pointer_id
    next_pointer_id += 1

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
        const touch_end_not_canceled = dispatch_touch_event(dispatch_target, "touchend", pointer_id, point.x, point.y)
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
        dispatch_target.dispatchEvent(make_mouse_event("mouseover", { x: point.x, y: point.y, button: 0, buttons: 0 }))
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
