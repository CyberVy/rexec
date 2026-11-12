import type { Point2D, RectBox } from "../../shared/protocol"
import { get_direct_listeners } from "../listener_registry"

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"])

const SVG_SHAPE_TAGS = new Set([
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "g",
    "defs",
    "use",
    "mask",
    "clippath",
    "lineargradient",
    "radialgradient",
    "stop",
    "title"
])

export const LANDMARK_ROLES = new Set([
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
    "menu",
    "listbox",
    "region"
])

export const INTERACTIVE_ROLES = new Set([
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
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "clickable",
    "swipeable"
])

const ROLE_MATCH_GROUPS: Record<string, Set<string>> = {
    nav: new Set(["nav", "navigation"]),
    navigation: new Set(["nav", "navigation"]),
    header: new Set(["header", "banner"]),
    banner: new Set(["header", "banner"]),
    footer: new Set(["footer", "contentinfo"]),
    contentinfo: new Set(["footer", "contentinfo"]),
    dialog: new Set(["dialog", "alertdialog"]),
    input: new Set(["input", "textbox", "searchbox", "select", "combobox"]),
    textbox: new Set(["textbox", "searchbox", "input"]),
    clickable: new Set(["clickable", "button", "link"])
}

export function normalize_whitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim()
}

export function truncate_text(text: string, max_len = 64): string {
    if (text.length <= max_len) return text
    return `${text.slice(0, Math.max(1, max_len - 3)).trimEnd()}...`
}

export function to_rect_box(rect: DOMRect): RectBox {
    return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
    }
}

export function rect_center(rect: RectBox): Point2D {
    return {
        x: Math.round(rect.x + rect.w / 2),
        y: Math.round(rect.y + rect.h / 2)
    }
}

export function is_rect_in_viewport(rect: RectBox): boolean {
    return (
        rect.w > 0 &&
        rect.h > 0 &&
        rect.y + rect.h > 0 &&
        rect.x + rect.w > 0 &&
        rect.y < window.innerHeight &&
        rect.x < window.innerWidth
    )
}

export function is_element_disabled(el: Element): boolean {
    if ((el as HTMLButtonElement).disabled === true) return true
    if (el.getAttribute("aria-disabled") === "true") return true
    if (el.closest("[inert]")) return true
    const style = getComputedStyle(el)
    if (style.pointerEvents === "none") return true
    return false
}

export function is_element_displayed(el: Element, style?: CSSStyleDeclaration): boolean {
    if (SKIP_TAGS.has(el.tagName)) return false
    if (el.closest("[hidden]") && !(el instanceof HTMLElement && el.style.display && el.style.display !== "none")) {
        // Explicit [hidden] unless inline style overrides
        if (el.hasAttribute("hidden") && getComputedStyle(el).display === "none") return false
    }
    const computed = style ?? getComputedStyle(el)
    if (computed.display === "none") return false
    if (computed.visibility === "hidden" || computed.visibility === "collapse") return false
    return true
}

export function get_explicit_role(el: Element): string {
    return el.getAttribute("role")?.trim().toLowerCase() ?? ""
}

export function get_implicit_role(el: Element): string {
    const tag = el.tagName.toLowerCase()
    if (tag === "button" || tag === "summary") return "button"
    if (tag === "a" && el.hasAttribute("href")) return "link"
    if (tag === "textarea") return "textbox"
    if (tag === "select") return "select"
    if (tag === "dialog") return "dialog"
    if (tag === "nav") return "nav"
    if (tag === "header") return "header"
    if (tag === "main") return "main"
    if (tag === "footer") return "footer"
    if (tag === "form") return "form"
    if (tag === "img") return "img"
    if (/^h[1-6]$/.test(tag)) return "heading"

    if (tag === "input") {
        const input_type = (el.getAttribute("type") || "text").toLowerCase()
        if (input_type === "hidden") return ""
        if (input_type === "button" || input_type === "submit" || input_type === "reset" || input_type === "image") {
            return "button"
        }
        if (input_type === "checkbox") {
            return el.hasAttribute("switch") ? "switch" : "checkbox"
        }
        if (input_type === "radio") return "radio"
        if (input_type === "range") return "slider"
        if (input_type === "search") return "searchbox"
        return "textbox"
    }

    return ""
}

export function get_semantic_role(el: Element): string {
    const explicit = get_explicit_role(el)
    if (explicit) return explicit
    return get_implicit_role(el)
}

