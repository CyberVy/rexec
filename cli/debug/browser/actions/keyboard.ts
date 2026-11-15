import type {
    ActionError,
    KeyModifiers,
    PressOptions,
    PressResult,
    TargetElementSummary,
    TargetInput
} from "../../shared/protocol"
import { describe_element_brief, is_element_disabled, rect_center, to_rect_box } from "../dom/dom_utils"
import {
    append_overlay_box,
    append_overlay_dot,
    invalid_options,
    MAX_TOTAL_GESTURE_MS,
    mount_debug_overlay,
    resolve_and_prepare_target,
    summarize_dom_element,
    wait_frames,
    wait_ms
} from "../gestures/pointer_common"

interface KeyDefinition {
    key: string
    code: string
    key_code: number
    keypress: boolean
}

export interface ResolvedKeySpec extends KeyDefinition {
    modifiers: KeyModifiers
}

const NAMED_KEYS: Record<string, KeyDefinition> = {
    enter: { key: "Enter", code: "Enter", key_code: 13, keypress: true },
    return: { key: "Enter", code: "Enter", key_code: 13, keypress: true },
    escape: { key: "Escape", code: "Escape", key_code: 27, keypress: false },
    esc: { key: "Escape", code: "Escape", key_code: 27, keypress: false },
    space: { key: " ", code: "Space", key_code: 32, keypress: true },
    spacebar: { key: " ", code: "Space", key_code: 32, keypress: true },
    " ": { key: " ", code: "Space", key_code: 32, keypress: true },
    tab: { key: "Tab", code: "Tab", key_code: 9, keypress: false },
    backspace: { key: "Backspace", code: "Backspace", key_code: 8, keypress: false },
    delete: { key: "Delete", code: "Delete", key_code: 46, keypress: false },
    del: { key: "Delete", code: "Delete", key_code: 46, keypress: false },
    insert: { key: "Insert", code: "Insert", key_code: 45, keypress: false },
    ins: { key: "Insert", code: "Insert", key_code: 45, keypress: false },
    home: { key: "Home", code: "Home", key_code: 36, keypress: false },
    end: { key: "End", code: "End", key_code: 35, keypress: false },
    pageup: { key: "PageUp", code: "PageUp", key_code: 33, keypress: false },
    pagedown: { key: "PageDown", code: "PageDown", key_code: 34, keypress: false },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", key_code: 37, keypress: false },
    left: { key: "ArrowLeft", code: "ArrowLeft", key_code: 37, keypress: false },
    arrowup: { key: "ArrowUp", code: "ArrowUp", key_code: 38, keypress: false },
    up: { key: "ArrowUp", code: "ArrowUp", key_code: 38, keypress: false },
    arrowright: { key: "ArrowRight", code: "ArrowRight", key_code: 39, keypress: false },
    right: { key: "ArrowRight", code: "ArrowRight", key_code: 39, keypress: false },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", key_code: 40, keypress: false },
    down: { key: "ArrowDown", code: "ArrowDown", key_code: 40, keypress: false },
    capslock: { key: "CapsLock", code: "CapsLock", key_code: 20, keypress: false },
    numlock: { key: "NumLock", code: "NumLock", key_code: 144, keypress: false },
    scrolllock: { key: "ScrollLock", code: "ScrollLock", key_code: 145, keypress: false },
    pause: { key: "Pause", code: "Pause", key_code: 19, keypress: false },
    printscreen: { key: "PrintScreen", code: "PrintScreen", key_code: 44, keypress: false },
    contextmenu: { key: "ContextMenu", code: "ContextMenu", key_code: 93, keypress: false },
    mediaplaypause: { key: "MediaPlayPause", code: "MediaPlayPause", key_code: 179, keypress: false },
    mediastop: { key: "MediaStop", code: "MediaStop", key_code: 178, keypress: false },
    mediatracknext: { key: "MediaTrackNext", code: "MediaTrackNext", key_code: 176, keypress: false },
    mediatrackprevious: { key: "MediaTrackPrevious", code: "MediaTrackPrevious", key_code: 177, keypress: false }
}

for (let fn_index = 1; fn_index <= 12; fn_index += 1) {
    const key_name = `F${fn_index}`
    NAMED_KEYS[key_name.toLowerCase()] = {
        key: key_name,
        code: key_name,
        key_code: 111 + fn_index,
        keypress: false
    }
}

const PUNCTUATION_KEYS: Record<string, { code: string; key_code: number }> = {
    "-": { code: "Minus", key_code: 189 },
    "=": { code: "Equal", key_code: 187 },
    "[": { code: "BracketLeft", key_code: 219 },
    "]": { code: "BracketRight", key_code: 221 },
    "\\": { code: "Backslash", key_code: 220 },
    ";": { code: "Semicolon", key_code: 186 },
    "'": { code: "Quote", key_code: 222 },
    ",": { code: "Comma", key_code: 188 },
    ".": { code: "Period", key_code: 190 },
    "/": { code: "Slash", key_code: 191 },
    "`": { code: "Backquote", key_code: 192 }
}

