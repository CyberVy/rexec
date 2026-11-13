import type {
    ActionError,
    CandidateSummary,
    FindOptions,
    FindResult,
    InspectResult,
    SnapNode,
    SnapOptions,
    SnapResult,
    TargetInput
} from "../../shared/protocol"
import {
    build_css_selector,
    classify_element,
    describe_element_brief,
    get_accessible_name_info,
    get_element_scroll_metrics,
    get_element_states,
    get_explicit_container_name,
    hit_test_point,
    is_element_displayed,
    is_element_reachable,
    is_rect_in_viewport,
    normalize_whitespace,
    rect_center,
    to_rect_box,
    truncate_text
} from "./dom_utils"
import { get_direct_listeners } from "../listener_registry"
import {
    build_candidate_summary,
    build_readable_locator_for_entry,
    collect_element_entries,
    resolve_target,
    type ElementEntry
} from "./locator"

function has_direct_text_only(el: Element): boolean {
    if (el.children.length > 0) return false
    return normalize_whitespace(el.textContent || "").length > 0
}

function collect_snapshot_nodes(
    root: Element,
    options: {
        all: boolean
        include_text: boolean
        max_depth: number
        cached_entries: ElementEntry[]
    }
): { nodes: SnapNode[]; total_interactive: number } {
    let total_interactive = 0

    const walk = (node: Element, depth: number, inside_clickable: boolean): SnapNode[] => {
        if (depth > options.max_depth) return []
        const emitted: SnapNode[] = []

        for (let i = 0; i < node.children.length; i += 1) {
            const child = node.children[i]
            if (child.hasAttribute("inert") || child.getAttribute("aria-hidden") === "true") {
                continue
            }

            const style = getComputedStyle(child)
            if (!is_element_displayed(child, style)) {
                continue
            }

            if (style.display === "contents") {
                emitted.push(...walk(child, depth, inside_clickable))
                continue
            }

            const rect = to_rect_box(child.getBoundingClientRect())
            if (rect.w < 1 || rect.h < 1) {
                emitted.push(...walk(child, depth, inside_clickable))
                continue
            }

            const cls = classify_element(child, style, inside_clickable)
            const next_inside_clickable = inside_clickable || Boolean(cls?.is_clickable_container)
            const child_nodes = walk(child, cls ? depth + 1 : depth, next_inside_clickable)

            if (!cls) {
                if (options.include_text && !inside_clickable && has_direct_text_only(child)) {
                    const in_vp = is_rect_in_viewport(rect)
                    const reachable = in_vp ? is_element_reachable(child, rect) : options.all
                    if ((options.all || in_vp) && reachable) {
                        const text = truncate_text(normalize_whitespace(child.textContent || ""), 80)
                        if (text) {
                            emitted.push({
                                kind: "text",
                                role: "text",
                                name: text,
                                locator:
                                    text.length <= 48
                                        ? `"${text.replace(/"/g, '\\"')}"`
                                        : `css:${build_css_selector(child)}`,
                                states: [],
                                rect,
                                center: rect_center(rect)
                            })
                        }
                    }
                }
                emitted.push(...child_nodes)
                continue
            }

            const in_vp = is_rect_in_viewport(rect)
            const reachable = in_vp ? is_element_reachable(child, rect) : options.all

            if (cls.kind === "landmark" || cls.kind === "container") {
                const keep_empty = cls.role === "dialog" || cls.role === "swipeable" || cls.role === "scrollable"
                if (child_nodes.length === 0 && !keep_empty) {
                    continue
                }
                if (!options.all && !in_vp && child_nodes.length === 0) {
                    continue
                }
                if (!reachable && child_nodes.length === 0) {
                    continue
                }

                const container_name = get_explicit_container_name(child)
                const states = get_element_states(child, cls.role, container_name ? "aria-label" : "container")
                if (cls.is_swipeable && cls.role !== "swipeable") states.push("swipeable")
                if (cls.is_scrollable && cls.role !== "scrollable") states.push("scrollable")

                if (cls.is_interactive) total_interactive += 1

                const locator = build_readable_locator_for_entry(
                    child,
                    cls.role,
                    container_name,
                    options.cached_entries
                )
                emitted.push({
                    kind: cls.kind,
                    role: cls.role,
                    name: truncate_text(container_name, 48),
                    locator,
                    states,
                    rect,
                    center: rect_center(rect),
                    ...(child_nodes.length > 0 ? { children: child_nodes } : {})
                })
                continue
            }

            // Skip redundant headings that simply repeat an enclosing clickable card/button's own text
            if (cls.kind === "heading" && inside_clickable) {
                emitted.push(...child_nodes)
                continue
            }

            // heading or interactive
            if (!options.all && !in_vp) {
                emitted.push(...child_nodes)
                continue
            }

            if (in_vp && !reachable) {
                emitted.push(...child_nodes)
                continue
            }

            const name_info = get_accessible_name_info(child)
            const states = get_element_states(child, cls.role, name_info.source)
            if (cls.is_swipeable && cls.role !== "swipeable") states.push("swipeable")
            if (cls.is_scrollable && cls.role !== "scrollable") states.push("scrollable")

            if (cls.is_interactive) total_interactive += 1

            const locator = build_readable_locator_for_entry(child, cls.role, name_info.primary, options.cached_entries)
            emitted.push({
                kind: cls.kind,
                role: cls.role,
                name: truncate_text(name_info.name, 64),
                locator,
                states,
                rect,
                center: rect_center(rect),
                ...(child_nodes.length > 0 ? { children: child_nodes } : {})
            })
        }

        return emitted
    }

    const nodes = walk(root, 0, false)
    return { nodes, total_interactive }
}

