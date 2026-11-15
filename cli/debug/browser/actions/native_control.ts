import type {
    ActionError,
    SelectOptionMatchBy,
    SelectOptions,
    SelectOptionSummary,
    SelectResult,
    TargetElementSummary,
    TargetInput
} from "../../shared/protocol"
import { describe_element_brief, is_element_disabled, normalize_whitespace } from "../dom/dom_utils"
import {
    append_overlay_box,
    append_overlay_dot,
    invalid_options,
    mount_debug_overlay,
    resolve_and_prepare_target,
    summarize_dom_element,
    wait_frames
} from "../gestures/pointer_common"

const TEMPORAL_FORMAT_HINTS: Record<string, string> = {
    date: "YYYY-MM-DD (e.g. 2026-11-16)",
    "datetime-local": "YYYY-MM-DDTHH:mm (e.g. 2026-11-16T22:30)",
    time: "HH:mm or HH:mm:ss (e.g. 22:30)",
    month: "YYYY-MM (e.g. 2026-11)",
    week: "YYYY-Www (e.g. 2026-W46)"
}

const TRUE_TOKENS = new Set(["true", "on", "checked", "selected", "yes", "1"])
const FALSE_TOKENS = new Set(["false", "off", "unchecked", "no", "0"])

const NATIVE_OPTION_MATCH_MODES = new Set<SelectOptionMatchBy>(["auto", "value", "label", "index"])

type ResolvedNativeControl =
    | { family: "select"; kind: "select" | "select-multiple"; element: HTMLSelectElement }
    | { family: "toggle"; kind: "checkbox" | "switch" | "radio"; element: HTMLInputElement }
    | {
          family: "value"
          kind: "range" | "color" | "date" | "datetime-local" | "time" | "month" | "week"
          element: HTMLInputElement
      }

function classify_native_control(
    element: HTMLElement
): { ok: true; control: ResolvedNativeControl } | { ok: false; error: ActionError } {
    if (element instanceof HTMLSelectElement) {
        return {
            ok: true,
            control: {
                family: "select",
                kind: element.multiple ? "select-multiple" : "select",
                element
            }
        }
    }

    if (element instanceof HTMLInputElement) {
        const input_type = (element.type || "text").toLowerCase()
        if (input_type === "checkbox") {
            return {
                ok: true,
                control: {
                    family: "toggle",
                    kind: element.hasAttribute("switch") ? "switch" : "checkbox",
                    element
                }
            }
        }
        if (input_type === "radio") {
            return { ok: true, control: { family: "toggle", kind: "radio", element } }
        }
        if (input_type === "range" || input_type === "color") {
            return { ok: true, control: { family: "value", kind: input_type, element } }
        }
        if (
            input_type === "date" ||
            input_type === "datetime-local" ||
            input_type === "time" ||
            input_type === "month" ||
            input_type === "week"
        ) {
            if (element.readOnly) {
                return {
                    ok: false,
                    error: {
                        code: "DISABLED",
                        message: `Target <input type="${input_type}"> is read-only.`
                    }
                }
            }
            return { ok: true, control: { family: "value", kind: input_type, element } }
        }
        if (input_type === "file") {
            return invalid_options(
                'Cannot set <input type="file"> programmatically due to browser security restrictions.'
            )
        }
        if (input_type === "button" || input_type === "submit" || input_type === "reset" || input_type === "image") {
            return invalid_options(`Use "tap" or "click" for <input type="${input_type}"> buttons.`)
        }
        return invalid_options(`Use "fill" for <input type="${input_type}"> text inputs.`)
    }

    if (element instanceof HTMLTextAreaElement || element.isContentEditable) {
        return invalid_options('Use "fill" for <textarea> or contenteditable text inputs.')
    }

    return invalid_options(
        `Target <${element.tagName.toLowerCase()}> is not a supported native control (select, checkbox, switch, radio, range, color, or date/time picker).`
    )
}

function set_native_input_value(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (setter) {
        setter.call(input, value)
    } else {
        input.value = value
    }
}

function set_native_option_selected(option: HTMLOptionElement, selected: boolean): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, "selected")?.set
    if (setter) {
        setter.call(option, selected)
    } else {
        option.selected = selected
    }
}

