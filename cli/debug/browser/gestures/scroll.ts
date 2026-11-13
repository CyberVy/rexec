import {
    normalize_target_input,
    parse_scroll_edge,
    type ActionError,
    type CandidateSummary,
    type GestureCurve,
    type GestureDirection,
    type GestureDistance,
    type Point2D,
    type RectBox,
    type ScrollAlign,
    type ScrollEdge,
    type ScrollEdgeState,
    type ScrollOptions,
    type ScrollResult,
    type TargetElementSummary,
    type TargetInput
} from "../../shared/protocol"
import {
    describe_element_brief,
    get_element_scroll_metrics,
    get_scrolling_element,
    is_element_displayed,
    to_rect_box
} from "../dom/dom_utils"
import {
    build_candidate_summary,
    build_readable_locator_for_entry,
    collect_element_entries,
    resolve_target
} from "../dom/locator"
import {
    append_overlay_box,
    append_overlay_dot,
    append_overlay_line,
    clip_rect_to_viewport,
    evaluate_curve,
    invalid_options,
    mount_debug_overlay,
    resolve_and_prepare_target,
    resolve_timing_options,
    summarize_dom_element,
    wait_frames,
    wait_ms
} from "./pointer_common"

type ScrollAxis = "x" | "y" | "both"

function is_overflow_scrollable(overflow: string): boolean {
    return overflow === "auto" || overflow === "scroll" || overflow === "overlay"
}

function is_root_axis_unlocked(scrolling_el: Element, axis: "x" | "y"): boolean {
    const root_style = getComputedStyle(scrolling_el)
    const root_ov = axis === "y" ? root_style.overflowY : root_style.overflowX
    if (root_ov === "hidden" || root_ov === "clip") {
        return false
    }
    if (root_ov === "visible" && scrolling_el === document.documentElement && document.body) {
        const body_style = getComputedStyle(document.body)
        const body_ov = axis === "y" ? body_style.overflowY : body_style.overflowX
        if (body_ov === "hidden" || body_ov === "clip") {
            return false
        }
    }
    return true
}

function get_scrollable_axes(el: Element, scrolling_el: Element | null): { x: boolean; y: boolean } {
    if (el.closest("[inert]")) {
        return { x: false, y: false }
    }

    const metrics = get_element_scroll_metrics(el, scrolling_el)
    if (el === scrolling_el) {
        return {
            x: is_root_axis_unlocked(el, "x") && metrics.max_x > 1,
            y: is_root_axis_unlocked(el, "y") && metrics.max_y > 1
        }
    }

    const style = getComputedStyle(el)
    if (!is_element_displayed(el, style)) {
        return { x: false, y: false }
    }

    return {
        x: is_overflow_scrollable(style.overflowX) && metrics.max_x > 1,
        y: is_overflow_scrollable(style.overflowY) && metrics.max_y > 1
    }
}

function can_scroll_on_axis(el: Element, axis: ScrollAxis, scrolling_el: Element | null): boolean {
    const axes = get_scrollable_axes(el, scrolling_el)
    if (axis === "x") return axes.x
    if (axis === "y") return axes.y
    return axes.x || axes.y
}

function is_viewport_covering_overlay(el: Element, scrolling_el: Element | null): boolean {
    if (el === scrolling_el || el === document.body || el === document.documentElement) {
        return false
    }
    const style = getComputedStyle(el)
    const is_fixed_or_dialog =
        style.position === "fixed" || el.getAttribute("role") === "dialog" || el.tagName.toLowerCase() === "dialog"
    if (!is_fixed_or_dialog) {
        return false
    }
    const rect = el.getBoundingClientRect()
    return rect.width >= window.innerWidth * 0.5 && rect.height >= window.innerHeight * 0.5
}

