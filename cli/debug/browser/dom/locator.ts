import {
    normalize_target_input,
    type ActionError,
    type CandidateSummary,
    type Point2D,
    type RectBox,
    type TargetAnchor,
    type TargetInput,
    type TargetStep
} from "../../shared/protocol"
import {
    build_css_selector,
    classify_element,
    get_accessible_name_info,
    get_element_states,
    get_explicit_container_name,
    is_element_displayed,
    is_element_reachable,
    is_rect_in_viewport,
    normalize_whitespace,
    rect_center,
    role_matches,
    to_rect_box,
    truncate_text,
    type ElementClassification
} from "./dom_utils"

export interface ElementEntry {
    el: Element
    classification: ElementClassification | null
    name: string
    primary_name: string
    full_text: string
    name_source: string
    states: string[]
    rect: RectBox
    center: Point2D
    in_viewport: boolean
    reachable: boolean
    scope_el: Element | null
}

export interface ResolvedTarget {
    kind: "element" | "point"
    el: Element | null
    point: Point2D
    rect: RectBox
    role: string
    name: string
    states: string[]
    locator: string
}

export type ResolveResult =
    | { ok: true; target: ResolvedTarget; matches: ElementEntry[] }
    | { ok: false; error: ActionError }

function match_text(candidate: string, query: string, mode: "exact" | "substring"): boolean {
    if (!candidate) return false
    const a = candidate.toLowerCase()
    const b = query.toLowerCase()
    return mode === "exact" ? a === b : a.includes(b)
}

function entry_matches_text(entry: ElementEntry, query: string, mode: "exact" | "substring"): boolean {
    const title = normalize_whitespace(entry.el.getAttribute("title") || "")
    const placeholder = normalize_whitespace(entry.el.getAttribute("placeholder") || "")
    const aria_label = normalize_whitespace(entry.el.getAttribute("aria-label") || "")
    return (
        match_text(entry.name, query, mode) ||
        match_text(entry.primary_name, query, mode) ||
        match_text(entry.full_text, query, mode) ||
        match_text(aria_label, query, mode) ||
        match_text(title, query, mode) ||
        match_text(placeholder, query, mode)
    )
}

export function collect_element_entries(root: Element, include_hidden: boolean): ElementEntry[] {
    const entries: ElementEntry[] = []

    const walk = (node: Element, inside_clickable: boolean, current_scope: Element | null) => {
        for (let i = 0; i < node.children.length; i += 1) {
            const child = node.children[i]
            if (!include_hidden) {
                if (child.hasAttribute("inert") || child.getAttribute("aria-hidden") === "true") {
                    continue
                }
            }

            const style = getComputedStyle(child)
            if (!include_hidden && !is_element_displayed(child, style)) {
                continue
            }

            if (style.display === "contents") {
                walk(child, inside_clickable, current_scope)
                continue
            }

            const rect = to_rect_box(child.getBoundingClientRect())
            const has_box = rect.w >= 1 && rect.h >= 1
            const classification = has_box ? classify_element(child, style, inside_clickable) : null

            let entry: ElementEntry | null = null
            if (has_box) {
                const name_info = get_accessible_name_info(child)
                const role = classification?.role || child.tagName.toLowerCase()
                const in_viewport = is_rect_in_viewport(rect)
                const reachable = in_viewport ? is_element_reachable(child, rect) : true
                entry = {
                    el: child,
                    classification,
                    name: name_info.name,
                    primary_name: name_info.primary,
                    full_text: name_info.full_text,
                    name_source: name_info.source,
                    states: classification ? get_element_states(child, role, name_info.source) : [],
                    rect,
                    center: rect_center(rect),
                    in_viewport,
                    reachable,
                    scope_el: current_scope
                }
                entries.push(entry)
            }

            const next_inside_clickable = inside_clickable || Boolean(classification?.is_clickable_container)
            const next_scope =
                classification &&
                (classification.is_landmark || classification.is_interactive || classification.is_scrollable)
                    ? child
                    : current_scope

            walk(child, next_inside_clickable, next_scope)
        }
    }

    walk(root, false, null)
    return entries
}

