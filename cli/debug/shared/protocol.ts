export type AnchorUnit = "px" | "%"

export interface TargetPoint {
    x: number
    y: number
    x_unit: AnchorUnit
    y_unit: AnchorUnit
}

export interface TargetAnchor {
    kind: "ratio" | "offset" | "center_delta"
    x: number
    y: number
}

export type TargetStep =
    | {
          kind: "text"
          value: string
          exact?: boolean
          nth?: number
      }
    | {
          kind: "role"
          role: string
          name?: string
          exact?: boolean
          nth?: number
      }
    | {
          kind: "css"
          selector: string
          nth?: number
      }

export interface TargetInput {
    steps?: TargetStep[]
    point?: TargetPoint
    anchor?: TargetAnchor
    nth?: number
}

export interface RectBox {
    x: number
    y: number
    w: number
    h: number
}

export interface Point2D {
    x: number
    y: number
}

export interface LogEntry {
    level: "warn" | "error"
    message: string
    timestamp: number
}

export interface CandidateSummary {
    index: number
    role: string
    name: string
    locator: string
    scope: string
    states: string[]
    rect: RectBox
    center: Point2D
    in_viewport: boolean
}

export type ActionErrorCode = "NOT_FOUND" | "AMBIGUOUS" | "OBSCURED" | "DISABLED" | "INVALID_TARGET" | "UNSUPPORTED"

export interface ActionError {
    code: ActionErrorCode
    message: string
    candidates?: CandidateSummary[]
    obscured_by?: string
}

export interface ActionMeta {
    url: string
    title: string
    viewport: { width: number; height: number }
    scroll: Point2D
    logs: LogEntry[]
    duration_ms: number
}

export interface ActionResult<T> {
    ok: boolean
    data?: T
    error?: ActionError
    meta: ActionMeta
}

export interface SnapNode {
    kind: "landmark" | "heading" | "interactive" | "container" | "text"
    role: string
    name: string
    locator: string
    states: string[]
    rect: RectBox
    center: Point2D
    children?: SnapNode[]
}

export interface SnapOptions {
    scope?: TargetInput | string
    all?: boolean
    include_text?: boolean
    max_depth?: number
}

export interface SnapResult {
    nodes: SnapNode[]
    total_interactive: number
    has_inert_overlay: boolean
}

export interface FindOptions {
    all?: boolean
    include_hidden?: boolean
}

export interface FindResult {
    matches: CandidateSummary[]
}

export interface InspectResult {
    tag: string
    role: string
    name: string
    locator: string
    css_selector: string
    states: string[]
    rect: RectBox
    center: Point2D
    in_viewport: boolean
    hit_test: {
        ok: boolean
        hit_element: string
        obscured_by?: string
    }
    styles: {
        display: string
        visibility: string
        opacity: string
        pointer_events: string
        cursor: string
        touch_action: string
        overflow_x: string
        overflow_y: string
    }
    listeners: string[]
    attributes: Record<string, string>
}

export interface TapOptions {
    pointer?: "mouse" | "touch"
    button?: "left" | "right"
    scroll_into_view?: boolean
    dry_run?: boolean
}

export interface TapResult {
    mode: "tap" | "click"
    pointer: "mouse" | "touch"
    button: "left" | "right"
    dry_run: boolean
    point: Point2D
    target: {
        role: string
        name: string
        locator: string
        hit_element: string
        rect: RectBox
    }
}

export type DebugUiCommand =
    | { action: "snap"; options?: SnapOptions }
    | { action: "find"; target: TargetInput | string; options?: FindOptions }
    | { action: "inspect"; target: TargetInput | string }
    | { action: "tap"; target: TargetInput | string; options?: TapOptions }
    | { action: "click"; target: TargetInput | string; options?: TapOptions }

export interface DebugUiRuntime {
    snap: (options?: SnapOptions) => Promise<ActionResult<SnapResult>>
    find: (target: TargetInput | string, options?: FindOptions) => Promise<ActionResult<FindResult>>
    inspect: (target: TargetInput | string) => Promise<ActionResult<InspectResult>>
    tap: (target: TargetInput | string, options?: TapOptions) => Promise<ActionResult<TapResult>>
    click: (target: TargetInput | string, options?: TapOptions) => Promise<ActionResult<TapResult>>
    exec: (command: DebugUiCommand) => Promise<ActionResult<unknown>>
}