export function role_matches(actual_role: string, expected_role: string): boolean {
    const actual = actual_role.toLowerCase()
    const expected = expected_role.toLowerCase()
    if (actual === expected) return true
    const group = ROLE_MATCH_GROUPS[expected]
    return group ? group.has(actual) : false
}

export function has_explicit_label_attribute(el: Element): boolean {
    return (
        el.hasAttribute("aria-label") ||
        el.hasAttribute("aria-labelledby") ||
        el.hasAttribute("title") ||
        el.hasAttribute("data-testid")
    )
}

const INLINE_DISPLAYS = new Set(["inline", "inline-block", "inline-flex", "inline-grid", "contents"])

function join_inline_parts(parts: string[]): string {
    let out = ""
    for (const part of parts) {
        if (!part) continue
        if (!out) {
            out = part
            continue
        }
        const no_space_before = /^[)\].,:;!?%]/.test(part)
        const no_space_after = /[([]$/.test(out)
        out += no_space_before || no_space_after ? part : ` ${part}`
    }
    return out
}

function collect_visible_text_segments(root: Element): string[] {
    const blocks: string[] = []
    let current_inline: string[] = []

    const flush_inline = () => {
        if (current_inline.length > 0) {
            const joined = normalize_whitespace(join_inline_parts(current_inline))
            if (joined) blocks.push(joined)
            current_inline = []
        }
    }

    const walk = (node: Node, inherited_opacity_zero: boolean) => {
        if (node.nodeType === Node.TEXT_NODE) {
            if (inherited_opacity_zero) return
            const text = normalize_whitespace(node.textContent || "")
            if (text) current_inline.push(text)
            return
        }

        if (!(node instanceof Element)) return
        if (SKIP_TAGS.has(node.tagName)) return
        if (node.getAttribute("aria-hidden") === "true") return
        if (node.tagName.toLowerCase() === "svg") {
            const svg_title = node.querySelector(":scope > title")?.textContent
            if (svg_title) {
                const cleaned = normalize_whitespace(svg_title)
                if (cleaned) current_inline.push(cleaned)
            }
            return
        }

        const style = getComputedStyle(node)
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
            return
        }
        const is_opacity_zero = inherited_opacity_zero || Number.parseFloat(style.opacity || "1") === 0
        const is_inline = INLINE_DISPLAYS.has(style.display)

        if (!is_inline) flush_inline()
        for (let i = 0; i < node.childNodes.length; i += 1) {
            walk(node.childNodes[i], is_opacity_zero)
        }
        if (!is_inline) flush_inline()
    }

    walk(root, false)
    flush_inline()
    return blocks
}