function find_scrollable_ancestor(
    start_el: Element,
    axis: ScrollAxis,
    scrolling_el: Element | null,
    mode: "nearest" | "outermost_overlay",
    stop_at?: Element | null
): Element | null {
    const overlay_candidates: Element[] = []
    let cur: Element | null = start_el

    while (cur) {
        if (cur.hasAttribute("inert")) {
            break
        }

        const is_covering_overlay = is_viewport_covering_overlay(cur, scrolling_el)
        const scrollable = can_scroll_on_axis(cur, axis, scrolling_el)

        if (mode === "outermost_overlay") {
            if (scrollable) {
                overlay_candidates.push(cur)
            }
            if (is_covering_overlay) {
                return overlay_candidates.length > 0 ? overlay_candidates[overlay_candidates.length - 1] : null
            }
            if (cur === scrolling_el || cur === document.documentElement) {
                return null
            }
        } else {
            if (scrollable) {
                return cur
            }
            if (is_covering_overlay) {
                return null
            }
        }

        if (stop_at && cur === stop_at) {
            break
        }
        cur = cur.parentElement
    }

    return null
}

function get_scroll_axis_for_options(options: ScrollOptions): ScrollAxis {
    if (options.direction) {
        return options.direction === "left" || options.direction === "right" ? "x" : "y"
    }
    if (options.by) {
        const dx = Math.round(options.by.x)
        const dy = Math.round(options.by.y)
        if (dx !== 0 && dy === 0) return "x"
        if (dy !== 0 && dx === 0) return "y"
        return "both"
    }
    if (typeof options.to === "string") {
        const edge = parse_scroll_edge(options.to)
        if (edge === "left" || edge === "right") return "x"
        if (edge === "top" || edge === "bottom") return "y"
    }
    return "both"
}

function resolve_untargeted_scroll_container(
    axis: ScrollAxis,
    scrolling_el: Element | null
): { ok: true; container: Element; hit_el: Element | null } | { ok: false; error: ActionError } {
    const cx = Math.round(window.innerWidth / 2)
    const cy = Math.round(window.innerHeight / 2)
    const center_hit = document.elementFromPoint(cx, cy)

    let blocked_by_overlay = false
    if (center_hit && !center_hit.closest("[inert]")) {
        const overlay_scroller = find_scrollable_ancestor(center_hit, axis, scrolling_el, "outermost_overlay")
        if (overlay_scroller) {
            return { ok: true, container: overlay_scroller, hit_el: center_hit }
        }
        let cur: Element | null = center_hit
        while (cur) {
            if (is_viewport_covering_overlay(cur, scrolling_el)) {
                blocked_by_overlay = true
                break
            }
            cur = cur.parentElement
        }
    }

    if (!blocked_by_overlay && scrolling_el && can_scroll_on_axis(scrolling_el, axis, scrolling_el)) {
        return { ok: true, container: scrolling_el, hit_el: center_hit }
    }

    if (center_hit && !center_hit.closest("[inert]")) {
        const nearest = find_scrollable_ancestor(center_hit, axis, scrolling_el, "nearest")
        if (nearest) {
            return { ok: true, container: nearest, hit_el: center_hit }
        }
    }

    const visible_entries = collect_element_entries(document.body, false)
    const scrollable_entries = visible_entries.filter(
        (entry) => entry.in_viewport && entry.reachable && can_scroll_on_axis(entry.el, axis, scrolling_el)
    )

    if (scrollable_entries.length === 1) {
        return { ok: true, container: scrollable_entries[0].el, hit_el: center_hit }
    }

    if (scrollable_entries.length > 1) {
        const candidates: CandidateSummary[] = scrollable_entries.slice(0, 12).map((entry, idx) => {
            const role = entry.classification?.role || entry.el.tagName.toLowerCase()
            const locator = build_readable_locator_for_entry(entry.el, role, entry.primary_name, visible_entries)
            return build_candidate_summary(entry, idx + 1, locator)
        })
        return {
            ok: false,
            error: {
                code: "AMBIGUOUS",
                message: `Multiple scrollable containers (${scrollable_entries.length}) found for ${axis}-axis scroll.`,
                candidates
            }
        }
    }

    return {
        ok: false,
        error: {
            code: "UNSUPPORTED",
            message: `No scrollable container found on ${axis === "both" ? "either" : `the ${axis}`} axis.`
        }
    }
}