function match_step_candidates(
    root: Element,
    step: TargetStep,
    is_final: boolean,
    include_hidden: boolean,
    cached_entries?: ElementEntry[]
): ElementEntry[] {
    if (step.kind === "css") {
        let matched: Element[] = []
        try {
            matched = Array.from(root.querySelectorAll(step.selector))
        } catch {
            return []
        }

        const results: ElementEntry[] = []
        for (const el of matched) {
            if (!include_hidden) {
                if (el.closest("[inert]") || el.closest('[aria-hidden="true"]')) continue
                if (!is_element_displayed(el)) continue
            }
            const style = getComputedStyle(el)
            const rect = to_rect_box(el.getBoundingClientRect())
            if (!include_hidden && (rect.w < 1 || rect.h < 1)) continue
            const classification = classify_element(el, style, false)
            const name_info = get_accessible_name_info(el)
            const role = classification?.role || el.tagName.toLowerCase()
            const in_viewport = is_rect_in_viewport(rect)
            results.push({
                el,
                classification,
                name: name_info.name,
                primary_name: name_info.primary,
                full_text: name_info.full_text,
                name_source: name_info.source,
                states: classification ? get_element_states(el, role, name_info.source) : [],
                rect,
                center: rect_center(rect),
                in_viewport,
                reachable: in_viewport ? is_element_reachable(el, rect) : true,
                scope_el: null
            })
        }
        return step.nth !== undefined ? pick_nth(results, step.nth) : results
    }

    const all_entries = cached_entries
        ? root === document.body
            ? cached_entries
            : cached_entries.filter((e) => e.el !== root && root.contains(e.el))
        : collect_element_entries(root, include_hidden)

    if (step.kind === "role") {
        const by_role = all_entries.filter(
            (entry) => entry.classification && role_matches(entry.classification.role, step.role)
        )
        let matched = by_role
        if (step.name) {
            const exact_matches = by_role.filter((e) => entry_matches_text(e, step.name!, "exact"))
            if (exact_matches.length > 0) {
                matched = exact_matches
            } else if (!step.exact) {
                matched = by_role.filter((e) => entry_matches_text(e, step.name!, "substring"))
            } else {
                matched = []
            }
        }
        matched = prefer_reachable_when_available(matched)
        return step.nth !== undefined ? pick_nth(matched, step.nth) : matched
    }

    // step.kind === "text"
    const classified = all_entries.filter((e) => e.classification !== null)
    const classified_interactive = classified.filter((e) => e.classification?.is_interactive)

    let matched: ElementEntry[] = []

    if (is_final) {
        // 1. Exact interactive -> 2. Exact classified -> 3. Substring interactive -> 4. Substring classified -> 5. Visible leaf fallback
        const exact_interactive = classified_interactive.filter((e) => entry_matches_text(e, step.value, "exact"))
        if (exact_interactive.length > 0) {
            matched = exact_interactive
        } else {
            const exact_classified = classified.filter((e) => entry_matches_text(e, step.value, "exact"))
            if (exact_classified.length > 0) {
                matched = exact_classified
            } else if (!step.exact) {
                const sub_interactive = classified_interactive.filter((e) =>
                    entry_matches_text(e, step.value, "substring")
                )
                if (sub_interactive.length > 0) {
                    matched = sub_interactive
                } else {
                    const sub_classified = classified.filter((e) => entry_matches_text(e, step.value, "substring"))
                    if (sub_classified.length > 0) {
                        matched = sub_classified
                    } else {
                        const mode = "substring"
                        const fallback = all_entries.filter((e) => entry_matches_text(e, step.value, mode))
                        matched = prune_redundant_ancestors(fallback)
                    }
                }
            } else {
                const exact_fallback = all_entries.filter((e) => entry_matches_text(e, step.value, "exact"))
                matched = prune_redundant_ancestors(exact_fallback)
            }
        }
    } else {
        // Scope step: collect all visible elements matching text (exact preferred unless nested inside larger container)
        const mode = step.exact ? "exact" : "substring"
        const exact_matches = all_entries.filter((e) => entry_matches_text(e, step.value, "exact"))
        const sub_matches = step.exact ? [] : all_entries.filter((e) => entry_matches_text(e, step.value, mode))
        const combined_set = new Map<Element, ElementEntry>()
        for (const item of [...exact_matches, ...sub_matches]) {
            combined_set.set(item.el, item)
        }
        matched = Array.from(combined_set.values())
    }

    matched = prefer_reachable_when_available(matched)
    return step.nth !== undefined ? pick_nth(matched, step.nth) : matched
}

