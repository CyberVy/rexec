import {
    apply_target_modifiers,
    parse_gesture_direction,
    parse_gesture_distance,
    parse_point_delta,
    parse_scroll_align,
    parse_scroll_edge,
    parse_target_string,
    type ActionResult,
    type DebugUiCommand,
    type DragOptions,
    type FillOptions,
    type FillResult,
    type FindOptions,
    type FindResult,
    type GestureCurve,
    type GestureDirection,
    type GestureDistance,
    type GestureResult,
    type GestureSpeed,
    type HoverOptions,
    type HoverResult,
    type InspectResult,
    type LogEntry,
    type LongPressOptions,
    type LongPressResult,
    type PressOptions,
    type PressResult,
    type ScrollAlign,
    type ScrollEdge,
    type ScrollOptions,
    type ScrollResult,
    type SelectOptionMatchBy,
    type SelectOptions,
    type SelectResult,
    type SnapNode,
    type SnapOptions,
    type SnapResult,
    type SwipeOptions,
    type TapOptions,
    type TapResult,
    type TargetInput,
    type TargetModifiers
} from "../shared/protocol"
import { evaluate_in_browser, read_debug_port } from "./bridge_client"

interface ParsedCliArgs {
    command: string
    positionals: string[]
    flags: Map<string, string | boolean>
}

const VALUE_FLAGS = new Set([
    "in",
    "role",
    "nth",
    "css",
    "at",
    "depth",
    "pointer",
    "button",
    "to",
    "by",
    "speed",
    "duration",
    "velocity",
    "curve",
    "hold-start",
    "hold-end",
    "align",
    "value",
    "label",
    "index",
    "key",
    "from",
    "hold"
])

const VALID_SPEEDS = new Set<GestureSpeed>(["fast", "normal", "slow"])
const VALID_CURVES = new Set<GestureCurve>(["linear", "ease-in", "ease-out", "ease-in-out"])

function parse_cli_args(argv: string[]): ParsedCliArgs {
    const command = argv[0] || "help"
    const positionals: string[] = []
    const flags = new Map<string, string | boolean>()

    for (let i = 1; i < argv.length; i += 1) {
        const arg = argv[i]
        if (arg === "--") {
            positionals.push(...argv.slice(i + 1))
            break
        }
        if (!arg.startsWith("-")) {
            positionals.push(arg)
            continue
        }

        if (arg === "-h") {
            flags.set("help", true)
            continue
        }

        if (!arg.startsWith("--")) {
            throw new Error(`Unknown short flag: ${arg}`)
        }

        const eq_idx = arg.indexOf("=")
        if (eq_idx > 2) {
            const key = arg.slice(2, eq_idx)
            const value = arg.slice(eq_idx + 1)
            flags.set(key, value)
            continue
        }

        const key = arg.slice(2)
        if (VALUE_FLAGS.has(key)) {
            const next = argv[i + 1]
            if (next === undefined) {
                throw new Error(`Flag --${key} requires a value`)
            }
            flags.set(key, next)
            i += 1
        } else {
            flags.set(key, true)
        }
    }

    return { command, positionals, flags }
}

function get_string_flag(flags: Map<string, string | boolean>, name: string): string | undefined {
    const val = flags.get(name)
    return typeof val === "string" ? val : undefined
}

function get_boolean_flag(flags: Map<string, string | boolean>, name: string): boolean {
    return flags.get(name) === true
}