function compute_axis_align_delta(rel_start: number, rel_end: number, view_span: number, align: ScrollAlign): number {
    const item_span = rel_end - rel_start
    switch (align) {
        case "start":
            return rel_start
        case "end":
            return rel_end - view_span
        case "center":
            return rel_start - (view_span - item_span) / 2
        case "nearest":
            if (rel_start < 0 && rel_end > view_span) return 0
            if (rel_start < 0) return rel_start
            if (rel_end > view_span) return rel_end - view_span
            return 0
    }
}

function get_container_viewport_box(container: Element, scrolling_el: Element | null): RectBox {
    if (container !== scrolling_el) {
        const cont_rect = container.getBoundingClientRect()
        return {
            x: cont_rect.left + container.clientLeft,
            y: cont_rect.top + container.clientTop,
            w: container.clientWidth,
            h: container.clientHeight
        }
    }

    return {
        x: 0,
        y: 0,
        w: scrolling_el
            ? Math.min(scrolling_el.clientWidth || window.innerWidth, window.innerWidth)
            : window.innerWidth,
        h: scrolling_el
            ? Math.min(scrolling_el.clientHeight || window.innerHeight, window.innerHeight)
            : window.innerHeight
    }
}

function compute_scroll_to_element_delta(
    container: Element,
    scrolling_el: Element | null,
    dest_el: Element,
    align: ScrollAlign
): Point2D {
    const dest_rect = dest_el.getBoundingClientRect()
    const axes = get_scrollable_axes(container, scrolling_el)
    const view = get_container_viewport_box(container, scrolling_el)

    const dx = axes.x
        ? Math.round(compute_axis_align_delta(dest_rect.left - view.x, dest_rect.right - view.x, view.w, align))
        : 0
    const dy = axes.y
        ? Math.round(compute_axis_align_delta(dest_rect.top - view.y, dest_rect.bottom - view.y, view.h, align))
        : 0

    return { x: dx, y: dy }
}

function is_rect_within_container_viewport(
    container: Element,
    scrolling_el: Element | null,
    dest_el: Element
): boolean {
    const dest_rect = dest_el.getBoundingClientRect()
    if (dest_rect.width <= 0 || dest_rect.height <= 0) return false
    const view = get_container_viewport_box(container, scrolling_el)

    return (
        dest_rect.left >= view.x &&
        dest_rect.top >= view.y &&
        dest_rect.right <= view.x + view.w &&
        dest_rect.bottom <= view.y + view.h
    )
}

function clamp(val: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, val))
}

function compute_direction_delta(
    direction: GestureDirection,
    distance: GestureDistance | undefined,
    metrics: { client_w: number; client_h: number }
): { ok: true; delta: Point2D } | { ok: false; error: ActionError } {
    if (distance !== undefined && (!Number.isFinite(distance.value) || distance.value <= 0)) {
        return invalid_options("Scroll distance must be greater than 0.")
    }

    const horizontal = direction === "left" || direction === "right"
    const axis_span = Math.max(1, horizontal ? metrics.client_w : metrics.client_h)
    const dist_px =
        distance === undefined
            ? Math.max(1, Math.round(axis_span * 0.75))
            : distance.unit === "%"
              ? Math.round((axis_span * distance.value) / 100)
              : Math.round(distance.value)

    if (dist_px < 1) {
        return invalid_options("Computed scroll distance is less than 1px.")
    }

    switch (direction) {
        case "left":
            return { ok: true, delta: { x: -dist_px, y: 0 } }
        case "right":
            return { ok: true, delta: { x: dist_px, y: 0 } }
        case "up":
            return { ok: true, delta: { x: 0, y: -dist_px } }
        case "down":
            return { ok: true, delta: { x: 0, y: dist_px } }
    }
}

function compute_edge_delta(
    edge: ScrollEdge,
    metrics: { x: number; y: number; max_x: number; max_y: number }
): Point2D {
    switch (edge) {
        case "top":
            return { x: 0, y: -metrics.y }
        case "bottom":
            return { x: 0, y: metrics.max_y - metrics.y }
        case "left":
            return { x: -metrics.x, y: 0 }
        case "right":
            return { x: metrics.max_x - metrics.x, y: 0 }
    }
}