export function get_accessible_name_info(el: Element): {
    name: string
    primary: string
    full_text: string
    source: string
} {
    const aria_label = normalize_whitespace(el.getAttribute("aria-label") || "")
    if (aria_label) {
        return { name: aria_label, primary: aria_label, full_text: aria_label, source: "aria-label" }
    }

    const labelled_by = el.getAttribute("aria-labelledby")
    if (labelled_by) {
        const parts = labelled_by
            .split(/\s+/)
            .map((id) => {
                const target = document.getElementById(id)
                return target ? normalize_whitespace(target.textContent || "") : ""
            })
            .filter(Boolean)
        if (parts.length > 0) {
            const joined = parts.join(" ")
            return { name: joined, primary: parts[0], full_text: joined, source: "aria-labelledby" }
        }
    }

    const tag = el.tagName.toLowerCase()
    if (tag === "input" || tag === "textarea" || tag === "select") {
        const id = el.getAttribute("id")
        if (id) {
            const label_el = document.querySelector(`label[for="${CSS.escape(id)}"]`)
            if (label_el) {
                const label_text = normalize_whitespace(label_el.textContent || "")
                if (label_text) {
                    return { name: label_text, primary: label_text, full_text: label_text, source: "label" }
                }
            }
        }

        const wrapping_label = el.closest("label")
        if (wrapping_label) {
            const label_text = normalize_whitespace(collect_visible_text_segments(wrapping_label).join(" "))
            if (label_text) {
                return { name: label_text, primary: label_text, full_text: label_text, source: "label" }
            }
        }

        if (el instanceof HTMLInputElement) {
            const input_type = (el.type || "text").toLowerCase()
            if (["button", "submit", "reset"].includes(input_type) && el.value) {
                const val = normalize_whitespace(el.value)
                return { name: val, primary: val, full_text: val, source: "value" }
            }
        }

        const placeholder = normalize_whitespace(el.getAttribute("placeholder") || "")
        if (placeholder) {
            return { name: placeholder, primary: placeholder, full_text: placeholder, source: "placeholder" }
        }

        const title = normalize_whitespace(el.getAttribute("title") || "")
        if (title) {
            return { name: title, primary: title, full_text: title, source: "title" }
        }

        const field_name = normalize_whitespace(el.getAttribute("name") || "")
        if (field_name) {
            return { name: field_name, primary: field_name, full_text: field_name, source: "name" }
        }

        return { name: "", primary: "", full_text: "", source: "none" }
    }

    if (tag === "img") {
        const alt = normalize_whitespace(el.getAttribute("alt") || "")
        if (alt) return { name: alt, primary: alt, full_text: alt, source: "alt" }
    }

    const title = normalize_whitespace(el.getAttribute("title") || "")
    const segments = collect_visible_text_segments(el)
    if (segments.length > 0) {
        const deduped: string[] = []
        for (const seg of segments) {
            if (deduped[deduped.length - 1] !== seg) {
                deduped.push(seg)
            }
        }
        const primary = deduped[0]
        const joined = deduped.join(" · ")
        return { name: joined, primary, full_text: joined, source: "text" }
    }

    if (title) {
        return { name: title, primary: title, full_text: title, source: "title" }
    }

    const img_alt = normalize_whitespace(el.querySelector("img[alt]")?.getAttribute("alt") || "")
    if (img_alt) {
        return { name: img_alt, primary: img_alt, full_text: img_alt, source: "img-alt" }
    }

    return { name: "", primary: "", full_text: "", source: "none" }
}