function dispatch_value_events(element: Element, input_data: string | null): void {
    element.dispatchEvent(
        new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertReplacementText",
            data: input_data
        })
    )
    if (element.isConnected) {
        element.dispatchEvent(new Event("change", { bubbles: true }))
    }
}

function get_option_label(option: HTMLOptionElement): string {
    return normalize_whitespace(option.label || option.textContent || "")
}

function format_available_options(select: HTMLSelectElement): string {
    const options = Array.from(select.options)
    const preview = options.slice(0, 12).map((opt, idx) => {
        const label = get_option_label(opt)
        const disabled_tag = opt.matches(":disabled") ? " [disabled]" : ""
        return `#${idx + 1} value=${JSON.stringify(opt.value)} label=${JSON.stringify(label)}${disabled_tag}`
    })
    const remaining = options.length - preview.length
    return remaining > 0 ? `${preview.join(", ")}, ... (+${remaining} more)` : preview.join(", ")
}

function resolve_option_by_index(
    select: HTMLSelectElement,
    one_based_index: number
): { ok: true; option: HTMLOptionElement; summary: SelectOptionSummary } | { ok: false; error: ActionError } {
    if (!Number.isInteger(one_based_index) || one_based_index < 1 || one_based_index > select.options.length) {
        return invalid_options(
            `Option index ${one_based_index} is out of bounds (expected 1..${select.options.length}). Available: ${format_available_options(select)}`
        )
    }
    const option = select.options[one_based_index - 1]
    if (option.matches(":disabled")) {
        return {
            ok: false,
            error: {
                code: "DISABLED",
                message: `Option #${one_based_index} (${JSON.stringify(get_option_label(option))}) is disabled.`
            }
        }
    }
    return {
        ok: true,
        option,
        summary: {
            index: one_based_index,
            value: option.value,
            label: get_option_label(option)
        }
    }
}

function resolve_option_by_query(
    select: HTMLSelectElement,
    query: string,
    match_by: SelectOptionMatchBy
): { ok: true; option: HTMLOptionElement; summary: SelectOptionSummary } | { ok: false; error: ActionError } {
    const options = Array.from(select.options)

    if (match_by === "index") {
        const parsed = Number(query.trim())
        return resolve_option_by_index(select, parsed)
    }

    const match_by_value = (): HTMLOptionElement[] => options.filter((opt) => opt.value === query)
    const match_by_label = (): { matched: HTMLOptionElement[]; ambiguous: boolean } => {
        const norm_query = normalize_whitespace(query)
        const exact = options.filter((opt) => {
            const label = get_option_label(opt)
            const text = normalize_whitespace(opt.textContent || "")
            return label === norm_query || text === norm_query
        })
        if (exact.length > 0) {
            return { matched: exact, ambiguous: false }
        }
        const lower = norm_query.toLowerCase()
        const ci = options.filter((opt) => {
            const label = get_option_label(opt).toLowerCase()
            const text = normalize_whitespace(opt.textContent || "").toLowerCase()
            return label === lower || text === lower
        })
        return { matched: ci, ambiguous: ci.length > 1 }
    }

    let candidate: HTMLOptionElement | undefined
    if (match_by === "value") {
        candidate = match_by_value()[0]
    } else if (match_by === "label") {
        const res = match_by_label()
        if (res.ambiguous) {
            return invalid_options(
                `Option label ${JSON.stringify(query)} matches multiple options case-insensitively. Specify exact case or match by value/index.`
            )
        }
        candidate = res.matched[0]
    } else {
        candidate = match_by_value()[0]
        if (!candidate) {
            const res = match_by_label()
            if (res.ambiguous) {
                return invalid_options(
                    `Option label ${JSON.stringify(query)} matches multiple options case-insensitively. Specify exact case or match by value/index.`
                )
            }
            candidate = res.matched[0]
        }
    }

    if (!candidate) {
        return invalid_options(
            `Option ${JSON.stringify(query)} not found in <select>. Available: ${format_available_options(select)}`
        )
    }

    const index_one_based = options.indexOf(candidate) + 1
    if (candidate.matches(":disabled")) {
        return {
            ok: false,
            error: {
                code: "DISABLED",
                message: `Option #${index_one_based} (${JSON.stringify(candidate.value)}) is disabled.`
            }
        }
    }

    return {
        ok: true,
        option: candidate,
        summary: {
            index: index_one_based,
            value: candidate.value,
            label: get_option_label(candidate)
        }
    }
}