export function build_snapshot(
    options?: SnapOptions
): { ok: true; data: SnapResult } | { ok: false; error: ActionError } {
    let root: Element = document.body
    if (options?.scope) {
        const resolved = resolve_target(options.scope)
        if (!resolved.ok) return { ok: false, error: resolved.error }
        if (!resolved.target.el) {
            return {
                ok: false,
                error: { code: "NOT_FOUND", message: "Scope target did not resolve to a DOM element." }
            }
        }
        root = resolved.target.el
    }

    const cached_entries = collect_element_entries(document.body, false)
    const { nodes, total_interactive } = collect_snapshot_nodes(root, {
        all: options?.all ?? false,
        include_text: options?.include_text ?? false,
        max_depth: options?.max_depth ?? 16,
        cached_entries
    })

    const has_inert_overlay = Boolean(document.querySelector("[inert]"))

    return {
        ok: true,
        data: {
            nodes,
            total_interactive,
            has_inert_overlay
        }
    }
}

export function find_targets(
    raw_target: TargetInput | string,
    options?: FindOptions
): { ok: true; data: FindResult } | { ok: false; error: ActionError } {
    const resolved = resolve_target(raw_target, {
        allow_multiple: true,
        include_hidden: options?.include_hidden ?? false
    })

    if (!resolved.ok) {
        if (resolved.error.code === "NOT_FOUND") {
            return { ok: true, data: { matches: [] } }
        }
        return { ok: false, error: resolved.error }
    }

    if (resolved.target.kind === "point") {
        const summary: CandidateSummary = {
            index: 1,
            role: resolved.target.role,
            name: resolved.target.name,
            locator: resolved.target.locator,
            scope: "",
            states: resolved.target.states,
            rect: resolved.target.rect,
            center: resolved.target.point,
            in_viewport: true
        }
        return { ok: true, data: { matches: [summary] } }
    }

    const limit = options?.all ? resolved.matches.length : 25
    const cached_entries = collect_element_entries(document.body, false)
    const matches = resolved.matches.slice(0, limit).map((entry, idx) => {
        const role = entry.classification?.role || entry.el.tagName.toLowerCase()
        const locator = build_readable_locator_for_entry(
            entry.el,
            role,
            entry.primary_name,
            options?.include_hidden ? undefined : cached_entries
        )
        return build_candidate_summary(entry, idx + 1, locator)
    })

    return { ok: true, data: { matches } }
}

export function inspect_target(
    raw_target: TargetInput | string
): { ok: true; data: InspectResult } | { ok: false; error: ActionError } {
    let resolved = resolve_target(raw_target, { include_hidden: false })
    if (!resolved.ok && resolved.error.code === "NOT_FOUND") {
        resolved = resolve_target(raw_target, { include_hidden: true })
    }
    if (!resolved.ok) {
        return { ok: false, error: resolved.error }
    }

    const el = resolved.target.el
    if (!el) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: `No DOM element found at (${resolved.target.point.x}, ${resolved.target.point.y})`
            }
        }
    }

    const style = getComputedStyle(el)
    const rect = to_rect_box(el.getBoundingClientRect())
    const center = resolved.target.point
    const in_viewport = is_rect_in_viewport(rect)
    const hit = hit_test_point(el, center.x, center.y)

    const attrs: Record<string, string> = {}
    for (let i = 0; i < el.attributes.length; i += 1) {
        const attr = el.attributes[i]
        if (attr.name === "class" || attr.name === "style") continue
        attrs[attr.name] = truncate_text(attr.value, 80)
    }

    return {
        ok: true,
        data: {
            tag: el.tagName.toLowerCase(),
            role: resolved.target.role,
            name: resolved.target.name,
            locator: resolved.target.locator,
            css_selector: build_css_selector(el),
            states: resolved.target.states,
            rect,
            center,
            in_viewport,
            hit_test: {
                ok: hit.ok,
                hit_element: describe_element_brief(hit.hit),
                ...(!hit.ok && hit.hit ? { obscured_by: describe_element_brief(hit.hit) } : {})
            },
            styles: {
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                pointer_events: style.pointerEvents,
                cursor: style.cursor,
                touch_action: style.touchAction,
                overflow_x: style.overflowX,
                overflow_y: style.overflowY
            },
            scroll: get_element_scroll_metrics(el),
            listeners: get_direct_listeners(el),
            attributes: attrs
        }
    }
}