function apply_scroll_position(container: Element, scrolling_el: Element | null, x: number, y: number): void {
    if (container === scrolling_el) {
        window.scrollTo({ left: x, top: y, behavior: "instant" })
        return
    }
    container.scrollTo({ left: x, top: y, behavior: "instant" })
}

function resolve_wheel_dispatch_point(
    container: Element,
    scrolling_el: Element | null,
    explicit_point?: Point2D
): { target: Element; point: Point2D } {
    if (explicit_point) {
        const hit = document.elementFromPoint(explicit_point.x, explicit_point.y)
        const target =
            hit && (container === scrolling_el || hit === container || container.contains(hit)) ? hit : container
        return { target, point: explicit_point }
    }

    const box =
        container === scrolling_el
            ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
            : clip_rect_to_viewport(to_rect_box(container.getBoundingClientRect()))
    const point = {
        x: Math.round(box.x + box.w / 2),
        y: Math.round(box.y + box.h / 2)
    }
    const hit = document.elementFromPoint(point.x, point.y)
    const target = hit && (container === scrolling_el || hit === container || container.contains(hit)) ? hit : container
    return { target, point }
}

function dispatch_wheel_step(target: Element, point: Point2D, delta_x: number, delta_y: number): boolean {
    if (typeof WheelEvent !== "function") {
        return true
    }
    const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
        deltaX: delta_x,
        deltaY: delta_y,
        deltaZ: 0,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL
    })
    return target.dispatchEvent(event)
}

function compute_edge_state(metrics: { x: number; y: number; max_x: number; max_y: number }): ScrollEdgeState {
    return {
        top: metrics.y <= 1,
        bottom: metrics.y >= Math.max(0, metrics.max_y - 1),
        left: metrics.x <= 1,
        right: metrics.x >= Math.max(0, metrics.max_x - 1)
    }
}

function render_scroll_dry_run_overlay(
    container: Element,
    scrolling_el: Element | null,
    planned_dx: number,
    planned_dy: number,
    dest_el?: Element | null
): void {
    const overlay = mount_debug_overlay(1500)
    const box =
        container === scrolling_el
            ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
            : clip_rect_to_viewport(to_rect_box(container.getBoundingClientRect()))
    append_overlay_box(overlay, box, "#22c55e")

    if (dest_el) {
        append_overlay_box(overlay, to_rect_box(dest_el.getBoundingClientRect()), "#3b82f6")
    }

    const dist = Math.hypot(planned_dx, planned_dy)
    if (dist < 1) {
        return
    }

    const cx = Math.round(box.x + box.w / 2)
    const cy = Math.round(box.y + box.h / 2)
    const max_half_x = Math.max(12, box.w * 0.35)
    const max_half_y = Math.max(12, box.h * 0.35)
    const half_scale = Math.min(
        0.5,
        Math.abs(planned_dx) > 0 ? max_half_x / Math.abs(planned_dx) : 0.5,
        Math.abs(planned_dy) > 0 ? max_half_y / Math.abs(planned_dy) : 0.5
    )
    const from_pt = {
        x: Math.round(cx - planned_dx * half_scale),
        y: Math.round(cy - planned_dy * half_scale)
    }
    const to_pt = {
        x: Math.round(cx + planned_dx * half_scale),
        y: Math.round(cy + planned_dy * half_scale)
    }

    append_overlay_line(overlay, from_pt, to_pt, "#ef4444")
    append_overlay_dot(overlay, from_pt, "#22c55e")
    append_overlay_dot(overlay, to_pt, "#ef4444")
}

