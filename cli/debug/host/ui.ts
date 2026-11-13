import {
    apply_target_modifiers,
    parse_gesture_direction,
    parse_gesture_distance,
    parse_point_delta,
    parse_target_string,
    type ActionResult,
    type DebugUiCommand,
    type DragOptions,
    type FindOptions,
    type FindResult,
    type GestureCurve,
    type GestureDirection,
    type GestureDistance,
    type GestureResult,
    type GestureSpeed,
    type InspectResult,
    type LogEntry,
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
    "hold-end"
])

const VALID_SPEEDS = new Set<GestureSpeed>(["fast", "normal", "slow"])
const VALID_CURVES = new Set<GestureCurve>(["linear", "ease-in", "ease-out", "ease-in-out"])

function parse_cli_args(argv: string[]): ParsedCliArgs {
    const command = argv[0] || "help"
    const positionals: string[] = []
    const flags = new Map<string, string | boolean>()

    for (let i = 1; i < argv.length; i += 1) {
        const arg = argv[i]
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
    const timing_count = [speed, duration_ms, velocity].filter((v) => v !== undefined).length
    if (timing_count > 1) {
        throw new Error("Flags --speed, --duration, and --velocity are mutually exclusive.")
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

    const pointer = parse_pointer_flag(flags)
    const hold_start_ms = get_float_flag(flags, "hold-start", false)
    const hold_end_ms = get_float_flag(flags, "hold-end", false)

    return {
        ...(speed ? { speed } : {}),
        ...(duration_ms !== undefined ? { duration_ms } : {}),
        ...(velocity !== undefined ? { velocity } : {}),
        ...(curve ? { curve } : {}),
        ...(pointer ? { pointer } : {}),
        ...(hold_start_ms !== undefined ? { hold_start_ms } : {}),
        ...(hold_end_ms !== undefined ? { hold_end_ms } : {}),
        scroll_into_view: !get_boolean_flag(flags, "no-scroll"),
        dry_run: get_boolean_flag(flags, "dry-run")
    }
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

    let target: TargetInput | undefined
    if (raw_target !== undefined) {
        target = build_target_from_cli([raw_target], flags)
    } else if (get_string_flag(flags, "css") || get_string_flag(flags, "role")) {
        target = build_target_from_cli([], flags)
    } else if (get_string_flag(flags, "in")) {
        target = apply_target_modifiers(parse_target_string(get_string_flag(flags, "in")!), {
            exact: get_boolean_flag(flags, "exact"),
            nth: get_number_flag(flags, "nth"),
            anchor: get_string_flag(flags, "at")
        })
    } else if (get_string_flag(flags, "at")) {
        throw new Error("Flag --at requires a target element.")
    }

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
        `Styles: display=${d.styles.display} visibility=${d.styles.visibility} opacity=${d.styles.opacity} pointerEvents=${d.styles.pointer_events} cursor=${d.styles.cursor} touchAction=${d.styles.touch_action}`
    )
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

function print_help(): void {
    console.log(`Usage:
  npm run debug:ui -- snap [--all] [--text] [--in <scope>] [--depth <n>] [--json]
  npm run debug:ui -- find <target> [--all] [--hidden] [--in <scope>] [--role <role>] [--exact] [--json]
  npm run debug:ui -- inspect <target> [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--json]
  npm run debug:ui -- tap <target> [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--at <anchor>] [--dry-run] [--json]
  npm run debug:ui -- click <target> [--button left|right] [--in <scope>] [--role <role>] [--exact] [--nth <n>] [--at <anchor>] [--dry-run] [--json]
  npm run debug:ui -- swipe [<target>] <left|right|up|down> [distance] [--speed fast|normal|slow | --duration <ms> | --velocity <px/ms>] [--curve linear|ease-in|ease-out|ease-in-out] [--hold-end <ms>] [--pointer touch|mouse] [--dry-run] [--json]
  npm run debug:ui -- drag <from> (--to <target> | --by <dx,dy>) [--speed fast|normal|slow | --duration <ms> | --velocity <px/ms>] [--curve linear|ease-in|ease-out|ease-in-out] [--hold-start <ms>] [--hold-end <ms>] [--pointer mouse|touch] [--dry-run] [--json]

Target syntax examples:
  "Player"                       Exact or unambiguous substring text match
  ="Play"                        Force exact match
  button:"Player"                Role + name match
  "Jazz Classics" >> "Play"      Scoped match inside container
  nav >> button#3                3rd button inside nav (1-based)
  css:.my-btn                    Explicit CSS selector
  210,784  |  50%,80%            Direct viewport coordinates (px or %)
  "Player"@80%,50%               Relative point inside element

Gesture examples:
  npm run debug:ui -- swipe left
  npm run debug:ui -- swipe "swipeable#1" right 240 --speed fast
  npm run debug:ui -- swipe left 40 --velocity 0.35 --curve ease-in
  npm run debug:ui -- drag "clickable#1@10%,50%" --to "@80%,50%"
  npm run debug:ui -- drag "clickable#1@50%,50%" --by "180,0" --hold-end 120`)
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
        case "swipe":
        case "drag":
            print_gesture_result(result as ActionResult<GestureResult>)
            break
    }
}

main().catch((err) => {
    console.error(`ERR ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
})
