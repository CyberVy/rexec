import type { ActionError, LayoutSample, LayoutTrace, RectBox, TargetInput } from "../shared/protocol"
import { resolve_target } from "./dom/locator"

const MAX_WATCH_TARGETS = 8
const INPUT_EVENT_TYPES = [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "touchstart",
    "touchmove",
    "touchend",
    "touchcancel",
    "wheel"
] as const

export interface LayoutSampler {
    /** Takes a final sample and returns the trace; later calls return the same trace. */
    stop: () => LayoutTrace
}

const round_px = (value: number) => Math.round(value * 100) / 100

/** Unlike `to_rect_box`, keeps sub-pixel precision so transform-driven motion stays visible. */
function read_rect(el: Element): RectBox | null {
    if (!el.isConnected) return null
    const rect = el.getBoundingClientRect()
    return { x: round_px(rect.left), y: round_px(rect.top), w: round_px(rect.width), h: round_px(rect.height) }
}

/** Resolves every watch target once, then samples their layout on each rendered frame until `stop()`. */
export function start_layout_sampler(
    watch: (TargetInput | string)[]
): { ok: true; sampler: LayoutSampler } | { ok: false; error: ActionError } {
    if (document.hidden) {
        return {
            ok: false,
            error: {
                code: "UNSUPPORTED",
                message:
                    "The page is hidden, so requestAnimationFrame is paused and per-frame layout sampling is impossible. Bring the window to the foreground and retry."
            }
        }
    }
    if (watch.length > MAX_WATCH_TARGETS) {
        return {
            ok: false,
            error: {
                code: "INVALID_OPTIONS",
                message: `At most ${MAX_WATCH_TARGETS} watch targets are supported (got ${watch.length}).`
            }
        }
    }

    const targets: LayoutTrace["targets"] = []
    const elements: Element[] = []
    for (const raw_target of watch) {
        const resolved = resolve_target(raw_target)
        if (!resolved.ok) {
            return { ok: false, error: resolved.error }
        }
        const { kind, el, role, name, locator } = resolved.target
        if (kind !== "element" || !el) {
            return {
                ok: false,
                error: {
                    code: "INVALID_TARGET",
                    message: "Watch targets must resolve to an element, not a viewport point."
                }
            }
        }
        targets.push({ role, name, locator })
        elements.push(el)
    }

    const started_at = performance.now()
    const samples: LayoutSample[] = []
    let input_start: number | null = null
    let input_end = 0
    let trace: LayoutTrace | null = null
    let frame_id = 0

    const elapsed_ms = () => Math.round((performance.now() - started_at) * 10) / 10
    const take_sample = () => {
        samples.push({ t: elapsed_ms(), rects: elements.map(read_rect) })
    }
    const note_input = () => {
        input_end = elapsed_ms()
        input_start ??= input_end
    }
    const sample_frame = () => {
        take_sample()
        frame_id = window.requestAnimationFrame(sample_frame)
    }

    for (const type of INPUT_EVENT_TYPES) {
        window.addEventListener(type, note_input, { capture: true, passive: true })
    }
    take_sample()
    frame_id = window.requestAnimationFrame(sample_frame)

    const stop = (): LayoutTrace => {
        if (trace) return trace
        window.cancelAnimationFrame(frame_id)
        for (const type of INPUT_EVENT_TYPES) {
            window.removeEventListener(type, note_input, { capture: true })
        }
        take_sample()
        trace = {
            targets,
            duration_ms: elapsed_ms(),
            input_span_ms: input_start === null ? null : { start: input_start, end: input_end },
            samples
        }
        return trace
    }

    return { ok: true, sampler: { stop } }
}