function summarize_selected_options(select: HTMLSelectElement): SelectOptionSummary[] {
    const all_options = Array.from(select.options)
    return Array.from(select.selectedOptions).map((opt) => ({
        index: all_options.indexOf(opt) + 1,
        value: opt.value,
        label: get_option_label(opt)
    }))
}

async function apply_select_element(
    select: HTMLSelectElement,
    control_kind: "select" | "select-multiple",
    options: SelectOptions,
    match_by: SelectOptionMatchBy,
    point: { x: number; y: number },
    target_summary: TargetElementSummary,
    dry_run: boolean
): Promise<{ ok: true; data: SelectResult } | { ok: false; error: ActionError }> {
    const all_options = Array.from(select.options)
    if (all_options.length === 0) {
        return invalid_options("Target <select> has no <option> elements.")
    }

    const previous_options = Array.from(select.selectedOptions)
    const previous_values = previous_options.map((opt) => opt.value)

    let target_options: HTMLOptionElement[] = []
    let target_summaries: SelectOptionSummary[] = []

    if (options.clear) {
        if (!select.multiple) {
            return invalid_options(
                "Cannot --clear a single-selection <select>; specify an option value, --label, or --index."
            )
        }
    } else if (options.index !== undefined) {
        if (options.values && options.values.length > 0) {
            return invalid_options("Cannot combine --index with explicit option values.")
        }
        const resolved = resolve_option_by_index(select, options.index)
        if (!resolved.ok) return resolved
        target_options = [resolved.option]
        target_summaries = [resolved.summary]
    } else {
        const queries = options.values ?? []
        if (queries.length === 0) {
            return invalid_options("select requires an option value, --label, --index, or --clear.")
        }
        if (!select.multiple && queries.length > 1) {
            return invalid_options('Target <select> does not have the "multiple" attribute; pass only one option.')
        }

        const seen = new Set<HTMLOptionElement>()
        for (const query of queries) {
            const resolved = resolve_option_by_query(select, query, match_by)
            if (!resolved.ok) return resolved
            if (!seen.has(resolved.option)) {
                seen.add(resolved.option)
                target_options.push(resolved.option)
                target_summaries.push(resolved.summary)
            }
        }
    }

    const changed =
        previous_options.length !== target_options.length ||
        previous_options.some((opt, idx) => opt !== target_options[idx])

    if (dry_run) {
        const overlay = mount_debug_overlay(1200)
        append_overlay_box(overlay, target_summary.rect, "#8b5cf6")
        append_overlay_dot(overlay, point, "#8b5cf6")
        return {
            ok: true,
            data: {
                mode: "select",
                control_kind,
                dry_run: true,
                changed,
                point,
                previous_values,
                values: target_options.map((opt) => opt.value),
                selected_options: target_summaries,
                target: target_summary
            }
        }
    }

    if (document.activeElement !== select) {
        select.focus()
    }

    if (changed) {
        const target_set = new Set(target_options)
        for (const opt of all_options) {
            set_native_option_selected(opt, target_set.has(opt))
        }
        dispatch_value_events(select, target_options[0]?.value ?? null)
        await wait_frames(1)
    }

    const final_selected = summarize_selected_options(select)
    const final_values = final_selected.map((opt) => opt.value)
    const actual_changed =
        final_values.length !== previous_values.length || final_values.some((val, idx) => val !== previous_values[idx])

    return {
        ok: true,
        data: {
            mode: "select",
            control_kind,
            dry_run: false,
            changed: actual_changed,
            point,
            previous_values,
            values: final_values,
            selected_options: final_selected,
            target: target_summary
        }
    }
}