function is_apple_platform(): boolean {
    if (typeof navigator === "undefined") return false
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

function resolve_base_key(raw_base: string): KeyDefinition | null {
    const named = NAMED_KEYS[raw_base.toLowerCase()]
    if (named) {
        return named
    }

    if (raw_base.length === 1) {
        if (/^[a-zA-Z]$/.test(raw_base)) {
            const upper = raw_base.toUpperCase()
            return {
                key: raw_base,
                code: `Key${upper}`,
                key_code: upper.charCodeAt(0),
                keypress: true
            }
        }
        if (/^[0-9]$/.test(raw_base)) {
            return {
                key: raw_base,
                code: `Digit${raw_base}`,
                key_code: raw_base.charCodeAt(0),
                keypress: true
            }
        }
        const punctuation = PUNCTUATION_KEYS[raw_base]
        if (punctuation) {
            return {
                key: raw_base,
                code: punctuation.code,
                key_code: punctuation.key_code,
                keypress: true
            }
        }
        return {
            key: raw_base,
            code: "",
            key_code: raw_base.toUpperCase().charCodeAt(0),
            keypress: true
        }
    }

    return null
}

/**
 * Parse a key or chord expression (e.g. `"Escape"`, `"Space"`, `"ArrowRight"`, `"ControlOrMeta+k"`).
 */
export function resolve_key_spec(
    raw_key: string
): { ok: true; spec: ResolvedKeySpec } | { ok: false; error: ActionError } {
    if (typeof raw_key !== "string" || raw_key.length === 0 || (raw_key.length > 1 && raw_key.trim().length === 0)) {
        return invalid_options("press requires a non-empty key name.")
    }

    const modifiers: KeyModifiers = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false
    }

    let base_token = raw_key
    if (raw_key.includes("+") && raw_key.length > 1) {
        if (raw_key.endsWith("++")) {
            const prefix = raw_key.slice(0, -2)
            const mod_error = apply_modifier_tokens(prefix.split("+"), modifiers)
            if (mod_error) return mod_error
            base_token = "+"
        } else {
            const parts = raw_key.split("+")
            const last = parts.pop() ?? ""
            if (last.length === 0) {
                return invalid_options(`Invalid key combination "${raw_key}": missing key after "+".`)
            }
            const mod_error = apply_modifier_tokens(parts, modifiers)
            if (mod_error) return mod_error
            base_token = last
        }
    }

    const base = resolve_base_key(base_token)
    if (!base) {
        return invalid_options(
            `Unknown key "${raw_key}". Use standard Web key names (e.g. Enter, Escape, Space, ArrowLeft, f, Control+k).`
        )
    }

    return {
        ok: true,
        spec: {
            ...base,
            modifiers
        }
    }
}

function apply_modifier_tokens(tokens: string[], modifiers: KeyModifiers): { ok: false; error: ActionError } | null {
    for (const token of tokens) {
        switch (token.toLowerCase()) {
            case "ctrl":
            case "control":
                modifiers.ctrl = true
                break
            case "alt":
            case "option":
                modifiers.alt = true
                break
            case "shift":
                modifiers.shift = true
                break
            case "meta":
            case "cmd":
            case "command":
            case "super":
                modifiers.meta = true
                break
            case "controlormeta":
            case "cmdorctrl":
            case "mod":
                if (is_apple_platform()) {
                    modifiers.meta = true
                } else {
                    modifiers.ctrl = true
                }
                break
            default:
                return invalid_options(
                    `Unknown key modifier "${token}". Expected Control/Ctrl, Alt/Option, Shift, Meta/Cmd, or ControlOrMeta.`
                )
        }
    }
    return null
}

function build_keyboard_event_init(spec: ResolvedKeySpec): KeyboardEventInit {
    const has_printable_char = spec.keypress && !spec.modifiers.ctrl && !spec.modifiers.alt && !spec.modifiers.meta
    const char_code = has_printable_char ? (spec.key === "Enter" ? 13 : spec.key.charCodeAt(0)) : 0
    return {
        key: spec.key,
        code: spec.code,
        keyCode: spec.key_code,
        which: spec.key_code,
        charCode: char_code,
        ctrlKey: spec.modifiers.ctrl,
        altKey: spec.modifiers.alt,
        shiftKey: spec.modifiers.shift,
        metaKey: spec.modifiers.meta,
        bubbles: true,
        cancelable: true,
        composed: true
    }
}

function should_dispatch_keypress(spec: ResolvedKeySpec): boolean {
    return spec.keypress && !spec.modifiers.ctrl && !spec.modifiers.alt && !spec.modifiers.meta
}

