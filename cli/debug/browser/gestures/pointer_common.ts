import {
    normalize_target_input,
    type ActionError,
    type Point2D,
    type RectBox,
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

const synthetic_active_ids = new Set<number>()
const synthetic_captures = new Map<number, Element>()
let is_capture_hook_installed = false

export function allocate_pointer_id(): number {
    const id = next_pointer_id
    next_pointer_id += 1
    return id
}

/** Shim Element pointer capture APIs for synthetic pointer IDs only; real OS pointer IDs delegate directly. */
export function ensure_synthetic_pointer_capture(): void {
    if (is_capture_hook_installed || typeof Element === "undefined") return
    is_capture_hook_installed = true

    const orig_set = Element.prototype.setPointerCapture
    const orig_release = Element.prototype.releasePointerCapture
    const orig_has = Element.prototype.hasPointerCapture

    Element.prototype.setPointerCapture = function (pointer_id: number) {
        if (synthetic_active_ids.has(pointer_id)) {
            synthetic_captures.set(pointer_id, this)
            return
        }
        orig_set.call(this, pointer_id)
    }

    Element.prototype.releasePointerCapture = function (pointer_id: number) {
        if (synthetic_active_ids.has(pointer_id)) {
            if (synthetic_captures.get(pointer_id) === this) {
                synthetic_captures.delete(pointer_id)
            }
            return
        }
        orig_release.call(this, pointer_id)
    }

    Element.prototype.hasPointerCapture = function (pointer_id: number) {
        if (synthetic_active_ids.has(pointer_id)) {
            return synthetic_captures.get(pointer_id) === this
        }
        return orig_has.call(this, pointer_id)
    }
}

export function begin_synthetic_pointer(pointer_id: number): void {
    ensure_synthetic_pointer_capture()
    synthetic_active_ids.add(pointer_id)
}

export function get_captured_element(pointer_id: number): Element | null {
    const el = synthetic_captures.get(pointer_id)
    if (!el || !el.isConnected) return null
    return el
}

export function end_synthetic_pointer(pointer_id: number): void {
    synthetic_captures.delete(pointer_id)
    synthetic_active_ids.delete(pointer_id)
}

export function wait_ms(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms)
    })
}

export function wait_frames(count = 1): Promise<void> {
    if (count <= 0) {
        return Promise.resolve()
    }
    if (document.hidden) {
        return wait_ms(count * 16)
    }
    return new Promise((resolve) => {
        let remaining = count
        let settled = false
        const finish = () => {
            if (settled) {
                return
            }
            settled = true
            window.clearTimeout(fallback_timer)
            resolve()
        }
        // Browsers pause requestAnimationFrame when a tab or window is hidden/occluded
        const fallback_timer = window.setTimeout(finish, Math.max(50, count * 40))
        const step = () => {
            if (settled) {
                return
            }
            remaining -= 1
            if (remaining <= 0) {
                finish()
            } else {
                window.requestAnimationFrame(step)
            }
        }
        window.requestAnimationFrame(step)
    })
}

export function make_pointer_event(
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

export function make_mouse_event(
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

export function dispatch_touch_event(
    target: Element,
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    touch_id: number,
    x: number,
    y: number
): boolean {
    if (typeof Touch !== "function" || typeof TouchEvent !== "function") {
        return true
    }

    try {
        const is_active = type === "touchstart" || type === "touchmove"
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
            force: is_active ? 0.5 : 0
        })
        const active = is_active ? [touch] : []
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

export function trigger_click_action(target: Element, x: number, y: number): void {
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

export interface PreparedTarget {
    kind: "element" | "point"
    el: Element | null
    point: Point2D
    rect: RectBox
    role: string
    name: string
    locator: string
}

export async function resolve_and_prepare_target(
    raw_target: TargetInput | string,
    scroll_into_view: boolean,
    options?: {
        check_disabled?: boolean
        check_obscured?: boolean
        compute_point?: (rect: RectBox, input: TargetInput) => Point2D
    }
): Promise<{ ok: true; target: PreparedTarget; input: TargetInput } | { ok: false; error: ActionError }> {
    const input = normalize_target_input(raw_target)
    const resolved = resolve_target(input)
    if (!resolved.ok) {
        return { ok: false, error: resolved.error }
    }

    const target_info = resolved.target
    let rect = target_info.rect
    const target_el = target_info.el

    if (target_el && target_info.kind === "element") {
        if ((options?.check_disabled ?? true) && is_element_disabled(target_el)) {
            return {
                ok: false,
                error: {
                    code: "DISABLED",
                    message: `Target ${target_info.role} ${target_info.name ? `"${target_info.name}" ` : ""}is disabled.`
                }
            }
        }

        if (scroll_into_view && !is_rect_in_viewport(rect)) {
            target_el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
            await wait_frames(1)
            rect = to_rect_box(target_el.getBoundingClientRect())
        }
    }

    const point = options?.compute_point
        ? options.compute_point(rect, input)
        : target_info.kind === "element"
          ? compute_anchor_point(rect, input.anchor)
          : target_info.point

    if (target_el && target_info.kind === "element" && (options?.check_obscured ?? true)) {
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

    return {
        ok: true,
        input,
        target: {
            kind: target_info.kind,
            el: target_el,
            point,
            rect,
            role: target_info.role,
            name: target_info.name,
            locator: target_info.locator
        }
    }
}

export function mount_debug_overlay(duration_ms = 1400): HTMLDivElement {
    const overlay = document.createElement("div")
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.cssText = ["position:fixed", "inset:0", "pointer-events:none", "z-index:2147483647"].join(";")
    document.documentElement.appendChild(overlay)
    window.setTimeout(() => overlay.remove(), duration_ms)
    return overlay
}

export function append_overlay_box(overlay: HTMLElement, rect: RectBox, color_hex = "#22c55e"): void {
    const box = document.createElement("div")
    box.style.cssText = [
        "position:fixed",
        `left:${rect.x}px`,
        `top:${rect.y}px`,
        `width:${Math.max(2, rect.w)}px`,
        `height:${Math.max(2, rect.h)}px`,
        `border:2px solid ${color_hex}`,
        `background:${color_hex}1f`,
        "box-sizing:border-box",
        "border-radius:4px"
    ].join(";")
    overlay.appendChild(box)
}

export function append_overlay_dot(overlay: HTMLElement, point: Point2D, color_hex = "#ef4444"): void {
    const dot = document.createElement("div")
    dot.style.cssText = [
        "position:fixed",
        `left:${point.x - 6}px`,
        `top:${point.y - 6}px`,
        "width:12px",
        "height:12px",
        "border-radius:9999px",
        `background:${color_hex}`,
        "border:2px solid #ffffff",
        "box-shadow:0 0 0 2px rgba(0,0,0,0.25)"
    ].join(";")
    overlay.appendChild(dot)
}

export function append_overlay_line(overlay: HTMLElement, from: Point2D, to: Point2D, color_hex = "#ef4444"): void {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length < 1) return

    const angle_deg = (Math.atan2(dy, dx) * 180) / Math.PI
    const line = document.createElement("div")
    line.style.cssText = [
        "position:fixed",
        `left:${from.x}px`,
        `top:${from.y - 1.5}px`,
        `width:${length}px`,
        "height:3px",
        `background:${color_hex}`,
        "transform-origin:0 50%",
        `transform:rotate(${angle_deg}deg)`,
        "border-radius:9999px",
        "opacity:0.9"
    ].join(";")
    overlay.appendChild(line)
}