export async function perform_scroll(
    raw_target: TargetInput | string | undefined,
    options: ScrollOptions
): Promise<{ ok: true; data: ScrollResult } | { ok: false; error: ActionError }> {
    const has_direction = options.direction !== undefined
    const has_to = options.to !== undefined
    const has_by = options.by !== undefined
    const mode_count = [has_direction, has_to, has_by].filter(Boolean).length

    if (mode_count !== 1) {
        return invalid_options("Scroll requires exactly one of `direction`, `to`, or `by`.")
    }

    const edge: ScrollEdge | undefined =
        typeof options.to === "string" ? (parse_scroll_edge(options.to) ?? undefined) : undefined
    const element_to_target = has_to && !edge ? options.to : undefined
    const align: ScrollAlign = options.align ?? "center"
    const curve: GestureCurve = options.curve ?? "ease-out"
    const scroll_into_view = options.scroll_into_view !== false
    const instant = options.instant ?? false
    const wheel = options.wheel ?? false
    const dry_run = options.dry_run ?? false
    const scrolling_el = get_scrolling_element()
    const axis = get_scroll_axis_for_options(options)

    if (has_by) {
        if (!Number.isFinite(options.by!.x) || !Number.isFinite(options.by!.y)) {
            return invalid_options("Scroll `by` delta values must be finite numbers.")
        }
    }

    let container: Element | null = null
    let container_hit_el: Element | null = null
    let explicit_point: Point2D | undefined
    let prepared_target_summary: TargetElementSummary | undefined
    let dest_el: Element | null = null
    let to_summary: TargetElementSummary | undefined

    if (raw_target !== undefined) {
        const prepared = await resolve_and_prepare_target(raw_target, scroll_into_view, {
            check_disabled: false,
            check_obscured: false
        })
        if (!prepared.ok) {
            return { ok: false, error: prepared.error }
        }

        const t = prepared.target
        if (t.kind === "point") {
            explicit_point = t.point
        }
        const seed_el = t.el || document.elementFromPoint(t.point.x, t.point.y)
        if (!seed_el) {
            return {
                ok: false,
                error: {
                    code: "NOT_FOUND",
                    message: `No element found at target ${t.locator}.`
                }
            }
        }
        if (seed_el.closest("[inert]")) {
            return {
                ok: false,
                error: {
                    code: "DISABLED",
                    message: `Target ${t.locator} is inside an inert subtree.`
                }
            }
        }

        if (element_to_target !== undefined) {
            const dest_input = normalize_target_input(element_to_target)
            const resolved_dest = resolve_target(dest_input, {
                root: t.kind === "element" && t.el ? t.el : document.body
            })
            if (!resolved_dest.ok) {
                return { ok: false, error: resolved_dest.error }
            }
            if (resolved_dest.target.kind !== "element" || !resolved_dest.target.el) {
                return invalid_options("Scroll `to` target must resolve to a DOM element or edge.")
            }
            dest_el = resolved_dest.target.el
            to_summary = {
                role: resolved_dest.target.role,
                name: resolved_dest.target.name,
                locator: resolved_dest.target.locator,
                hit_element: describe_element_brief(dest_el),
                rect: resolved_dest.target.rect
            }

            if (can_scroll_on_axis(seed_el, "both", scrolling_el)) {
                container = seed_el
            } else {
                container = find_scrollable_ancestor(
                    dest_el.parentElement ?? dest_el,
                    "both",
                    scrolling_el,
                    "nearest",
                    seed_el
                )
            }

            if (!container) {
                if (is_rect_within_container_viewport(seed_el, scrolling_el, dest_el)) {
                    container = seed_el
                } else {
                    return {
                        ok: false,
                        error: {
                            code: "UNSUPPORTED",
                            message: `Target ${t.locator} and its ancestors have no scrollable range to reach ${to_summary.locator}.`
                        }
                    }
                }
            }
        } else {
            container = find_scrollable_ancestor(seed_el, axis, scrolling_el, "nearest")
            if (!container) {
                return {
                    ok: false,
                    error: {
                        code: "UNSUPPORTED",
                        message: `Target ${t.locator} and its ancestors have no scrollable range on ${axis === "both" ? "either" : `the ${axis}`} axis.`
                    }
                }
            }
        }

        container_hit_el = seed_el
        if (t.kind === "element" && container === t.el) {
            prepared_target_summary = {
                role: t.role,
                name: t.name,
                locator: t.locator,
                hit_element: describe_element_brief(seed_el),
                rect: to_rect_box(container.getBoundingClientRect())
            }
        }
    } else if (element_to_target !== undefined) {
        const dest_input = normalize_target_input(element_to_target)
        const resolved_dest = resolve_target(dest_input)
        if (!resolved_dest.ok) {
            return { ok: false, error: resolved_dest.error }
        }
        if (resolved_dest.target.kind !== "element" || !resolved_dest.target.el) {
            return invalid_options("Scroll `to` target must resolve to a DOM element or edge.")
        }
        dest_el = resolved_dest.target.el
        to_summary = {
            role: resolved_dest.target.role,
            name: resolved_dest.target.name,
            locator: resolved_dest.target.locator,
            hit_element: describe_element_brief(dest_el),
            rect: resolved_dest.target.rect
        }

        let cur: Element | null = dest_el.parentElement ?? dest_el
        let first_scrollable: Element | null = null
        let overlay_root: Element | null = null
        while (cur) {
            if (cur.hasAttribute("inert")) {
                break
            }
            if (can_scroll_on_axis(cur, "both", scrolling_el)) {
                if (!first_scrollable) {
                    first_scrollable = cur
                }
                const probe_delta = compute_scroll_to_element_delta(cur, scrolling_el, dest_el, align)
                const metrics = get_element_scroll_metrics(cur, scrolling_el)
                const clamped_x = clamp(metrics.x + probe_delta.x, 0, metrics.max_x) - metrics.x
                const clamped_y = clamp(metrics.y + probe_delta.y, 0, metrics.max_y) - metrics.y
                if (clamped_x !== 0 || clamped_y !== 0) {
                    container = cur
                    break
                }
            }
            if (is_viewport_covering_overlay(cur, scrolling_el)) {
                overlay_root = cur
                break
            }
            cur = cur.parentElement
        }

        if (!container) {
            if (first_scrollable) {
                container = first_scrollable
            } else {
                const boundary_el = overlay_root ?? scrolling_el
                if (boundary_el && is_rect_within_container_viewport(boundary_el, scrolling_el, dest_el)) {
                    container = boundary_el
                } else {
                    return {
                        ok: false,
                        error: {
                            code: "UNSUPPORTED",
                            message: `No scrollable container found to reach ${to_summary.locator}.`
                        }
                    }
                }
            }
        }
        container_hit_el = dest_el
    } else {
        const resolved = resolve_untargeted_scroll_container(axis, scrolling_el)
        if (!resolved.ok) {
            return resolved
        }
        container = resolved.container
        container_hit_el = resolved.hit_el
    }

    const before_metrics = get_element_scroll_metrics(container, scrolling_el)
    const before: Point2D = { x: before_metrics.x, y: before_metrics.y }
    const max: Point2D = { x: before_metrics.max_x, y: before_metrics.max_y }

    let requested_delta: Point2D
    if (options.direction) {
        const dir_res = compute_direction_delta(options.direction, options.distance, before_metrics)
        if (!dir_res.ok) {
            return dir_res
        }
        requested_delta = dir_res.delta
    } else if (edge) {
        requested_delta = compute_edge_delta(edge, before_metrics)
    } else if (options.by) {
        requested_delta = {
            x: Math.round(options.by.x),
            y: Math.round(options.by.y)
        }
    } else {
        requested_delta = compute_scroll_to_element_delta(container, scrolling_el, dest_el!, align)
    }

    const target_scroll: Point2D = {
        x: clamp(before.x + requested_delta.x, 0, max.x),
        y: clamp(before.y + requested_delta.y, 0, max.y)
    }
    const planned_dx = target_scroll.x - before.x
    const planned_dy = target_scroll.y - before.y
    const planned_dist = Math.round(Math.hypot(planned_dx, planned_dy))

    const timing = resolve_timing_options(options, 0, planned_dist)
    if (!timing.ok) {
        return timing
    }

    const target_summary =
        prepared_target_summary ?? summarize_dom_element(container, container_hit_el ?? container, scrolling_el)

    if (dry_run) {
        render_scroll_dry_run_overlay(container, scrolling_el, planned_dx, planned_dy, dest_el)
        return {
            ok: true,
            data: {
                mode: "scroll",
                dry_run: true,
                instant,
                wheel,
                ...(options.direction ? { direction: options.direction } : {}),
                ...(edge ? { edge } : {}),
                curve,
                before,
                after: target_scroll,
                max,
                requested_delta,
                actual_delta: { x: planned_dx, y: planned_dy },
                distance_px: planned_dist,
                requested_duration_ms: timing.duration_ms,
                actual_duration_ms: 0,
                frames: 0,
                at_edge: compute_edge_state({
                    x: target_scroll.x,
                    y: target_scroll.y,
                    max_x: max.x,
                    max_y: max.y
                }),
                target: target_summary,
                ...(to_summary ? { to_target: to_summary } : {})
            }
        }
    }

    let frames = 0
    const started_at = performance.now()

    if (planned_dx !== 0 || planned_dy !== 0) {
        const wheel_ctx = wheel ? resolve_wheel_dispatch_point(container, scrolling_el, explicit_point) : null

        if (timing.duration_ms === 0) {
            let allow_scroll = true
            if (wheel_ctx) {
                allow_scroll = dispatch_wheel_step(wheel_ctx.target, wheel_ctx.point, planned_dx, planned_dy)
            }
            if (allow_scroll) {
                apply_scroll_position(container, scrolling_el, target_scroll.x, target_scroll.y)
            }
            frames = 1
        } else {
            const steps = Math.max(3, Math.min(240, Math.round(timing.duration_ms / 16)))
            const move_start_t = performance.now()
            let last_x = before.x
            let last_y = before.y

            for (let i = 1; i <= steps; i += 1) {
                if (container !== scrolling_el && !container.isConnected) {
                    break
                }
                const rel_t = (timing.duration_ms * i) / steps
                const is_last = i === steps
                const now_elapsed = performance.now() - move_start_t

                if (!is_last && now_elapsed >= (timing.duration_ms * (i + 1)) / steps) {
                    continue
                }

                if (now_elapsed < rel_t) {
                    await wait_ms(Math.max(1, rel_t - now_elapsed))
                }

                const progress = is_last ? 1 : Math.min(1, (performance.now() - move_start_t) / timing.duration_ms)
                const eased = is_last ? 1 : evaluate_curve(curve, progress)
                const next_x = Math.round(before.x + planned_dx * eased)
                const next_y = Math.round(before.y + planned_dy * eased)
                const step_dx = next_x - last_x
                const step_dy = next_y - last_y

                if (step_dx !== 0 || step_dy !== 0 || is_last) {
                    let allow_scroll = true
                    if (wheel_ctx && (step_dx !== 0 || step_dy !== 0)) {
                        allow_scroll = dispatch_wheel_step(wheel_ctx.target, wheel_ctx.point, step_dx, step_dy)
                    }
                    if (allow_scroll) {
                        apply_scroll_position(container, scrolling_el, next_x, next_y)
                    }
                    last_x = next_x
                    last_y = next_y
                    frames += 1
                }
            }
        }
    }

    const actual_duration_ms = Math.round(performance.now() - started_at)
    await wait_frames(2)

    const after_metrics = get_element_scroll_metrics(container, scrolling_el)
    const after: Point2D = { x: after_metrics.x, y: after_metrics.y }
    const actual_delta: Point2D = { x: after.x - before.x, y: after.y - before.y }

    return {
        ok: true,
        data: {
            mode: "scroll",
            dry_run: false,
            instant,
            wheel,
            ...(options.direction ? { direction: options.direction } : {}),
            ...(edge ? { edge } : {}),
            curve,
            before,
            after,
            max: { x: after_metrics.max_x, y: after_metrics.max_y },
            requested_delta,
            actual_delta,
            distance_px: Math.round(Math.hypot(actual_delta.x, actual_delta.y)),
            requested_duration_ms: timing.duration_ms,
            actual_duration_ms,
            frames,
            at_edge: compute_edge_state(after_metrics),
            target: target_summary,
            ...(to_summary ? { to_target: to_summary } : {})
        }
    }
}