function dispatch_key_down_and_press(element: Element, spec: ResolvedKeySpec): boolean {
    const init = build_keyboard_event_init(spec)
    const keydown_not_canceled = element.dispatchEvent(new KeyboardEvent("keydown", init))
    if (keydown_not_canceled && should_dispatch_keypress(spec) && element.isConnected) {
        element.dispatchEvent(new KeyboardEvent("keypress", init))
    }
    return keydown_not_canceled
}

function dispatch_key_up(element: Element, spec: ResolvedKeySpec): boolean {
    const keyup_target = element.isConnected
        ? element
        : document.activeElement || document.body || document.documentElement
    return keyup_target.dispatchEvent(new KeyboardEvent("keyup", build_keyboard_event_init(spec)))
}

/**
 * Synchronously dispatch `keydown`, optional `keypress`, and `keyup` for a resolved key on an element.
 */
export function dispatch_key_events_sync(element: Element, spec: ResolvedKeySpec): boolean {
    const keydown_not_canceled = dispatch_key_down_and_press(element, spec)
    const keyup_not_canceled = dispatch_key_up(element, spec)
    return !keydown_not_canceled || !keyup_not_canceled
}

/**
 * Dispatch a keyboard press (`keydown`, optional `keypress`, `keyup`) either on a resolved target element
 * (after focusing it) or on the currently active/document target so global window listeners receive it.
 */
export async function perform_press(
    raw_target: TargetInput | string | undefined,
    options: PressOptions
): Promise<{ ok: true; data: PressResult } | { ok: false; error: ActionError }> {
    const key_res = resolve_key_spec(options?.key)
    if (!key_res.ok) {
        return key_res
    }

    const raw_duration = options?.duration_ms ?? 0
    if (!Number.isFinite(raw_duration) || raw_duration < 0) {
        return invalid_options(`duration_ms must be a non-negative number, got: ${String(options?.duration_ms)}.`)
    }
    const duration_ms = Math.round(raw_duration)
    if (duration_ms > MAX_TOTAL_GESTURE_MS) {
        return invalid_options(
            `Key press hold duration (${duration_ms}ms) exceeds bridge safety limit (${MAX_TOTAL_GESTURE_MS}ms).`
        )
    }

    const scroll_into_view = options?.scroll_into_view !== false
    const dry_run = options?.dry_run === true

    let dispatch_el: Element
    let target_summary: TargetElementSummary

    if (raw_target !== undefined) {
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
        const candidate = target_el ?? hit_target ?? document.body ?? document.documentElement

        if (target_info.kind === "point" && is_element_disabled(candidate)) {
            return {
                ok: false,
                error: {
                    code: "DISABLED",
                    message: `Target ${describe_element_brief(candidate)} is disabled.`
                }
            }
        }

        dispatch_el = candidate
        target_summary =
            target_info.kind === "element" && target_el
                ? {
                      role: target_info.role,
                      name: target_info.name,
                      locator: target_info.locator,
                      hit_element: describe_element_brief(hit_target || candidate),
                      rect
                  }
                : summarize_dom_element(candidate, hit_target || candidate)
    } else {
        dispatch_el =
            (document.activeElement instanceof Element ? document.activeElement : null) ??
            document.body ??
            document.documentElement
        target_summary = summarize_dom_element(dispatch_el)
        if (target_summary.rect.w === 0 && target_summary.rect.h === 0) {
            const box = to_rect_box(dispatch_el.getBoundingClientRect())
            target_summary.rect =
                box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
        }
    }

    const spec = key_res.spec
    if (dry_run) {
        const overlay = mount_debug_overlay(1200)
        append_overlay_box(overlay, target_summary.rect, "#3b82f6")
        append_overlay_dot(overlay, rect_center(target_summary.rect), "#3b82f6")
        return {
            ok: true,
            data: {
                mode: "press",
                dry_run: true,
                key: spec.key,
                code: spec.code,
                modifiers: spec.modifiers,
                duration_ms,
                default_prevented: false,
                target: target_summary
            }
        }
    }

    if (raw_target !== undefined && dispatch_el instanceof HTMLElement && document.activeElement !== dispatch_el) {
        dispatch_el.focus()
    }

    const keydown_not_canceled = dispatch_key_down_and_press(dispatch_el, spec)
    if (duration_ms > 0) {
        await wait_ms(duration_ms)
    }
    const keyup_not_canceled = dispatch_key_up(dispatch_el, spec)
    await wait_frames(1)

    return {
        ok: true,
        data: {
            mode: "press",
            dry_run: false,
            key: spec.key,
            code: spec.code,
            modifiers: spec.modifiers,
            duration_ms,
            default_prevented: !keydown_not_canceled || !keyup_not_canceled,
            target: target_summary
        }
    }
}