function prefer_reachable_when_available(entries: ElementEntry[]): ElementEntry[] {
    if (entries.length <= 1) return entries
    const reachable = entries.filter((e) => !e.in_viewport || e.reachable)
    return reachable.length > 0 ? reachable : entries
}

function prune_redundant_ancestors(entries: ElementEntry[]): ElementEntry[] {
    if (entries.length <= 1) return entries
    return entries.filter(
        (candidate) => !entries.some((other) => other !== candidate && candidate.el.contains(other.el))
    )
}

function pick_nth(entries: ElementEntry[], nth: number): ElementEntry[] {
    if (nth < 1 || nth > entries.length) return []
    return [entries[nth - 1]]
}

function resolve_steps_recursive(
    root: Element,
    steps: TargetStep[],
    step_index: number,
    include_hidden: boolean,
    cached_entries?: ElementEntry[]
): ElementEntry[] {
    const step = steps[step_index]
    const is_final = step_index === steps.length - 1
    const candidates = match_step_candidates(root, step, is_final, include_hidden, cached_entries)

    if (is_final) {
        return candidates
    }

    // For scope steps: keep the tightest matching scopes that actually yield downstream matches
    const fulfilling: Array<{ scope: ElementEntry; results: ElementEntry[] }> = []
    for (const scope of candidates) {
        const sub_results = resolve_steps_recursive(scope.el, steps, step_index + 1, include_hidden, cached_entries)
        if (sub_results.length > 0) {
            fulfilling.push({ scope, results: sub_results })
        }
    }

    const tight_fulfilling = fulfilling.filter(
        (item) => !fulfilling.some((other) => other !== item && item.scope.el.contains(other.scope.el))
    )

    const deduped = new Map<Element, ElementEntry>()
    for (const item of tight_fulfilling) {
        for (const result of item.results) {
            deduped.set(result.el, result)
        }
    }
    return Array.from(deduped.values())
}