export const KNOWN_ROLES = new Set([
    "button",
    "link",
    "input",
    "textbox",
    "searchbox",
    "select",
    "combobox",
    "checkbox",
    "radio",
    "switch",
    "slider",
    "tab",
    "tabpanel",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "listbox",
    "menu",
    "dialog",
    "alertdialog",
    "nav",
    "navigation",
    "header",
    "banner",
    "main",
    "footer",
    "contentinfo",
    "form",
    "region",
    "heading",
    "img",
    "clickable",
    "swipeable",
    "scrollable"
])

const VIEWPORT_POINT_RE = /^\s*(-?\d+(?:\.\d+)?)(%)?\s*,\s*(-?\d+(?:\.\d+)?)(%)?\s*$/
const TRAILING_ANCHOR_RE = /^(.*?)\s*@\s*([+-]?\d+(?:\.\d+)?)(%)?\s*,\s*([+-]?\d+(?:\.\d+)?)(%)?\s*$/
const TRAILING_OFFSET_RE = /^(.*?)\s*([+-]\d+(?:\.\d+)?)\s*,\s*([+-]\d+(?:\.\d+)?)\s*$/
const ROLE_NTH_RE = /^([a-z][a-z0-9_-]*)#([1-9]\d*)$/i

function strip_outer_quotes(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed.length >= 2) {
        const first = trimmed[0]
        const last = trimmed[trimmed.length - 1]
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1)
        }
    }
    return trimmed
}

function split_scoped_steps(raw: string): string[] {
    const parts: string[] = []
    let current = ""
    let quote_char: string | null = null
    let bracket_depth = 0
    let paren_depth = 0

    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i]
        if (quote_char) {
            if (ch === "\\" && i + 1 < raw.length) {
                current += ch + raw[i + 1]
                i += 1
                continue
            }
            if (ch === quote_char) {
                quote_char = null
            }
            current += ch
            continue
        }

        if (ch === '"' || ch === "'") {
            quote_char = ch
            current += ch
            continue
        }
        if (ch === "[") bracket_depth += 1
        else if (ch === "]" && bracket_depth > 0) bracket_depth -= 1
        else if (ch === "(") paren_depth += 1
        else if (ch === ")" && paren_depth > 0) paren_depth -= 1

        if (bracket_depth === 0 && paren_depth === 0 && ch === ">" && raw[i + 1] === ">") {
            parts.push(current.trim())
            current = ""
            i += 1
            continue
        }

        current += ch
    }

    if (current.trim().length > 0) {
        parts.push(current.trim())
    }
    return parts
}

function extract_trailing_anchor(raw: string): { body: string; anchor?: TargetAnchor } {
    const at_match = raw.match(TRAILING_ANCHOR_RE)
    if (at_match && at_match[1].trim().length > 0) {
        const x_val = Number(at_match[2])
        const x_pct = at_match[3] === "%"
        const y_val = Number(at_match[4])
        const y_pct = at_match[5] === "%"
        if (x_pct && y_pct) {
            return {
                body: at_match[1].trim(),
                anchor: { kind: "ratio", x: x_val / 100, y: y_val / 100 }
            }
        }
        return {
            body: at_match[1].trim(),
            anchor: { kind: "offset", x: x_val, y: y_val }
        }
    }

    const offset_match = raw.match(TRAILING_OFFSET_RE)
    if (offset_match && offset_match[1].trim().length > 0) {
        return {
            body: offset_match[1].trim(),
            anchor: {
                kind: "center_delta",
                x: Number(offset_match[2]),
                y: Number(offset_match[3])
            }
        }
    }

    return { body: raw.trim() }
}

