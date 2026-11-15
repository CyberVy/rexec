import type { ActionError, FillOptions, FillResult, TargetElementSummary, TargetInput } from "../../shared/protocol"
import { describe_element_brief, is_element_disabled } from "../dom/dom_utils"
import {
    append_overlay_box,
    append_overlay_dot,
    invalid_options,
    mount_debug_overlay,
    resolve_and_prepare_target,
    summarize_dom_element,
    wait_frames
} from "../gestures/pointer_common"
import { dispatch_key_events_sync, resolve_key_spec } from "./keyboard"

const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit"
])

type EditableMatch =
    | { ok: true; kind: "input"; element: HTMLInputElement }
    | { ok: true; kind: "textarea"; element: HTMLTextAreaElement }
    | { ok: true; kind: "contenteditable"; element: HTMLElement }
    | { ok: false; error: ActionError }

function resolve_editable_element(element: HTMLElement): EditableMatch {
    if (element instanceof HTMLInputElement) {
        const input_type = (element.type || "text").toLowerCase()
        if (NON_TEXT_INPUT_TYPES.has(input_type)) {
            return {
                ok: false,
                error: invalid_options(`Cannot fill <input type="${input_type}">; use click/tap or select instead`)
                    .error
            }
        }
        if (element.readOnly) {
            return {
                ok: false,
                error: {
                    code: "DISABLED",
                    message: "Target input is read-only."
                }
            }
        }
        return { ok: true, kind: "input", element }
    }

    if (element instanceof HTMLTextAreaElement) {
        if (element.readOnly) {
            return {
                ok: false,
                error: {
                    code: "DISABLED",
                    message: "Target textarea is read-only."
                }
            }
        }
        return { ok: true, kind: "textarea", element }
    }

    if (element.isContentEditable) {
        return { ok: true, kind: "contenteditable", element }
    }

    return {
        ok: false,
        error: invalid_options(
            `Target <${element.tagName.toLowerCase()}> is not a fillable text input, textarea, or contenteditable element.`
        ).error
    }
}

function read_editable_value(editable: Extract<EditableMatch, { ok: true }>): string {
    if (editable.kind === "input" || editable.kind === "textarea") {
        return editable.element.value
    }
    return editable.element.textContent ?? ""
}

function write_editable_value(editable: Extract<EditableMatch, { ok: true }>, next_value: string): void {
    if (editable.kind === "input" || editable.kind === "textarea") {
        const target = editable.element
        const proto = editable.kind === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const value_setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
        if (value_setter) {
            value_setter.call(target, next_value)
        } else {
            target.value = next_value
        }
        try {
            target.setSelectionRange(next_value.length, next_value.length)
        } catch {
            // Some input types (e.g. email, number, datetime-local) disallow setSelectionRange.
        }
        return
    }

    editable.element.textContent = next_value
    const selection = window.getSelection()
    if (selection) {
        const range = document.createRange()
        range.selectNodeContents(editable.element)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
    }
}

function dispatch_enter_submit(element: HTMLElement): void {
    const enter_spec = resolve_key_spec("Enter")
    if (enter_spec.ok) {
        dispatch_key_events_sync(element, enter_spec.spec)
    }
}

/**
 * Fill text into an `<input>`, `<textarea>`, or `[contenteditable]` target, dispatching native Input/Change events
 * so React controlled and uncontrolled inputs both observe the update.
 */
export async function perform_fill(
    raw_target: TargetInput | string,
    options: FillOptions
): Promise<{ ok: true; data: FillResult } | { ok: false; error: ActionError }> {
    if (!options || typeof options.value !== "string") {
        return invalid_options("fill requires options.value to be a string.")
    }

    const scroll_into_view = options.scroll_into_view !== false
    const dry_run = options.dry_run === true
    const append = options.append === true
    const submit = options.submit === true
    const blur = options.blur === true

    const resolved = await resolve_and_prepare_target(raw_target, scroll_into_view, {
        check_disabled: true,
        check_obscured: true
    })
    if (!resolved.ok) {
        return { ok: false, error: resolved.error }
    }

    const target_info = resolved.target
    const { point, rect, el: target_el } = target_info
    const hit_target = document.elementFromPoint(point.x, point.y)
    const candidate = target_el ?? hit_target
    if (!(candidate instanceof HTMLElement)) {
        return invalid_options("Target did not resolve to an HTML editable element.")
    }
    if (target_info.kind === "point" && is_element_disabled(candidate)) {
        return {
            ok: false,
            error: {
                code: "DISABLED",
                message: `Target ${describe_element_brief(candidate)} is disabled.`
            }
        }
    }

    const editable = resolve_editable_element(candidate)
    if (!editable.ok) {
        return editable
    }

    const target_summary: TargetElementSummary =
        target_info.kind === "element" && target_el
            ? {
                  role: target_info.role,
                  name: target_info.name,
                  locator: target_info.locator,
                  hit_element: describe_element_brief(hit_target || candidate),
                  rect
              }
            : summarize_dom_element(candidate, hit_target || candidate)

    const previous_value = read_editable_value(editable)
    const next_value = append ? previous_value + options.value : options.value

    if (dry_run) {
        const overlay = mount_debug_overlay(1200)
        append_overlay_box(overlay, target_summary.rect, "#10b981")
        append_overlay_dot(overlay, point, "#10b981")
        return {
            ok: true,
            data: {
                mode: "fill",
                dry_run: true,
                point,
                previous_value,
                value: next_value,
                append,
                submitted: false,
                blurred: false,
                target: target_summary
            }
        }
    }

    if (document.activeElement !== editable.element) {
        editable.element.focus()
    }

    write_editable_value(editable, next_value)

    const input_type = append
        ? "insertText"
        : next_value.length === 0
          ? "deleteContentBackward"
          : "insertReplacementText"
    editable.element.dispatchEvent(
        new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: input_type,
            data: options.value.length > 0 ? options.value : null
        })
    )

    if (editable.kind !== "contenteditable" && editable.element.isConnected) {
        editable.element.dispatchEvent(new Event("change", { bubbles: true }))
    }

    await wait_frames(1)

    let submitted = false
    if (submit && editable.element.isConnected) {
        dispatch_enter_submit(editable.element)
        submitted = true
        await wait_frames(1)
    }

    let blurred = false
    if (blur && editable.element.isConnected && document.activeElement === editable.element) {
        editable.element.blur()
        blurred = true
        await wait_frames(1)
    }

    return {
        ok: true,
        data: {
            mode: "fill",
            dry_run: false,
            point,
            previous_value,
            value: next_value,
            append,
            submitted,
            blurred,
            target: target_summary
        }
    }
}