export function get_element_states(el: Element, role: string, name_source: string): string[] {
    const states: string[] = []

    if ((el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true") {
        states.push("disabled")
    }

    if (el.getAttribute("aria-checked") === "true" || (el instanceof HTMLInputElement && el.checked)) {
        states.push("checked")
    }

    const aria_current = el.getAttribute("aria-current")
    if (aria_current && aria_current !== "false") {
        states.push("current")
    }

    const aria_expanded = el.getAttribute("aria-expanded")
    if (aria_expanded === "true") {
        states.push("expanded")
    } else if (aria_expanded === "false") {
        states.push("collapsed")
    }

    if (el.getAttribute("aria-selected") === "true") {
        states.push("selected")
    }

    if (el instanceof HTMLInputElement && !["button", "submit", "reset", "checkbox", "radio"].includes(el.type)) {
        if (el.value) {
            const shown = el.type === "password" ? "***" : truncate_text(el.value, 24)
            states.push(`value="${shown}"`)
        }
    } else if (el instanceof HTMLTextAreaElement && el.value) {
        states.push(`value="${truncate_text(el.value, 24)}"`)
    } else if (el instanceof HTMLSelectElement && el.selectedIndex >= 0) {
        const opt = el.options[el.selectedIndex]
        if (opt?.text) {
            states.push(`value="${truncate_text(normalize_whitespace(opt.text), 24)}"`)
        }
    }

    if (name_source === "none" && !["input", "textbox", "searchbox", "select", "slider"].includes(role)) {
        states.push("icon")
    }

    const style = getComputedStyle(el)
    if (style.touchAction && style.touchAction !== "auto") {
        states.push(`touch=${style.touchAction}`)
    }

    return states
}

export interface ElementClassification {
    kind: "landmark" | "heading" | "interactive" | "container"
    role: string
    is_interactive: boolean
    is_clickable_container: boolean
    is_landmark: boolean
    is_scrollable: boolean
    is_swipeable: boolean
}

export function get_explicit_container_name(el: Element): string {
    const aria_label = normalize_whitespace(el.getAttribute("aria-label") || "")
    if (aria_label) return aria_label

    const labelled_by = el.getAttribute("aria-labelledby")
    if (labelled_by) {
        const parts = labelled_by
            .split(/\s+/)
            .map((id) => {
                const target = document.getElementById(id)
                return target ? normalize_whitespace(target.textContent || "") : ""
            })
            .filter(Boolean)
        if (parts.length > 0) return parts.join(" ")
    }

    const title = normalize_whitespace(el.getAttribute("title") || "")
    if (title) return title

    const role = get_semantic_role(el)
    if (role === "dialog" || role === "alertdialog") {
        const heading = el.querySelector("h1, h2, h3, [role='heading']")
        if (heading) {
            const text = normalize_whitespace(heading.textContent || "")
            if (text) return text
        }
    }

    return ""
}

function is_delegation_root(el: Element, listeners: string[]): boolean {
    if (el.children.length === 0) return false
    if (listeners.length < 4) return false
    const set = new Set(listeners)
    const has_click = set.has("click")
    const has_keyboard = set.has("keydown") || set.has("keyup")
    const has_pointer_or_touch = set.has("mousedown") || set.has("pointerdown") || set.has("touchstart")
    return has_click && has_keyboard && has_pointer_or_touch
}

export function classify_element(
    el: Element,
    style: CSSStyleDeclaration,
    inside_clickable: boolean
): ElementClassification | null {
    if (el === document.documentElement || el === document.body) return null
    const tag = el.tagName.toLowerCase()
    if (SVG_SHAPE_TAGS.has(tag) && !get_explicit_role(el) && !el.hasAttribute("tabindex")) {
        return null
    }

    const semantic_role = get_semantic_role(el)
    const raw_listeners = get_direct_listeners(el)
    const listeners = is_delegation_root(el, raw_listeners) ? [] : raw_listeners
    const has_pointer_listener = listeners.some((l) =>
        ["click", "dblclick", "mousedown", "pointerdown", "contextmenu"].includes(l)
    )
    const has_touch_listener = listeners.some((l) => ["touchstart", "touchmove", "touchend"].includes(l))

    const is_scrollable =
        ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4) ||
        ((style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4)

    const is_swipeable =
        has_touch_listener ||
        style.touchAction === "none" ||
        style.touchAction === "pan-y" ||
        style.touchAction === "pan-x"

    if (semantic_role && INTERACTIVE_ROLES.has(semantic_role)) {
        return {
            kind: "interactive",
            role: semantic_role,
            is_interactive: true,
            is_clickable_container: semantic_role !== "swipeable",
            is_landmark: false,
            is_scrollable,
            is_swipeable
        }
    }

    if (semantic_role && LANDMARK_ROLES.has(semantic_role)) {
        const normalized =
            semantic_role === "navigation"
                ? "nav"
                : semantic_role === "banner"
                  ? "header"
                  : semantic_role === "contentinfo"
                    ? "footer"
                    : semantic_role === "alertdialog"
                      ? "dialog"
                      : semantic_role
        return {
            kind: "landmark",
            role: normalized,
            is_interactive: false,
            is_clickable_container: false,
            is_landmark: true,
            is_scrollable,
            is_swipeable
        }
    }

    if (semantic_role === "heading") {
        return {
            kind: "heading",
            role: "heading",
            is_interactive: false,
            is_clickable_container: false,
            is_landmark: false,
            is_scrollable,
            is_swipeable
        }
    }

    const tabindex_raw = el.getAttribute("tabindex")
    const has_positive_or_zero_tabindex = tabindex_raw !== null && Number.parseInt(tabindex_raw, 10) >= 0
    const is_editable = (el as HTMLElement).isContentEditable

    if (is_editable) {
        return {
            kind: "interactive",
            role: "textbox",
            is_interactive: true,
            is_clickable_container: true,
            is_landmark: false,
            is_scrollable,
            is_swipeable
        }
    }

    const parent = el.parentElement
    const parent_cursor = parent ? getComputedStyle(parent).cursor : "auto"
    const has_own_pointer_cursor =
        style.cursor === "pointer" &&
        (!inside_clickable
            ? parent_cursor !== "pointer" || has_explicit_label_attribute(el)
            : has_explicit_label_attribute(el))

    if (has_pointer_listener || has_positive_or_zero_tabindex || has_own_pointer_cursor) {
        return {
            kind: "interactive",
            role: "clickable",
            is_interactive: true,
            is_clickable_container: true,
            is_landmark: false,
            is_scrollable,
            is_swipeable
        }
    }

    if (has_touch_listener || style.touchAction === "none") {
        return {
            kind: "container",
            role: "swipeable",
            is_interactive: true,
            is_clickable_container: false,
            is_landmark: false,
            is_scrollable,
            is_swipeable: true
        }
    }

    if (is_scrollable) {
        return {
            kind: "container",
            role: "scrollable",
            is_interactive: false,
            is_clickable_container: false,
            is_landmark: false,
            is_scrollable: true,
            is_swipeable
        }
    }

    return null
}

function is_associated_label_relationship(target: Element, hit: Element): boolean {
    if (target instanceof HTMLLabelElement && target.control) {
        return target.control === hit || target.control.contains(hit)
    }
    if ("labels" in target && (target as HTMLInputElement).labels) {
        const labels = (target as HTMLInputElement).labels
        if (labels) {
            for (const label of labels) {
                if (label === hit || label.contains(hit)) return true
            }
        }
    }
    return false
}

export function hit_test_point(target: Element, x: number, y: number): { ok: boolean; hit: Element | null } {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
        return { ok: false, hit: null }
    }
    const hit = document.elementFromPoint(x, y)
    if (!hit) return { ok: false, hit: null }
    const ok = hit === target || target.contains(hit) || is_associated_label_relationship(target, hit)
    return { ok, hit }
}