export function format_locator_name(name: string): string {
    const trimmed = normalize_whitespace(name)
    if (!trimmed) return ""
    const safe = trimmed.replace(/"/g, '\\"')
    return `"${safe}"`
}

export function describe_scope_for_element(el: Element): string {
    let cur = el.parentElement
    while (cur && cur !== document.body && cur !== document.documentElement) {
        const style = getComputedStyle(cur)
        const cls = classify_element(cur, style, false)
        if (cls) {
            if (cls.kind === "landmark" || cls.kind === "container") {
                const container_name = get_explicit_container_name(cur)
                if (container_name && container_name.length <= 80 && is_clean_locator_text(container_name)) {
                    return `${cls.role} ${format_locator_name(container_name)}`
                }
                if (cls.is_landmark) {
                    return cls.role
                }
            } else if (cls.is_interactive) {
                const info = get_accessible_name_info(cur)
                if (info.primary && info.primary.length <= 120 && is_clean_locator_text(info.primary)) {
                    return format_locator_name(info.primary)
                }
            }
        }
        cur = cur.parentElement
    }
    return ""
}

export function compute_anchor_point(rect: RectBox, anchor?: TargetAnchor): Point2D {
    if (!anchor) return rect_center(rect)

    if (anchor.kind === "ratio") {
        const raw_x = rect.x + rect.w * anchor.x
        const raw_y = rect.y + rect.h * anchor.y
        const min_x = rect.x + 1
        const max_x = Math.max(min_x, rect.x + rect.w - 1)
        const min_y = rect.y + 1
        const max_y = Math.max(min_y, rect.y + rect.h - 1)
        return {
            x: Math.round(Math.min(max_x, Math.max(min_x, raw_x))),
            y: Math.round(Math.min(max_y, Math.max(min_y, raw_y)))
        }
    }

    if (anchor.kind === "offset") {
        return {
            x: Math.round(rect.x + anchor.x),
            y: Math.round(rect.y + anchor.y)
        }
    }

    return {
        x: Math.round(rect.x + rect.w / 2 + anchor.x),
        y: Math.round(rect.y + rect.h / 2 + anchor.y)
    }
}

export function build_candidate_summary(entry: ElementEntry, index: number, locator: string): CandidateSummary {
    const role = entry.classification?.role || entry.el.tagName.toLowerCase()
    return {
        index,
        role,
        name: truncate_text(entry.name, 64),
        locator,
        scope: describe_scope_for_element(entry.el),
        states: entry.states,
        rect: entry.rect,
        center: entry.center,
        in_viewport: entry.in_viewport
    }
}

export function is_clean_locator_text(text: string): boolean {
    if (!text) return false
    if (text.includes(">>") || text.includes("@") || text.includes('"')) return false
    return true
}

export function build_readable_locator_for_entry(
    el: Element,
    role: string,
    primary_name: string,
    cached_entries?: ElementEntry[]
): string {
    const root_entries = cached_entries ?? collect_element_entries(document.body, false)

    const try_unique = (candidate: string): boolean => {
        const parsed = normalize_target_input(candidate)
        if (!parsed.steps || parsed.steps.length === 0) return false
        const found = resolve_steps_recursive(document.body, parsed.steps, 0, false, root_entries)
        return found.length === 1 && found[0].el === el
    }

    if (primary_name && is_clean_locator_text(primary_name) && primary_name.length <= 120) {
        const role_and_name = `${role}:"${primary_name}"`
        if (try_unique(role_and_name)) return role_and_name

        const exact_role_and_name = `${role}:="${primary_name}"`
        if (try_unique(exact_role_and_name)) return exact_role_and_name
    }

    const scope_label = describe_scope_for_element(el)
    if (scope_label && !scope_label.includes(">>") && !scope_label.includes("@")) {
        const clean_scope = scope_label.includes(" ") ? scope_label.replace(/^([a-z]+)\s+"/, '$1:"') : scope_label
        if (primary_name && is_clean_locator_text(primary_name) && primary_name.length <= 120) {
            const scoped = `${clean_scope} >> ${role}:"${primary_name}"`
            if (try_unique(scoped)) return scoped
        }

        // Try landmark >> role#nth
        const scope_parsed = normalize_target_input(clean_scope)
        if (scope_parsed.steps && scope_parsed.steps.length > 0) {
            const scope_matches = resolve_steps_recursive(document.body, scope_parsed.steps, 0, false, root_entries)
            if (scope_matches.length === 1) {
                const scope_root = scope_matches[0].el
                const same_role_in_scope = root_entries.filter(
                    (e) =>
                        e.el !== scope_root &&
                        scope_root.contains(e.el) &&
                        e.classification &&
                        role_matches(e.classification.role, role)
                )
                const idx = same_role_in_scope.findIndex((e) => e.el === el)
                if (idx >= 0) {
                    const indexed = `${clean_scope} >> ${role}#${idx + 1}`
                    if (try_unique(indexed)) return indexed
                }
            }
        }
    }

    const global_same_role = root_entries.filter((e) => e.classification && role_matches(e.classification.role, role))
    const global_idx = global_same_role.findIndex((e) => e.el === el)
    if (global_idx >= 0) {
        const global_indexed = `${role}#${global_idx + 1}`
        if (try_unique(global_indexed)) return global_indexed
    }

    return `css:${build_css_selector(el)}`
}

export function resolve_target(
    raw_target: TargetInput | string,
    options?: { allow_multiple?: boolean; include_hidden?: boolean }
): ResolveResult {
    const input = normalize_target_input(raw_target)
    const include_hidden = options?.include_hidden ?? false

    if (input.point) {
        const x = Math.round(input.point.x_unit === "%" ? (window.innerWidth * input.point.x) / 100 : input.point.x)
        const y = Math.round(input.point.y_unit === "%" ? (window.innerHeight * input.point.y) / 100 : input.point.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return {
                ok: false,
                error: { code: "INVALID_TARGET", message: "Invalid viewport coordinates." }
            }
        }
        const hit = document.elementFromPoint(x, y)
        const rect: RectBox = hit ? to_rect_box(hit.getBoundingClientRect()) : { x, y, w: 0, h: 0 }
        const style = hit ? getComputedStyle(hit) : null
        const cls = hit && style ? classify_element(hit, style, false) : null
        const name_info = hit ? get_accessible_name_info(hit) : { name: "", primary: "", full_text: "", source: "none" }
        const role = cls?.role || (hit ? hit.tagName.toLowerCase() : "point")

        return {
            ok: true,
            matches: [],
            target: {
                kind: "point",
                el: hit,
                point: { x, y },
                rect,
                role,
                name: truncate_text(name_info.name, 64),
                states: hit ? get_element_states(hit, role, name_info.source) : [],
                locator: `${x},${y}`
            }
        }
    }

    if (!input.steps || input.steps.length === 0) {
        return {
            ok: false,
            error: { code: "INVALID_TARGET", message: "Empty target locator." }
        }
    }

    const cached_entries = collect_element_entries(document.body, include_hidden)
    let matches = resolve_steps_recursive(document.body, input.steps, 0, include_hidden, cached_entries)
    if (input.nth !== undefined) {
        matches = pick_nth(matches, input.nth)
    }

    if (matches.length === 0) {
        const label = typeof raw_target === "string" ? raw_target : JSON.stringify(raw_target)
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: `No element matched target: ${label}`
            }
        }
    }

    const locator_cache = include_hidden ? undefined : cached_entries

    if (matches.length > 1 && !options?.allow_multiple) {
        const label = typeof raw_target === "string" ? raw_target : JSON.stringify(raw_target)
        const candidates: CandidateSummary[] = matches.slice(0, 12).map((entry, idx) => {
            const role = entry.classification?.role || entry.el.tagName.toLowerCase()
            const locator = build_readable_locator_for_entry(entry.el, role, entry.primary_name, locator_cache)
            return build_candidate_summary(entry, idx + 1, locator)
        })
        return {
            ok: false,
            error: {
                code: "AMBIGUOUS",
                message: `Multiple elements (${matches.length}) matched target: ${label}`,
                candidates
            }
        }
    }

    const chosen = matches[0]
    const role = chosen.classification?.role || chosen.el.tagName.toLowerCase()
    const point = compute_anchor_point(chosen.rect, input.anchor)
    const locator = build_readable_locator_for_entry(chosen.el, role, chosen.primary_name, locator_cache)

    return {
        ok: true,
        matches,
        target: {
            kind: "element",
            el: chosen.el,
            point,
            rect: chosen.rect,
            role,
            name: truncate_text(chosen.name, 64),
            states: chosen.states,
            locator
        }
    }
}