function parse_step_token(raw_step: string): TargetStep {
    const trimmed = raw_step.trim()

    if (trimmed.startsWith("css:")) {
        return { kind: "css", selector: trimmed.slice(4).trim() }
    }

    if (trimmed.startsWith(".") || trimmed.startsWith("#") || trimmed.startsWith("[")) {
        return { kind: "css", selector: trimmed }
    }

    const role_nth = trimmed.match(ROLE_NTH_RE)
    if (role_nth && KNOWN_ROLES.has(role_nth[1].toLowerCase())) {
        return {
            kind: "role",
            role: role_nth[1].toLowerCase(),
            nth: Number(role_nth[2])
        }
    }

    const colon_idx = trimmed.indexOf(":")
    if (colon_idx > 0) {
        const maybe_role = trimmed.slice(0, colon_idx).trim().toLowerCase()
        if (KNOWN_ROLES.has(maybe_role)) {
            let rest = trimmed.slice(colon_idx + 1).trim()
            let nth: number | undefined
            const quoted_nth_match = rest.match(/^(["'])(.*)\1#([1-9]\d*)$/)
            if (quoted_nth_match) {
                rest = quoted_nth_match[2]
                nth = Number(quoted_nth_match[3])
            } else {
                rest = strip_outer_quotes(rest)
            }

            let exact = false
            if (rest.startsWith("=")) {
                exact = true
                rest = strip_outer_quotes(rest.slice(1))
            }

            return {
                kind: "role",
                role: maybe_role,
                name: rest.length > 0 ? rest : undefined,
                exact,
                nth
            }
        }
    }

    if (KNOWN_ROLES.has(trimmed.toLowerCase())) {
        return { kind: "role", role: trimmed.toLowerCase() }
    }

    if (trimmed.startsWith("text:")) {
        const text_body = trimmed.slice(5).trim()
        if (text_body.startsWith("=")) {
            return { kind: "text", value: strip_outer_quotes(text_body.slice(1)), exact: true }
        }
        return { kind: "text", value: strip_outer_quotes(text_body), exact: false }
    }

    if (trimmed.startsWith("=")) {
        return { kind: "text", value: strip_outer_quotes(trimmed.slice(1)), exact: true }
    }

    const quoted_nth = trimmed.match(/^(["'])(.*)\1#([1-9]\d*)$/)
    if (quoted_nth) {
        return { kind: "text", value: quoted_nth[2], nth: Number(quoted_nth[3]) }
    }

    return { kind: "text", value: strip_outer_quotes(trimmed), exact: false }
}

export function parse_target_string(raw: string): TargetInput {
    const trimmed = raw.trim()
    const point_match = trimmed.match(VIEWPORT_POINT_RE)
    if (point_match) {
        return {
            point: {
                x: Number(point_match[1]),
                x_unit: point_match[2] === "%" ? "%" : "px",
                y: Number(point_match[3]),
                y_unit: point_match[4] === "%" ? "%" : "px"
            }
        }
    }

    const { body, anchor } = extract_trailing_anchor(trimmed)
    const raw_steps = split_scoped_steps(body)
    const steps = raw_steps.map(parse_step_token)

    return {
        steps,
        ...(anchor ? { anchor } : {})
    }
}

export function normalize_target_input(target: TargetInput | string): TargetInput {
    return typeof target === "string" ? parse_target_string(target) : target
}

export interface TargetModifiers {
    scope?: string
    role?: string
    exact?: boolean
    nth?: number
    css?: string
    anchor?: string
}

export function apply_target_modifiers(base: TargetInput, modifiers: TargetModifiers): TargetInput {
    const result: TargetInput = {
        ...base,
        steps: base.steps ? base.steps.map((s) => ({ ...s })) : undefined
    }

    if (modifiers.css) {
        result.steps = [{ kind: "css", selector: modifiers.css }]
        delete result.point
    }

    if (modifiers.role && result.steps && result.steps.length > 0) {
        const last_idx = result.steps.length - 1
        const last = result.steps[last_idx]
        if (last.kind === "text") {
            result.steps[last_idx] = {
                kind: "role",
                role: modifiers.role.toLowerCase(),
                name: last.value,
                exact: last.exact,
                nth: last.nth
            }
        } else if (last.kind === "role") {
            result.steps[last_idx] = { ...last, role: modifiers.role.toLowerCase() }
        }
    }

    if (modifiers.exact && result.steps && result.steps.length > 0) {
        const last_idx = result.steps.length - 1
        const last = result.steps[last_idx]
        if (last.kind === "text" || last.kind === "role") {
            result.steps[last_idx] = { ...last, exact: true }
        }
    }

    if (modifiers.scope) {
        const scope_input = parse_target_string(modifiers.scope)
        const scope_steps = scope_input.steps ?? []
        result.steps = [...scope_steps, ...(result.steps ?? [])]
    }

    if (modifiers.nth !== undefined) {
        result.nth = modifiers.nth
    }

    if (modifiers.anchor) {
        const raw_anchor = modifiers.anchor.trim().replace(/^@/, "")
        const delta_match = raw_anchor.match(/^([+-]\d+(?:\.\d+)?)\s*,\s*([+-]\d+(?:\.\d+)?)$/)
        if (delta_match) {
            result.anchor = {
                kind: "center_delta",
                x: Number(delta_match[1]),
                y: Number(delta_match[2])
            }
        } else {
            const parsed_anchor = extract_trailing_anchor(`dummy@${raw_anchor}`)
            if (parsed_anchor.anchor) {
                result.anchor = parsed_anchor.anchor
            }
        }
    }

    return result
}