function is_disabled_passthrough_hit(target: Element, hit: Element | null): boolean {
    if (!hit) return false
    const style = getComputedStyle(target)
    if (style.pointerEvents !== "none") return false
    if ((target as HTMLButtonElement).disabled !== true && target.getAttribute("aria-disabled") !== "true") {
        return false
    }
    // If elementFromPoint passed through a disabled pointer-events:none button onto its own ancestor, it is not covered by a modal/overlay.
    return hit.contains(target)
}

export function is_element_reachable(target: Element, rect: RectBox): boolean {
    const left = Math.max(1, rect.x + 1)
    const right = Math.min(window.innerWidth - 1, rect.x + rect.w - 1)
    const top = Math.max(1, rect.y + 1)
    const bottom = Math.min(window.innerHeight - 1, rect.y + rect.h - 1)
    if (left > right || top > bottom) return false

    const cx = Math.round((left + right) / 2)
    const cy = Math.round((top + bottom) / 2)
    const center_hit = hit_test_point(target, cx, cy)
    if (center_hit.ok || is_disabled_passthrough_hit(target, center_hit.hit)) return true

    // For larger cards/containers, check inner quadrants in case a corner badge overlaps exact center
    if (right - left > 80 || bottom - top > 80) {
        const samples: Array<[number, number]> = [
            [Math.round(left + (right - left) * 0.25), Math.round(top + (bottom - top) * 0.25)],
            [Math.round(left + (right - left) * 0.75), Math.round(top + (bottom - top) * 0.25)],
            [Math.round(left + (right - left) * 0.25), Math.round(top + (bottom - top) * 0.75)],
            [Math.round(left + (right - left) * 0.75), Math.round(top + (bottom - top) * 0.75)]
        ]
        for (const [sx, sy] of samples) {
            if (hit_test_point(target, sx, sy).ok) return true
        }
    }

    return false
}

export function describe_element_brief(el: Element | null): string {
    if (!el) return "(none)"
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ""
    const raw_class = typeof el.className === "string" ? el.className.trim() : ""
    const classes = raw_class ? `.${raw_class.split(/\s+/).slice(0, 3).join(".")}` : ""
    return `${tag}${id}${classes}`
}

export function build_css_selector(el: Element): string {
    if (el.id) {
        const by_id = `#${CSS.escape(el.id)}`
        if (document.querySelectorAll(by_id).length === 1) return by_id
    }

    const parts: string[] = []
    let current: Element | null = el

    while (current && current !== document.body && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase()
        if (current.id) {
            parts.unshift(`#${CSS.escape(current.id)}`)
            break
        }

        const parent: Element | null = current.parentElement
        if (!parent) {
            parts.unshift(tag)
            break
        }

        let same_tag_count = 0
        let index_in_tag = 0
        for (let i = 0; i < parent.children.length; i += 1) {
            const sibling = parent.children[i]
            if (sibling.tagName === current.tagName) {
                same_tag_count += 1
                if (sibling === current) {
                    index_in_tag = same_tag_count
                }
            }
        }

        const segment = same_tag_count > 1 ? `${tag}:nth-of-type(${index_in_tag})` : tag
        parts.unshift(segment)

        const candidate = parts.join(" > ")
        try {
            if (document.querySelectorAll(candidate).length === 1) {
                return candidate
            }
        } catch {
            // Keep climbing if partial selector happens to be invalid
        }

        current = parent
    }

    return parts.join(" > ")
}