function get_number_flag(flags: Map<string, string | boolean>, name: string): number | undefined {
    const raw = get_string_flag(flags, name)
    if (raw === undefined) return undefined
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Flag --${name} must be a positive integer, got: ${raw}`)
    }
    return parsed
}

function get_float_flag(
    flags: Map<string, string | boolean>,
    name: string,
    min_exclusive_zero: boolean
): number | undefined {
    const raw = get_string_flag(flags, name)
    if (raw === undefined) return undefined
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || (min_exclusive_zero ? parsed <= 0 : parsed < 0)) {
        const expected = min_exclusive_zero ? "positive number" : "non-negative number"
        throw new Error(`Flag --${name} must be a ${expected}, got: ${raw}`)
    }
    return parsed
}

function parse_pointer_flag(flags: Map<string, string | boolean>): "mouse" | "touch" | undefined {
    const pointer_raw = get_string_flag(flags, "pointer")
    if (pointer_raw === undefined) return undefined
    if (pointer_raw !== "mouse" && pointer_raw !== "touch") {
        throw new Error(`Invalid --pointer value: ${pointer_raw} (expected "mouse" or "touch")`)
    }
    return pointer_raw
}

function parse_kinematics_flags(
    flags: Map<string, string | boolean>,
    allow_instant: boolean
): {
    speed?: GestureSpeed
    duration_ms?: number
    velocity?: number
    curve?: GestureCurve
    instant?: boolean
    scroll_into_view: boolean
    dry_run: boolean
} {
    const speed_raw = get_string_flag(flags, "speed")
    let speed: GestureSpeed | undefined
    if (speed_raw !== undefined) {
        if (!VALID_SPEEDS.has(speed_raw as GestureSpeed)) {
            throw new Error(`Invalid --speed value: ${speed_raw} (expected "fast", "normal", or "slow")`)
        }
        speed = speed_raw as GestureSpeed
    }

    const duration_ms = get_float_flag(flags, "duration", true)
    const velocity = get_float_flag(flags, "velocity", true)
    const instant = allow_instant ? get_boolean_flag(flags, "instant") : false
    const timing_count = [speed !== undefined, duration_ms !== undefined, velocity !== undefined, instant].filter(
        Boolean
    ).length
    if (timing_count > 1) {
        throw new Error(
            allow_instant
                ? "Flags --speed, --duration, --velocity, and --instant are mutually exclusive."
                : "Flags --speed, --duration, and --velocity are mutually exclusive."
        )
    }

    const curve_raw = get_string_flag(flags, "curve")
    let curve: GestureCurve | undefined
    if (curve_raw !== undefined) {
        if (!VALID_CURVES.has(curve_raw as GestureCurve)) {
            throw new Error(
                `Invalid --curve value: ${curve_raw} (expected "linear", "ease-in", "ease-out", or "ease-in-out")`
            )
        }
        curve = curve_raw as GestureCurve
    }

    return {
        ...(speed ? { speed } : {}),
        ...(duration_ms !== undefined ? { duration_ms } : {}),
        ...(velocity !== undefined ? { velocity } : {}),
        ...(curve ? { curve } : {}),
        ...(instant ? { instant: true } : {}),
        scroll_into_view: !get_boolean_flag(flags, "no-scroll"),
        dry_run: get_boolean_flag(flags, "dry-run")
    }
}

function parse_gesture_flags(flags: Map<string, string | boolean>): {
    speed?: GestureSpeed
    duration_ms?: number
    velocity?: number
    curve?: GestureCurve
    pointer?: "touch" | "mouse"
    hold_start_ms?: number
    hold_end_ms?: number
    scroll_into_view: boolean
    dry_run: boolean
} {
    const kinematics = parse_kinematics_flags(flags, false)
    const pointer = parse_pointer_flag(flags)
    const hold_start_ms = get_float_flag(flags, "hold-start", false)
    const hold_end_ms = get_float_flag(flags, "hold-end", false)

    return {
        ...kinematics,
        ...(pointer ? { pointer } : {}),
        ...(hold_start_ms !== undefined ? { hold_start_ms } : {}),
        ...(hold_end_ms !== undefined ? { hold_end_ms } : {})
    }
}

function resolve_optional_target_from_cli(
    raw_target: string | undefined,
    flags: Map<string, string | boolean>
): TargetInput | undefined {
    if (raw_target !== undefined) {
        return build_target_from_cli([raw_target], flags)
    }
    if (get_string_flag(flags, "css") || get_string_flag(flags, "role")) {
        return build_target_from_cli([], flags)
    }
    if (get_string_flag(flags, "in")) {
        return apply_target_modifiers(parse_target_string(get_string_flag(flags, "in")!), {
            exact: get_boolean_flag(flags, "exact"),
            nth: get_number_flag(flags, "nth"),
            anchor: get_string_flag(flags, "at")
        })
    }
    if (get_string_flag(flags, "at")) {
        throw new Error("Flag --at requires a target element.")
    }
    return undefined
}

function build_target_from_cli(positionals: string[], flags: Map<string, string | boolean>): TargetInput {
    const raw_target = positionals.join(" ").trim()
    const modifiers: TargetModifiers = {
        scope: get_string_flag(flags, "in"),
        role: get_string_flag(flags, "role"),
        exact: get_boolean_flag(flags, "exact"),
        nth: get_number_flag(flags, "nth"),
        css: get_string_flag(flags, "css"),
        anchor: get_string_flag(flags, "at")
    }

    let base: TargetInput
    if (raw_target.length > 0) {
        base = parse_target_string(raw_target)
    } else if (modifiers.css) {
        base = { steps: [{ kind: "css", selector: modifiers.css }] }
    } else if (modifiers.role) {
        base = { steps: [{ kind: "role", role: modifiers.role.toLowerCase() }] }
    } else {
        throw new Error("Missing <target>. Pass a text, role:name, css:selector, or x,y coordinate.")
    }

    return apply_target_modifiers(base, modifiers)
}

function parse_long_press_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target: TargetInput; options: LongPressOptions } {
    const target = build_target_from_cli(positionals, flags)
    const pointer = parse_pointer_flag(flags)
    const duration_ms = get_float_flag(flags, "duration", true)

    return {
        target,
        options: {
            ...(pointer ? { pointer } : {}),
            ...(duration_ms !== undefined ? { duration_ms } : {}),
            scroll_into_view: !get_boolean_flag(flags, "no-scroll"),
            dry_run: get_boolean_flag(flags, "dry-run")
        }
    }
}

function parse_fill_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target: TargetInput; options: FillOptions } {
    const value_flag = get_string_flag(flags, "value")
    const clear = get_boolean_flag(flags, "clear")
    const append = get_boolean_flag(flags, "append")
    if (clear && (append || value_flag !== undefined)) {
        throw new Error("Cannot combine --clear with --append or --value.")
    }

    let target: TargetInput
    let value: string

    if (clear || value_flag !== undefined) {
        target = build_target_from_cli(positionals, flags)
        value = clear ? "" : value_flag!
    } else if (positionals.length === 2) {
        target = build_target_from_cli([positionals[0]], flags)
        value = positionals[1]
    } else if (positionals.length === 1 && (get_string_flag(flags, "css") || get_string_flag(flags, "role"))) {
        target = build_target_from_cli([], flags)
        value = positionals[0]
    } else {
        throw new Error(
            "Invalid fill arguments. Usage: fill <target> <value> [options], fill <target> --value <text>, or fill <target> --clear"
        )
    }

    return {
        target,
        options: {
            value,
            append,
            submit: get_boolean_flag(flags, "submit"),
            blur: get_boolean_flag(flags, "blur"),
            scroll_into_view: !get_boolean_flag(flags, "no-scroll"),
            dry_run: get_boolean_flag(flags, "dry-run")
        }
    }
}

function parse_press_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target?: TargetInput; options: PressOptions } {
    const key_flag = get_string_flag(flags, "key")
    let raw_target: string | undefined
    let key: string

    if (key_flag !== undefined) {
        key = key_flag
        raw_target = positionals.length > 0 ? positionals.join(" ") : undefined
    } else if (positionals.length === 1) {
        key = positionals[0]
    } else if (positionals.length === 2) {
        raw_target = positionals[0]
        key = positionals[1]
    } else {
        throw new Error(
            "Invalid press arguments. Usage: press [<target>] <key> [options] or press [<target>] --key <key>"
        )
    }

    if (key.length === 0) {
        throw new Error("Key cannot be empty.")
    }

    const target = resolve_optional_target_from_cli(raw_target, flags)
    const duration_ms = get_float_flag(flags, "duration", false)

    return {
        target,
        options: {
            key,
            ...(duration_ms !== undefined ? { duration_ms } : {}),
            scroll_into_view: !get_boolean_flag(flags, "no-scroll"),
            dry_run: get_boolean_flag(flags, "dry-run")
        }
    }
}

function parse_select_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target: TargetInput; options: SelectOptions } {
    const value_flag = get_string_flag(flags, "value")
    const label_flag = get_string_flag(flags, "label")
    const index_flag = get_number_flag(flags, "index")
    const clear = get_boolean_flag(flags, "clear")

    const mode_count =
        (value_flag !== undefined ? 1 : 0) +
        (label_flag !== undefined ? 1 : 0) +
        (index_flag !== undefined ? 1 : 0) +
        (clear ? 1 : 0)
    if (mode_count > 1) {
        throw new Error("Combine at most one of --value, --label, --index, or --clear.")
    }

    const has_selector_flag = Boolean(get_string_flag(flags, "css") || get_string_flag(flags, "role"))
    let target: TargetInput
    let values: string[] | undefined
    let match_by: SelectOptionMatchBy | undefined

    if (mode_count === 1) {
        target = build_target_from_cli(positionals, flags)
        if (value_flag !== undefined) {
            values = [value_flag]
            match_by = "value"
        } else if (label_flag !== undefined) {
            values = [label_flag]
            match_by = "label"
        } else if (index_flag !== undefined) {
            match_by = "index"
        }
    } else if (has_selector_flag && positionals.length >= 1) {
        target = build_target_from_cli([], flags)
        values = positionals
    } else if (positionals.length >= 2) {
        target = build_target_from_cli([positionals[0]], flags)
        values = positionals.slice(1)
    } else {
        throw new Error(
            "Invalid select arguments. Usage: select <target> <value...> | --value <v> | --label <text> | --index <n> | --clear"
        )
    }

    return {
        target,
        options: {
            ...(values !== undefined ? { values } : {}),
            ...(match_by ? { match_by } : {}),
            ...(index_flag !== undefined ? { index: index_flag } : {}),
            ...(clear ? { clear } : {}),
            scroll_into_view: !get_boolean_flag(flags, "no-scroll"),
            dry_run: get_boolean_flag(flags, "dry-run")
        }
    }
}

function parse_hover_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target: TargetInput; options: HoverOptions } {
    const target = build_target_from_cli(positionals, flags)
    const from_raw = get_string_flag(flags, "from")
    const hold_ms = get_float_flag(flags, "hold", false)
    const leave = get_boolean_flag(flags, "leave")
    const kinematics = parse_kinematics_flags(flags, true)

    return {
        target,
        options: {
            ...(from_raw !== undefined ? { from: parse_target_string(from_raw) } : {}),
            ...(hold_ms !== undefined ? { hold_ms } : {}),
            ...(leave ? { leave: true } : {}),
            ...kinematics
        }
    }
}

function parse_swipe_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target?: TargetInput; options: SwipeOptions } {
    if (positionals.length === 0 || positionals.length > 3) {
        throw new Error("Invalid swipe arguments. Usage: swipe [<target>] <left|right|up|down> [distance] [options]")
    }

    let raw_target: string | undefined
    let direction: GestureDirection | null = null
    let distance: GestureDistance | undefined

    if (positionals.length === 1) {
        direction = parse_gesture_direction(positionals[0])
        if (!direction) {
            throw new Error(`Invalid swipe direction "${positionals[0]}". Expected left, right, up, or down.`)
        }
    } else if (positionals.length === 2) {
        const dir0 = parse_gesture_direction(positionals[0])
        const dist1 = parse_gesture_distance(positionals[1])
        if (dir0 && dist1) {
            direction = dir0
            distance = dist1
        } else {
            const dir1 = parse_gesture_direction(positionals[1])
            if (dir1) {
                raw_target = positionals[0]
                direction = dir1
            } else {
                throw new Error(
                    `Invalid swipe arguments "${positionals.join(" ")}". Expected [<target>] <direction> [distance].`
                )
            }
        }
    } else {
        raw_target = positionals[0]
        direction = parse_gesture_direction(positionals[1])
        const dist2 = parse_gesture_distance(positionals[2])
        if (!direction || !dist2) {
            throw new Error(
                `Invalid swipe arguments "${positionals.join(" ")}". Expected <target> <direction> <distance>.`
            )
        }
        distance = dist2
    }

    const target = resolve_optional_target_from_cli(raw_target, flags)

    const kinematics = parse_gesture_flags(flags)
    return {
        target,
        options: {
            direction,
            ...(distance ? { distance } : {}),
            ...kinematics
        }
    }
}

function parse_scroll_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target?: TargetInput; options: ScrollOptions } {
    const to_raw = get_string_flag(flags, "to")
    const by_raw = get_string_flag(flags, "by")
    const align_raw = get_string_flag(flags, "align")
    const wheel = get_boolean_flag(flags, "wheel")

    let align: ScrollAlign | undefined
    if (align_raw !== undefined) {
        align = parse_scroll_align(align_raw) ?? undefined
        if (!align) {
            throw new Error(`Invalid --align value: ${align_raw} (expected "start", "center", "end", or "nearest")`)
        }
    }

    let raw_target: string | undefined
    let direction: GestureDirection | undefined
    let distance: GestureDistance | undefined
    let to: ScrollEdge | TargetInput | undefined
    let by: { x: number; y: number } | undefined

    if (to_raw !== undefined || by_raw !== undefined) {
        if (to_raw !== undefined && by_raw !== undefined) {
            throw new Error("Scroll accepts only one of --to or --by.")
        }
        if (positionals.length > 1) {
            throw new Error(
                "Invalid scroll arguments. Place the target container locator in a single argument when using --to or --by."
            )
        }
        if (positionals.length === 1) {
            if (parse_gesture_direction(positionals[0]) || parse_scroll_edge(positionals[0])) {
                throw new Error(`Cannot combine positional "${positionals[0]}" with --to or --by.`)
            }
            raw_target = positionals[0]
        }

        if (to_raw !== undefined) {
            const trimmed = to_raw.trim()
            const maybe_edge = parse_scroll_edge(trimmed)
            if (maybe_edge && trimmed.toLowerCase() === maybe_edge) {
                to = maybe_edge
            } else {
                to = parse_target_string(trimmed)
            }
        } else if (by_raw !== undefined) {
            const parsed_by = parse_point_delta(by_raw)
            if (!parsed_by) {
                throw new Error(`Invalid --by value "${by_raw}". Expected dx,dy in pixels (e.g. "0,400" or "-120,0").`)
            }
            by = parsed_by
        }
    } else {
        if (positionals.length === 0 || positionals.length > 3) {
            throw new Error(
                "Invalid scroll arguments. Usage: scroll [<target>] (<left|right|up|down> [distance] | top | bottom | --to <target> | --by <dx,dy>)"
            )
        }

        if (positionals.length === 1) {
            const dir0 = parse_gesture_direction(positionals[0])
            const edge0 = parse_scroll_edge(positionals[0])
            if (dir0) {
                direction = dir0
            } else if (edge0 === "top" || edge0 === "bottom") {
                to = edge0
            } else {
                throw new Error(
                    `Invalid scroll direction or edge "${positionals[0]}". Expected up, down, left, right, top, or bottom (or use --to <target> / --by <dx,dy>).`
                )
            }
        } else if (positionals.length === 2) {
            const dir0 = parse_gesture_direction(positionals[0])
            const dist1 = parse_gesture_distance(positionals[1])
            if (dir0 && dist1) {
                direction = dir0
                distance = dist1
            } else {
                const dir1 = parse_gesture_direction(positionals[1])
                const edge1 = parse_scroll_edge(positionals[1])
                if (dir1) {
                    raw_target = positionals[0]
                    direction = dir1
                } else if (edge1 === "top" || edge1 === "bottom") {
                    raw_target = positionals[0]
                    to = edge1
                } else {
                    throw new Error(
                        `Invalid scroll arguments "${positionals.join(" ")}". Expected [<target>] <direction> [distance] or [<target>] <top|bottom>.`
                    )
                }
            }
        } else {
            raw_target = positionals[0]
            const dir1 = parse_gesture_direction(positionals[1])
            const dist2 = parse_gesture_distance(positionals[2])
            if (!dir1 || !dist2) {
                throw new Error(
                    `Invalid scroll arguments "${positionals.join(" ")}". Expected <target> <direction> <distance>.`
                )
            }
            direction = dir1
            distance = dist2
        }
    }

    if (align && (!to || typeof to === "string")) {
        throw new Error("Flag --align requires an element --to <target>.")
    }

    const target = resolve_optional_target_from_cli(raw_target, flags)
    const kinematics = parse_kinematics_flags(flags, true)

    return {
        target,
        options: {
            ...(direction ? { direction } : {}),
            ...(distance ? { distance } : {}),
            ...(to !== undefined ? { to } : {}),
            ...(by ? { by } : {}),
            ...(align ? { align } : {}),
            ...(wheel ? { wheel: true } : {}),
            ...kinematics
        }
    }
}

function parse_drag_command(
    positionals: string[],
    flags: Map<string, string | boolean>
): { target: TargetInput; options: DragOptions } {
    const target = build_target_from_cli(positionals, flags)
    const to_raw = get_string_flag(flags, "to")
    const by_raw = get_string_flag(flags, "by")

    if ((to_raw !== undefined) === (by_raw !== undefined)) {
        throw new Error("Drag requires exactly one of --to <target> or --by <dx,dy>.")
    }

    let to: TargetInput | undefined
    let by: { x: number; y: number } | undefined

    if (by_raw !== undefined) {
        const parsed_by = parse_point_delta(by_raw)
        if (!parsed_by) {
            throw new Error(`Invalid --by value "${by_raw}". Expected dx,dy in pixels (e.g. "180,0" or "-120,40").`)
        }
        by = parsed_by
    } else if (to_raw !== undefined) {
        const trimmed_to = to_raw.trim()
        if (trimmed_to.startsWith("@")) {
            if (target.point) {
                throw new Error(
                    `Shorthand --to "${trimmed_to}" requires an element source target, not viewport coordinates.`
                )
            }
            to = apply_target_modifiers({ steps: target.steps, nth: target.nth }, { anchor: trimmed_to })
        } else {
            to = parse_target_string(trimmed_to)
        }
    }

    const kinematics = parse_gesture_flags(flags)
    return {
        target,
        options: {
            ...(to ? { to } : {}),
            ...(by ? { by } : {}),
            ...kinematics
        }
    }
}

function format_logs_summary(logs: LogEntry[]): string[] {
    const error_count = logs.filter((l) => l.level === "error").length
    const warn_count = logs.filter((l) => l.level === "warn").length
    const lines = [`logs: ${error_count} errors, ${warn_count} warnings`]
    for (const entry of logs) {
        lines.push(`  [${entry.level}] ${entry.message}`)
    }
    return lines
}

function should_show_explicit_locator(node: SnapNode): boolean {
    if (!node.name) return true
    if (node.locator.startsWith("css:")) return true
    if (node.locator.includes(" >> ")) return true
    if (node.locator.includes("#")) return true
    if (node.locator.includes(":=")) return true
    return false
}

function render_snap_nodes(nodes: SnapNode[], indent_level: number, lines: string[]): void {
    const pad = "  ".repeat(indent_level)
    for (const node of nodes) {
        if (node.kind === "landmark" || node.kind === "container") {
            const label_part = node.name ? ` "${node.name}"` : ""
            const states_part = node.states.length > 0 ? ` [${node.states.join(", ")}]` : ""
            const locator_part =
                node.kind === "container" || should_show_explicit_locator(node) ? ` -> ${node.locator}` : ""
            lines.push(`${pad}[${node.role}${label_part}]${states_part}${locator_part}`)
            if (node.children && node.children.length > 0) {
                render_snap_nodes(node.children, indent_level + 1, lines)
            }
            continue
        }

        const name_part = node.name ? ` "${node.name}"` : ""
        const states_part = node.states.length > 0 ? ` [${node.states.join(", ")}]` : ""
        const coords_part = `@ ${node.center.x},${node.center.y} (${node.rect.w}x${node.rect.h})`
        const locator_part =
            node.kind === "interactive" && should_show_explicit_locator(node) ? ` -> ${node.locator}` : ""
        lines.push(`${pad}${node.role}${name_part}${states_part}${locator_part}  ${coords_part}`)

        if (node.children && node.children.length > 0) {
            render_snap_nodes(node.children, indent_level + 1, lines)
        }
    }
}

function print_error_result(res: ActionResult<unknown>): void {
    const err = res.error
    if (!err) {
        console.error("ERR Unknown error")
        return
    }
    console.error(`ERR [${err.code}] ${err.message}`)
    if (err.obscured_by) {
        console.error(`Covered by: ${err.obscured_by}`)
    }
    if (err.candidates && err.candidates.length > 0) {
        console.error("Candidates:")
        for (const c of err.candidates) {
            const name_part = c.name ? ` "${c.name}"` : ""
            const scope_part = c.scope ? ` (in ${c.scope})` : ""
            console.error(
                `  ${c.index}. ${c.locator} [${c.role}${name_part}]${scope_part} @ ${c.center.x},${c.center.y}`
            )
        }
        console.error('Hint: Scope with --in "<container>" or pick with --nth <index>.')
    }
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.error(log_line)
    }
}

function print_snap_result(res: ActionResult<SnapResult>): void {
    const data = res.data!
    const title = res.meta.title || "(untitled)"
    console.log(
        `Page: ${title} (${res.meta.viewport.width}x${res.meta.viewport.height}) | scroll: ${res.meta.scroll.x},${res.meta.scroll.y} | interactive: ${data.total_interactive}`
    )
    if (data.has_inert_overlay) {
        console.log("Notice: Page currently has [inert] subtree(s); only active layer is shown.")
    }
    if (data.nodes.length === 0) {
        console.log("(no visible interactive elements)")
    } else {
        const lines: string[] = []
        render_snap_nodes(data.nodes, 0, lines)
        for (const line of lines) {
            console.log(line)
        }
    }
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_find_result(res: ActionResult<FindResult>): void {
    const matches = res.data!.matches
    console.log(`Matches: ${matches.length}`)
    for (const m of matches) {
        const name_part = m.name ? ` "${m.name}"` : ""
        const states_part = m.states.length > 0 ? ` [${m.states.join(", ")}]` : ""
        const scope_part = m.scope ? ` (in ${m.scope})` : ""
        const vp_part = m.in_viewport ? "" : " [offscreen]"
        console.log(
            `  ${m.index}. ${m.locator}  (${m.role}${name_part})${states_part}${vp_part}${scope_part}  @ ${m.center.x},${m.center.y} (${m.rect.w}x${m.rect.h})`
        )
    }
}

function print_inspect_result(res: ActionResult<InspectResult>): void {
    const d = res.data!
    const name_part = d.name ? ` "${d.name}"` : ""
    console.log(`Target: ${d.role}${name_part} (<${d.tag}>)`)
    console.log(`Locator: ${d.locator}`)
    console.log(`CSS: ${d.css_selector}`)
    if (d.states.length > 0) {
        console.log(`States: ${d.states.join(", ")}`)
    }
    console.log(
        `Rect: x=${d.rect.x} y=${d.rect.y} w=${d.rect.w} h=${d.rect.h} | Center: (${d.center.x},${d.center.y}) | In viewport: ${d.in_viewport}`
    )
    console.log(
        `Hit test @(${d.center.x},${d.center.y}): ${d.hit_test.ok ? "PASS" : "OBSCURED"} (hit: ${d.hit_test.hit_element})`
    )
    console.log(
        `Styles: display=${d.styles.display} visibility=${d.styles.visibility} opacity=${d.styles.opacity} pointerEvents=${d.styles.pointer_events} cursor=${d.styles.cursor} touchAction=${d.styles.touch_action} overflow=${d.styles.overflow_x}/${d.styles.overflow_y}`
    )
    if (d.scroll.max_x > 0 || d.scroll.max_y > 0) {
        console.log(
            `Scroll: x=${d.scroll.x}/${d.scroll.max_x} y=${d.scroll.y}/${d.scroll.max_y} (client=${d.scroll.client_w}x${d.scroll.client_h}, content=${d.scroll.scroll_w}x${d.scroll.scroll_h})`
        )
    }
    console.log(`Listeners: ${d.listeners.length > 0 ? d.listeners.join(", ") : "(none direct)"}`)
    const attr_pairs = Object.entries(d.attributes).map(([k, v]) => `${k}="${v}"`)
    if (attr_pairs.length > 0) {
        console.log(`Attrs: ${attr_pairs.join(" ")}`)
    }
}

function print_tap_result(res: ActionResult<TapResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const name_part = d.target.name ? ` "${d.target.name}"` : ""
    console.log(
        `OK ${d.mode}${dry_tag} ${d.target.role}${name_part} @ (${d.point.x},${d.point.y}) [pointer=${d.pointer}, button=${d.button}, hit=${d.target.hit_element}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_long_press_result(res: ActionResult<LongPressResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const name_part = d.target.name ? ` "${d.target.name}"` : ""
    console.log(
        `OK long-press${dry_tag} ${d.target.role}${name_part} @ (${d.point.x},${d.point.y}) [duration=${d.actual_duration_ms}ms, requested=${d.requested_duration_ms}ms, pointer=${d.pointer}, hit=${d.target.hit_element}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_fill_result(res: ActionResult<FillResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const name_part = d.target.name ? ` "${d.target.name}"` : ""
    const extra_flags: string[] = []
    if (d.append) extra_flags.push("append")
    if (d.submitted) extra_flags.push("submit")
    if (d.blurred) extra_flags.push("blur")
    const extra_str = extra_flags.length > 0 ? `, ${extra_flags.join(", ")}` : ""
    console.log(
        `OK fill${dry_tag} ${d.target.role}${name_part} @ (${d.point.x},${d.point.y}) [${JSON.stringify(d.previous_value)} -> ${JSON.stringify(d.value)}${extra_str}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function format_key_combo_label(d: PressResult): string {
    const mods: string[] = []
    if (d.modifiers.ctrl) mods.push("Ctrl")
    if (d.modifiers.alt) mods.push("Alt")
    if (d.modifiers.shift) mods.push("Shift")
    if (d.modifiers.meta) mods.push("Meta")
    const base = d.key === " " ? "Space" : d.key
    return [...mods, base].join("+")
}

function print_press_result(res: ActionResult<PressResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const name_part = d.target.name ? ` "${d.target.name}"` : ""
    const extra: string[] = [`code=${d.code || "(none)"}`, `prevented=${d.default_prevented}`]
    if (d.duration_ms > 0) extra.push(`duration=${d.duration_ms}ms`)
    console.log(
        `OK press${dry_tag} ${format_key_combo_label(d)} on ${d.target.role}${name_part} [${extra.join(", ")}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_select_result(res: ActionResult<SelectResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const name_part = d.target.name ? ` "${d.target.name}"` : ""
    const prev_str =
        d.previous_values.length <= 1 ? JSON.stringify(d.previous_values[0] ?? "") : JSON.stringify(d.previous_values)
    const next_str = d.values.length <= 1 ? JSON.stringify(d.values[0] ?? "") : JSON.stringify(d.values)
    const opts_info =
        d.selected_options && d.selected_options.length > 0
            ? `, options=${d.selected_options.map((o) => `#${o.index}:${JSON.stringify(o.label)}`).join("+")}`
            : ""
    console.log(
        `OK select${dry_tag} [${d.control_kind}] ${d.target.role}${name_part} @ (${d.point.x},${d.point.y}) [${prev_str} -> ${next_str}, changed=${d.changed}${opts_info}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_hover_result(res: ActionResult<HoverResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const name_part = d.target.name ? ` "${d.target.name}"` : ""
    const from_desc = d.from_target
        ? `${d.from_target.role}${d.from_target.name ? ` "${d.from_target.name}"` : ""} -> `
        : ""
    const coords =
        d.from.x === d.to.x && d.from.y === d.to.y
            ? `(${d.to.x},${d.to.y})`
            : `(${d.from.x},${d.from.y}) -> (${d.to.x},${d.to.y})`
    const extra: string[] = [
        `dist=${d.distance_px}px`,
        `duration=${d.actual_duration_ms}ms`,
        `frames=${d.frames}`,
        `curve=${d.curve}`
    ]
    if (d.hold_ms > 0) extra.push(`hold=${d.hold_ms}ms`)
    if (d.left) extra.push("leave")

    console.log(
        `OK hover${dry_tag} ${from_desc}${d.target.role}${name_part} @ ${coords} [${extra.join(", ")}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_gesture_result(res: ActionResult<GestureResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const target_desc =
        d.target.role === "viewport" ? "viewport" : `${d.target.role}${d.target.name ? ` "${d.target.name}"` : ""}`
    const dest_desc = d.to_target ? ` -> ${d.to_target.role}${d.to_target.name ? ` "${d.to_target.name}"` : ""}` : ""
    const subject = d.direction
        ? d.target.role === "viewport"
            ? d.direction
            : `${d.direction} on ${target_desc}`
        : `${target_desc}${dest_desc}`

    const hold_parts: string[] = []
    if (d.hold_start_ms > 0) hold_parts.push(`hold_start=${d.hold_start_ms}ms`)
    if (d.hold_end_ms > 0) hold_parts.push(`hold_end=${d.hold_end_ms}ms`)
    const hold_str = hold_parts.length > 0 ? `, ${hold_parts.join(", ")}` : ""

    console.log(
        `OK ${d.mode}${dry_tag} ${subject} @ (${d.from.x},${d.from.y}) -> (${d.to.x},${d.to.y}) [dx=${d.delta.x}, dy=${d.delta.y}, dist=${d.distance_px}px, duration=${d.actual_duration_ms}ms, frames=${d.frames}, peak_v=${d.peak_velocity.toFixed(2)}px/ms, end_v=${d.end_velocity.toFixed(2)}px/ms, curve=${d.curve}${hold_str}, pointer=${d.pointer}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_scroll_result(res: ActionResult<ScrollResult>): void {
    const d = res.data!
    const dry_tag = d.dry_run ? " [dry-run]" : ""
    const target_desc =
        d.target.role === "viewport" ? "viewport" : `${d.target.role}${d.target.name ? ` "${d.target.name}"` : ""}`
    const dest_desc = d.to_target ? ` -> ${d.to_target.role}${d.to_target.name ? ` "${d.to_target.name}"` : ""}` : ""
    const subject = d.direction
        ? d.target.role === "viewport"
            ? d.direction
            : `${d.direction} on ${target_desc}`
        : d.edge
          ? d.target.role === "viewport"
              ? d.edge
              : `${d.edge} on ${target_desc}`
          : `${target_desc}${dest_desc}`

    const edges: string[] = []
    if (d.max.y > 0) {
        if (d.at_edge.top) edges.push("top")
        if (d.at_edge.bottom) edges.push("bottom")
    }
    if (d.max.x > 0) {
        if (d.at_edge.left) edges.push("left")
        if (d.at_edge.right) edges.push("right")
    }
    const edge_str = edges.length > 0 ? edges.join(",") : "none"

    const extra_parts: string[] = []
    if (d.instant) extra_parts.push("instant")
    if (d.wheel) extra_parts.push("via=wheel")
    const extra_str = extra_parts.length > 0 ? `, ${extra_parts.join(", ")}` : ""

    console.log(
        `OK scroll${dry_tag} ${subject} @ (${d.before.x},${d.before.y}) -> (${d.after.x},${d.after.y}) [dx=${d.actual_delta.x}, dy=${d.actual_delta.y}, dist=${d.distance_px}px, max=${d.max.x},${d.max.y}, edge=${edge_str}, duration=${d.actual_duration_ms}ms, frames=${d.frames}, curve=${d.curve}${extra_str}] (${res.meta.duration_ms}ms)`
    )
    for (const log_line of format_logs_summary(res.meta.logs)) {
        console.log(log_line)
    }
}

function print_help(): void {
    console.log(`Usage:
  npm run debug:ui -- snap [--all] [--text] [--in <scope>] [--depth <n>] [--json]
  npm run debug:ui -- find <target> [--all] [--hidden] [--in <scope>] [--role <role>] [--exact] [--json]
  npm run debug:ui -- inspect <target> [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--json]
  npm run debug:ui -- tap <target> [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--at <anchor>] [--dry-run] [--json]
  npm run debug:ui -- click <target> [--button left|right] [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--at <anchor>] [--dry-run] [--json]
  npm run debug:ui -- long-press <target> [--duration <ms>] [--pointer touch|mouse] [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--at <anchor>] [--no-scroll] [--dry-run] [--json]
  npm run debug:ui -- fill <target> (<text> | --value <text> | --clear) [--append] [--submit] [--blur] [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--no-scroll] [--dry-run] [--json]
  npm run debug:ui -- press [<target>] (<key> | --key <key>) [--duration <ms>] [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--no-scroll] [--dry-run] [--json]
  npm run debug:ui -- select <target> (<value...> | --value <v> | --label <text> | --index <1-based> | --clear) [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--no-scroll] [--dry-run] [--json]
  npm run debug:ui -- hover <target> [--from <target>] [--speed fast|normal|slow | --duration <ms> | --velocity <px/ms> | --instant] [--curve linear|ease-in|ease-out|ease-in-out] [--hold <ms>] [--leave] [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--at <anchor>] [--no-scroll] [--dry-run] [--json]
  npm run debug:ui -- swipe [<target>] <left|right|up|down> [distance] [--speed fast|normal|slow | --duration <ms> | --velocity <px/ms>] [--curve linear|ease-in|ease-out|ease-in-out] [--hold-end <ms>] [--pointer touch|mouse] [--dry-run] [--json]
  npm run debug:ui -- drag <from> (--to <target> | --by <dx,dy>) [--speed fast|normal|slow | --duration <ms> | --velocity <px/ms>] [--curve linear|ease-in|ease-out|ease-in-out] [--hold-start <ms>] [--hold-end <ms>] [--pointer mouse|touch] [--dry-run] [--json]
  npm run debug:ui -- scroll [<target>] (<left|right|up|down> [distance] | top | bottom | --to <top|bottom|left|right|target> | --by <dx,dy>) [--align start|center|end|nearest] [--speed fast|normal|slow | --duration <ms> | --velocity <px/ms> | --instant] [--curve linear|ease-in|ease-out|ease-in-out] [--wheel] [--no-scroll] [--dry-run] [--json]

Target syntax examples:
  "Player"                       Exact or unambiguous substring text match
  ="Play"                        Force exact match
  button:"Player"                Role + name match
  "Jazz Classics" >> "Play"      Scoped match inside container
  nav >> button#3                3rd button inside nav (1-based)
  css:.my-btn                    Explicit CSS selector
  210,784  |  50%,80%            Direct viewport coordinates (px or %)
  "Player"@80%,50%               Relative point inside element

Gesture & input examples:
  npm run debug:ui -- long-press "clickable#1"
  npm run debug:ui -- long-press "clickable#1" --duration 800 --pointer touch
  npm run debug:ui -- fill "textbox#1" "hello" --submit
  npm run debug:ui -- fill "textbox#1" --clear
  npm run debug:ui -- press Escape
  npm run debug:ui -- press "textbox#1" Enter
  npm run debug:ui -- press Space
  npm run debug:ui -- select "select#1" "zh-CN"
  npm run debug:ui -- select "select#1" --label "English"
  npm run debug:ui -- select "checkbox#1" toggle
  npm run debug:ui -- select "css:input[type=datetime-local]" "2026-11-16T22:30"
  npm run debug:ui -- hover "clickable#1"
  npm run debug:ui -- hover "clickable#2" --from "clickable#1" --speed fast --leave
  npm run debug:ui -- swipe left
  npm run debug:ui -- swipe "swipeable#1" right 240 --speed fast
  npm run debug:ui -- swipe left 40 --velocity 0.35 --curve ease-in
  npm run debug:ui -- drag "clickable#1@10%,50%" --to "@80%,50%"
  npm run debug:ui -- drag "clickable#1@50%,50%" --by "180,0" --hold-end 120
  npm run debug:ui -- scroll down
  npm run debug:ui -- scroll down 80% --speed fast
  npm run debug:ui -- scroll "scrollable#1" right 240
  npm run debug:ui -- scroll bottom --instant
  npm run debug:ui -- scroll --to "Footer" --align center`)
}

async function run_command_in_browser(command: DebugUiCommand): Promise<ActionResult<unknown>> {
    const port = read_debug_port()
    const payload = JSON.stringify(command)
    const code = `(() => {
        if (!window.__debug_ui__) {
            throw new Error("Debug UI runtime is not loaded in the active browser tab. Reload the page and retry.")
        }
        return window.__debug_ui__.exec(${payload})
    })()`
    return evaluate_in_browser<ActionResult<unknown>>(port, code)
}

async function main(): Promise<void> {
    const { command, positionals, flags } = parse_cli_args(process.argv.slice(2))
    if (command === "help" || get_boolean_flag(flags, "help")) {
        print_help()
        return
    }

    const as_json = get_boolean_flag(flags, "json")
    let rpc_command: DebugUiCommand

    if (command === "snap" || command === "snapshot") {
        const scope_flag = get_string_flag(flags, "in")
        const snap_opts: SnapOptions = {
            all: get_boolean_flag(flags, "all"),
            include_text: get_boolean_flag(flags, "text"),
            max_depth: get_number_flag(flags, "depth"),
            ...(scope_flag ? { scope: parse_target_string(scope_flag) } : {})
        }
        rpc_command = { action: "snap", options: snap_opts }
    } else if (command === "find") {
        const target = build_target_from_cli(positionals, flags)
        const find_opts: FindOptions = {
            all: get_boolean_flag(flags, "all"),
            include_hidden: get_boolean_flag(flags, "hidden")
        }
        rpc_command = { action: "find", target, options: find_opts }
    } else if (command === "inspect") {
        const target = build_target_from_cli(positionals, flags)
        rpc_command = { action: "inspect", target }
    } else if (command === "tap" || command === "click") {
        const target = build_target_from_cli(positionals, flags)
        const pointer = parse_pointer_flag(flags)
        const button_raw = get_string_flag(flags, "button")
        let button: TapOptions["button"]
        if (button_raw !== undefined) {
            if (button_raw !== "left" && button_raw !== "right") {
                throw new Error(`Invalid --button value: ${button_raw} (expected "left" or "right")`)
            }
            button = button_raw
        }
        const tap_opts: TapOptions = {
            ...(pointer ? { pointer } : {}),
            ...(button ? { button } : {}),
            scroll_into_view: !get_boolean_flag(flags, "no-scroll"),
            dry_run: get_boolean_flag(flags, "dry-run")
        }
        rpc_command = {
            action: command === "tap" ? "tap" : "click",
            target,
            options: tap_opts
        }
    } else if (command === "long-press" || command === "long_press") {
        const parsed = parse_long_press_command(positionals, flags)
        rpc_command = {
            action: "long_press",
            target: parsed.target,
            options: parsed.options
        }
    } else if (command === "fill") {
        const parsed = parse_fill_command(positionals, flags)
        rpc_command = {
            action: "fill",
            target: parsed.target,
            options: parsed.options
        }
    } else if (command === "press") {
        const parsed = parse_press_command(positionals, flags)
        rpc_command = {
            action: "press",
            ...(parsed.target ? { target: parsed.target } : {}),
            options: parsed.options
        }
    } else if (command === "select") {
        const parsed = parse_select_command(positionals, flags)
        rpc_command = {
            action: "select",
            target: parsed.target,
            options: parsed.options
        }
    } else if (command === "hover") {
        const parsed = parse_hover_command(positionals, flags)
        rpc_command = {
            action: "hover",
            target: parsed.target,
            options: parsed.options
        }
    } else if (command === "swipe") {
        const parsed = parse_swipe_command(positionals, flags)
        rpc_command = {
            action: "swipe",
            ...(parsed.target ? { target: parsed.target } : {}),
            options: parsed.options
        }
    } else if (command === "drag") {
        const parsed = parse_drag_command(positionals, flags)
        rpc_command = {
            action: "drag",
            target: parsed.target,
            options: parsed.options
        }
    } else if (command === "scroll") {
        const parsed = parse_scroll_command(positionals, flags)
        rpc_command = {
            action: "scroll",
            ...(parsed.target ? { target: parsed.target } : {}),
            options: parsed.options
        }
    } else {
        throw new Error(`Unknown command "${command}". Run with "help" to see usage.`)
    }

    const result = await run_command_in_browser(rpc_command)
    if (as_json) {
        console.log(JSON.stringify(result, null, 2))
        process.exit(result.ok ? 0 : 1)
    }

    if (!result.ok) {
        print_error_result(result)
        process.exit(1)
    }

    switch (rpc_command.action) {
        case "snap":
            print_snap_result(result as ActionResult<SnapResult>)
            break
        case "find":
            print_find_result(result as ActionResult<FindResult>)
            break
        case "inspect":
            print_inspect_result(result as ActionResult<InspectResult>)
            break
        case "tap":
        case "click":
            print_tap_result(result as ActionResult<TapResult>)
            break
        case "long_press":
            print_long_press_result(result as ActionResult<LongPressResult>)
            break
        case "fill":
            print_fill_result(result as ActionResult<FillResult>)
            break
        case "press":
            print_press_result(result as ActionResult<PressResult>)
            break
        case "select":
            print_select_result(result as ActionResult<SelectResult>)
            break
        case "hover":
            print_hover_result(result as ActionResult<HoverResult>)
            break
        case "swipe":
        case "drag":
            print_gesture_result(result as ActionResult<GestureResult>)
            break
        case "scroll":
            print_scroll_result(result as ActionResult<ScrollResult>)
            break
    }
}

main().catch((err) => {
    console.error(`ERR ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
})