async function apply_toggle_input(
    input: HTMLInputElement,
    control_kind: "checkbox" | "switch" | "radio",
    options: SelectOptions,
    point: { x: number; y: number },
    target_summary: TargetElementSummary,
    dry_run: boolean
): Promise<{ ok: true; data: SelectResult } | { ok: false; error: ActionError }> {
    const previous_checked = input.checked
    let desired_checked: boolean

    if (options.clear) {
        if (control_kind === "radio") {
            return invalid_options(
                "Radio buttons cannot be unchecked directly; select another radio button in the same group."
            )
        }
        desired_checked = false
    } else {
        const queries = options.values ?? []
        if (queries.length !== 1) {
            return invalid_options(
                control_kind === "radio"
                    ? 'Specify "true" (or "checked") to select a radio button.'
                    : 'Specify one state ("true"/"on"/"checked", "false"/"off"/"unchecked", or "toggle") or pass --clear.'
            )
        }
        const token = queries[0].trim().toLowerCase()
        if (TRUE_TOKENS.has(token)) {
            desired_checked = true
        } else if (FALSE_TOKENS.has(token)) {
            if (control_kind === "radio") {
                return invalid_options(
                    "Radio buttons cannot be unchecked directly; select another radio button in the same group."
                )
            }
            desired_checked = false
        } else if (token === "toggle") {
            if (control_kind === "radio") {
                return invalid_options('Radio buttons do not support "toggle"; pass "true" to select.')
            }
            desired_checked = !previous_checked
        } else {
            return invalid_options(
                `Invalid ${control_kind} value ${JSON.stringify(queries[0])}. Expected true/false, on/off, checked/unchecked, or toggle.`
            )
        }
    }

    const will_change = desired_checked !== previous_checked
    if (dry_run) {
        const overlay = mount_debug_overlay(1200)
        append_overlay_box(overlay, target_summary.rect, "#8b5cf6")
        append_overlay_dot(overlay, point, "#8b5cf6")
        return {
            ok: true,
            data: {
                mode: "select",
                control_kind,
                dry_run: true,
                changed: will_change,
                point,
                previous_values: [String(previous_checked)],
                values: [String(desired_checked)],
                target: target_summary
            }
        }
    }

    if (will_change) {
        input.click()
        await wait_frames(1)
    }

    const final_checked = input.checked
    return {
        ok: true,
        data: {
            mode: "select",
            control_kind,
            dry_run: false,
            changed: final_checked !== previous_checked,
            point,
            previous_values: [String(previous_checked)],
            values: [String(final_checked)],
            target: target_summary
        }
    }
}

function validate_and_normalize_value_input(
    input: HTMLInputElement,
    control_kind: "range" | "color" | "date" | "datetime-local" | "time" | "month" | "week",
    options: SelectOptions
): { ok: true; next_value: string } | { ok: false; error: ActionError } {
    if (options.clear) {
        if (control_kind === "range" || control_kind === "color") {
            return invalid_options(`Cannot --clear <input type="${control_kind}">; specify an explicit value.`)
        }
        return { ok: true, next_value: "" }
    }

    const queries = options.values ?? []
    if (queries.length !== 1) {
        return invalid_options(`select on <input type="${control_kind}"> requires exactly one value.`)
    }
    const raw = queries[0]

    if (control_kind === "color") {
        if (!/^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
            return invalid_options(`Invalid color value ${JSON.stringify(raw)}; expected 6-digit hex "#rrggbb".`)
        }
        return { ok: true, next_value: raw.trim().toLowerCase() }
    }

    if (control_kind === "range") {
        const trimmed = raw.trim()
        const numeric = Number(trimmed)
        if (trimmed.length === 0 || !Number.isFinite(numeric)) {
            return invalid_options(`Invalid range value ${JSON.stringify(raw)}; expected a finite number.`)
        }
        const min = input.min !== "" && Number.isFinite(Number(input.min)) ? Number(input.min) : 0
        const max = input.max !== "" && Number.isFinite(Number(input.max)) ? Number(input.max) : 100
        if (numeric < min || numeric > max) {
            return invalid_options(`Range value ${numeric} is out of bounds [${min}, ${max}].`)
        }
        const probe = document.createElement("input")
        probe.type = "range"
        if (input.min !== "") probe.min = input.min
        if (input.max !== "") probe.max = input.max
        if (input.step !== "") probe.step = input.step
        probe.value = trimmed
        return { ok: true, next_value: probe.value }
    }

    if (raw === "") {
        return { ok: true, next_value: "" }
    }

    // Use a detached input element so browser sanitization validates date/time strings without touching live DOM.
    const probe = document.createElement("input")
    probe.type = control_kind
    probe.value = raw
    if (probe.value === "") {
        const hint = TEMPORAL_FORMAT_HINTS[control_kind] ?? control_kind
        return invalid_options(`Invalid ${control_kind} value ${JSON.stringify(raw)}. Expected format: ${hint}.`)
    }
    return { ok: true, next_value: probe.value }
}

