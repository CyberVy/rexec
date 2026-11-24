import type {
    ActionError,
    ActionMeta,
    ActionResult,
    DebugUiCommand,
    DebugUiRuntime,
    LogEntry,
    TargetInput
} from "../shared/protocol"
import { install_listener_registry } from "./listener_registry"
import { start_layout_sampler } from "./layout_sampler"
import { perform_press } from "./actions/keyboard"
import { perform_select } from "./actions/native_control"
import { perform_fill } from "./actions/text_input"
import { perform_hover } from "./gestures/hover"
import { perform_long_press } from "./gestures/long_press"
import { perform_tap_or_click } from "./gestures/pointer_tap"
import { perform_scroll } from "./gestures/scroll"
import { perform_drag, perform_swipe } from "./gestures/swipe_drag"
import { build_snapshot, find_targets, inspect_target } from "./dom/snapshot"

declare global {
    interface Window {
        __debug_bridge_initialized__?: boolean
        __debug_ui__?: DebugUiRuntime
    }
}

function format_log_args(args: unknown[]): string {
    return args
        .map((arg) => {
            if (arg instanceof Error || (arg && typeof arg === "object" && ("message" in arg || "name" in arg))) {
                const err_obj = arg as { name?: string; message?: string; stack?: string }
                return `${err_obj.name || "Error"}: ${err_obj.message || ""}${err_obj.stack ? `\n${err_obj.stack}` : ""}`
            }
            if (typeof arg === "object" && arg !== null) {
                try {
                    return JSON.stringify(arg, (_key, value) => {
                        if (value instanceof Error) {
                            return { name: value.name, message: value.message, stack: value.stack }
                        }
                        return value
                    })
                } catch {
                    return String(arg)
                }
            }
            return String(arg)
        })
        .join(" ")
}

function init_debug_bridge(): void {
    if (typeof window === "undefined") return
    if (window.__debug_bridge_initialized__) return
    window.__debug_bridge_initialized__ = true

    // 1. Install passive DOM listener registry before page scripts execute
    install_listener_registry()

    // 2. Hook console logs & global errors
    const active_log_sinks = new Set<(entry: LogEntry) => void>()
    const original_console = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
    }

    const send_log = (level: "debug" | "info" | "warn" | "error", args: unknown[]) => {
        const timestamp = Date.now()
        const message = format_log_args(args)

        if (level === "warn" || level === "error") {
            const entry: LogEntry = { level, message, timestamp }
            for (const sink of active_log_sinks) {
                sink(entry)
            }
        }

        fetch("/__debug/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                timestamp,
                level,
                message
            })
        }).catch(() => {})
    }

    console.debug = (...args: unknown[]) => {
        original_console.debug(...args)
        send_log("debug", args)
    }
    console.log = (...args: unknown[]) => {
        original_console.log(...args)
        send_log("info", args)
    }
    console.info = (...args: unknown[]) => {
        original_console.info(...args)
        send_log("info", args)
    }
    console.warn = (...args: unknown[]) => {
        original_console.warn(...args)
        send_log("warn", args)
    }
    console.error = (...args: unknown[]) => {
        original_console.error(...args)
        send_log("error", args)
    }

    window.addEventListener("error", (event) => {
        send_log("error", [`Uncaught Exception: ${event.message} at ${event.filename}:${event.lineno}`])
    })

    window.addEventListener("unhandledrejection", (event) => {
        send_log("error", [`Unhandled Promise Rejection: ${event.reason}`])
    })

    // 3. Mount framework-agnostic UI inspection & interaction runtime
    const run_with_meta = async <T>(
        fn: () =>
            | Promise<{ ok: true; data: T } | { ok: false; error: ActionError }>
            | ({ ok: true; data: T } | { ok: false; error: ActionError }),
        watch: (TargetInput | string)[] = []
    ): Promise<ActionResult<T>> => {
        const started_at = performance.now()
        const captured_logs: LogEntry[] = []
        const sink = (entry: LogEntry) => {
            captured_logs.push(entry)
        }
        active_log_sinks.add(sink)

        const layout_sampler = watch.length > 0 ? start_layout_sampler(watch) : null

        try {
            const outcome = layout_sampler && !layout_sampler.ok ? layout_sampler : await fn()
            const layout_trace = layout_sampler?.ok ? layout_sampler.sampler.stop() : undefined
            const meta: ActionMeta = {
                url: window.location.href,
                title: document.title,
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                },
                scroll: {
                    x: Math.round(window.scrollX),
                    y: Math.round(window.scrollY)
                },
                logs: captured_logs,
                duration_ms: Math.round(performance.now() - started_at),
                ...(layout_trace ? { layout_trace } : {})
            }
            if (outcome.ok) {
                return { ok: true, data: outcome.data, meta }
            }
            return { ok: false, error: outcome.error, meta }
        } finally {
            active_log_sinks.delete(sink)
            if (layout_sampler?.ok) layout_sampler.sampler.stop()
        }
    }

    const runtime: DebugUiRuntime = {
        exec: (command: DebugUiCommand) =>
            run_with_meta<unknown>(() => {
                switch (command.action) {
                    case "snap":
                        return build_snapshot(command.options)
                    case "find":
                        return find_targets(command.target, command.options)
                    case "inspect":
                        return inspect_target(command.target)
                    case "tap":
                        return perform_tap_or_click(command.target, "tap", command.options)
                    case "click":
                        return perform_tap_or_click(command.target, "click", command.options)
                    case "long_press":
                        return perform_long_press(command.target, command.options)
                    case "fill":
                        return perform_fill(command.target, command.options)
                    case "press":
                        return perform_press(command.target, command.options)
                    case "select":
                        return perform_select(command.target, command.options)
                    case "hover":
                        return perform_hover(command.target, command.options)
                    case "swipe":
                        return perform_swipe(command.target, command.options)
                    case "drag":
                        return perform_drag(command.target, command.options)
                    case "scroll":
                        return perform_scroll(command.target, command.options)
                }
            }, command.watch)
    }

    window.__debug_ui__ = runtime

    // 4. Set up SSE for Eval commands
    const init_event_source = () => {
        const event_source = new EventSource("/__debug/events")

        event_source.onmessage = async (event) => {
            try {
                const req = JSON.parse(event.data) as { id: string; code: string }
                let result: unknown
                let success = true
                try {
                    result = await (async () => {
                        return (0, eval)(req.code)
                    })()
                } catch (err) {
                    result = err instanceof Error ? err.toString() : String(err)
                    success = false
                }

                fetch("/__debug/respond", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: req.id,
                        success,
                        result
                    })
                }).catch(() => {})
            } catch (err) {
                original_console.error("Debug bridge failed to process event:", err)
            }
        }

        event_source.onerror = () => {
            event_source.close()
            window.setTimeout(init_event_source, 3000)
        }
    }

    init_event_source()
}

init_debug_bridge()