async function apply_value_input(
    input: HTMLInputElement,
    control_kind: "range" | "color" | "date" | "datetime-local" | "time" | "month" | "week",
    options: SelectOptions,
    point: { x: number; y: number },
    target_summary: TargetElementSummary,
    dry_run: boolean
): Promise<{ ok: true; data: SelectResult } | { ok: false; error: ActionError }> {
    const validated = validate_and_normalize_value_input(input, control_kind, options)
    if (!validated.ok) return validated

    const previous_value = input.value
    const next_value = validated.next_value
    const will_change = next_value !== previous_value

    if (dry_run) {
        const overlay = mount_debug_overlay(1200)
        append_overlay_box(overlay, target_summary.rect, "#8b5cf6")
        append_overlay_dot(overlay, point, "#8b5cf6")
        return {
            ok: true,
            data: {
                mode: "select",
                control_kind,
                dry_run: true,
                changed: will_change,
                point,
                previous_values: previous_value ? [previous_value] : [],
                values: next_value ? [next_value] : [],
                target: target_summary
            }
        }
    }

    if (document.activeElement !== input) {
        input.focus()
    }

    if (will_change) {
        set_native_input_value(input, next_value)
        dispatch_value_events(input, next_value || null)
        await wait_frames(1)
    }

    const final_value = input.value
    return {
        ok: true,
        data: {
            mode: "select",
            control_kind,
            dry_run: false,
            changed: final_value !== previous_value,
            point,
            previous_values: previous_value ? [previous_value] : [],
            values: final_value ? [final_value] : [],
            target: target_summary
        }
    }
}

/**
 * Operate native form controls (`<select>`, `<input type="checkbox|switch|radio|range|color|date|datetime-local|time|month|week">`)
 * via native prototype setters or toggle clicks and proper Input/Change events.
 */
export async function perform_select(
    raw_target: TargetInput | string,
    options: SelectOptions
): Promise<{ ok: true; data: SelectResult } | { ok: false; error: ActionError }> {
    const match_by: SelectOptionMatchBy = options?.match_by ?? "auto"
    if (!NATIVE_OPTION_MATCH_MODES.has(match_by)) {
        return invalid_options(
            `Invalid match_by "${String(options?.match_by)}" (expected auto, value, label, or index).`
        )
    }

    const scroll_into_view = options?.scroll_into_view !== false
    const dry_run = options?.dry_run === true

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
        return invalid_options("Target did not resolve to a native HTML form control.")
    }

    const unwrapped =
        candidate instanceof HTMLLabelElement && candidate.control instanceof HTMLElement
            ? candidate.control
            : candidate
    if ((target_info.kind === "point" || unwrapped !== target_el) && is_element_disabled(unwrapped)) {
        return {
            ok: false,
            error: {
                code: "DISABLED",
                message: `Target ${describe_element_brief(unwrapped)} is disabled.`
            }
        }
    }

    const classified = classify_native_control(unwrapped)
    if (!classified.ok) {
        return classified
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

    const { control } = classified
    if (control.family === "select") {
        if (options.index !== undefined && options.values && options.values.length > 0) {
            return invalid_options("Cannot mix --index and value arguments.")
        }
        return apply_select_element(control.element, control.kind, options, match_by, point, target_summary, dry_run)
    }

    if (options?.index !== undefined || options?.match_by === "label" || options?.match_by === "index") {
        return invalid_options(
            `--index and --label / match_by="${options?.match_by ?? "index"}" are only supported for <select> elements, not ${control.kind}.`
        )
    }

    if (control.family === "toggle") {
        return apply_toggle_input(control.element, control.kind, options, point, target_summary, dry_run)
    }

    return apply_value_input(control.element, control.kind, options, point, target_summary, dry_run)
}
