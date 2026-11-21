import type { Ref, RefCallback, RefObject } from "react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { BaseController, BaseKeyedController } from "@/infra"
import { is_ios_device } from "@/infra/device.client"

export interface UseControllerOptions<State, Selected = State> {
    events: string | string[]
    selector?: (state: State) => Selected
    server_snapshot?: Selected | (() => Selected)
}

export function useController<State, Selected = State>(
    controller: BaseController<State, any>,
    options: UseControllerOptions<State, Selected>
): Selected {
    const { events, selector, server_snapshot } = options
    const events_key = (Array.isArray(events) ? events : [events]).slice().sort().join(",")

    const subscribe = useCallback(
        (on_store_change: () => void) => {
            const event_keys = events_key ? events_key.split(",") : []
            const handler = () => on_store_change()
            for (const evt of event_keys) {
                controller.addEventListener(evt, handler)
            }
            return () => {
                for (const evt of event_keys) {
                    controller.removeEventListener(evt, handler)
                }
            }
        },
        [controller, events_key]
    )

    const get_snapshot = useCallback(() => {
        const st = controller.state
        return selector ? selector(st) : (st as unknown as Selected)
    }, [controller, selector])

    const get_server_snapshot = useCallback(() => {
        if (server_snapshot !== undefined) {
            return typeof server_snapshot === "function" ? (server_snapshot as () => Selected)() : server_snapshot
        }
        const st = controller.state
        return selector ? selector(st) : (st as unknown as Selected)
    }, [controller, selector, server_snapshot])

    return useSyncExternalStore(subscribe, get_snapshot, get_server_snapshot)
}

export function useKeyedController<Key extends string | number, Value>(
    controller: BaseKeyedController<Key, any, any>,
    key: Key,
    default_value: Value
): Value {
    const events_key = controller.get_key_events(key).slice().sort().join(",")

    const subscribe = useCallback(
        (on_store_change: () => void) => {
            const key_events = events_key ? events_key.split(",") : []
            const handler = () => on_store_change()
            for (const evt of key_events) {
                controller.addEventListener(evt, handler)
            }
            return () => {
                for (const evt of key_events) {
                    controller.removeEventListener(evt, handler)
                }
            }
        },
        [controller, events_key]
    )

    const get_snapshot = useCallback(() => {
        return controller.get_value(key, default_value)
    }, [controller, key, default_value])

    const get_server_snapshot = useCallback(() => {
        return default_value
    }, [default_value])

    return useSyncExternalStore(subscribe, get_snapshot, get_server_snapshot)
}

export function useMediaQuery(query: string, initial_value = false): boolean {
    const subscribe = useCallback(
        (callback: () => void) => {
            if (typeof window === "undefined") return () => {}
            const media = window.matchMedia(query)
            media.addEventListener("change", callback)
            return () => media.removeEventListener("change", callback)
        },
        [query]
    )

    const get_snapshot = useCallback(() => {
        if (typeof window === "undefined") return initial_value
        return window.matchMedia(query).matches
    }, [query, initial_value])

    const get_server_snapshot = useCallback(() => initial_value, [initial_value])

    return useSyncExternalStore(subscribe, get_snapshot, get_server_snapshot)
}

// create an auto sync state and ref object
export function useAutoSyncRefAndState<T>(value: T): [RefObject<T>, (value: T | ((prev: T) => T)) => void, T] {
    const [state, set_state] = useState(value)
    const state_ref = useRef(value)
    const dispatch_func = useCallback((next_value: T | ((prev: T) => T)) => {
        if (typeof next_value !== "function") {
            state_ref.current = next_value
            set_state(next_value)
        } else {
            const updater = next_value as (prev: T) => T
            const next_result = updater(state_ref.current)
            state_ref.current = next_result
            set_state(next_result)
        }
    }, [])
    return [state_ref, dispatch_func, state]
}

let is_hidden_during_rotation = false
const rotation_subscribers = new Set<() => void>()
let rotation_timer: ReturnType<typeof setTimeout> | null = null
let handle_rotation_resize: (() => void) | null = null
let is_portrait = false

const subscribe_rotation = (callback: () => void) => {
    rotation_subscribers.add(callback)
    if (
        !handle_rotation_resize &&
        typeof window !== "undefined" &&
        typeof document !== "undefined" &&
        is_ios_device()
    ) {
        is_portrait = document.documentElement.clientHeight > document.documentElement.clientWidth
        handle_rotation_resize = () => {
            const is_portrait_after = document.documentElement.clientHeight > document.documentElement.clientWidth
            if (is_portrait === is_portrait_after) return
            is_portrait = is_portrait_after
            if (rotation_timer !== null) {
                clearTimeout(rotation_timer)
            }
            if (!is_hidden_during_rotation) {
                is_hidden_during_rotation = true
                for (const sub of rotation_subscribers) sub()
            }
            rotation_timer = setTimeout(() => {
                rotation_timer = null
                is_hidden_during_rotation = false
                for (const sub of rotation_subscribers) sub()
            }, 200)
        }
        window.addEventListener("resize", handle_rotation_resize)
    }
    return () => {
        rotation_subscribers.delete(callback)
        if (rotation_subscribers.size === 0 && handle_rotation_resize) {
            window.removeEventListener("resize", handle_rotation_resize)
            handle_rotation_resize = null
            if (rotation_timer !== null) {
                clearTimeout(rotation_timer)
                rotation_timer = null
            }
            is_hidden_during_rotation = false
        }
    }
}

const get_rotation_snapshot = () => is_hidden_during_rotation

// beta feature: screen rotation in iOS Safari may cause a crash when document height is large
export function useOptimizedRotation(): boolean {
    return useSyncExternalStore(subscribe_rotation, get_rotation_snapshot, () => false)
}

function apply_ref_null<T>(target_ref: Ref<T> | undefined) {
    if (typeof target_ref === "function") {
        target_ref(null)
    } else if (target_ref) {
        target_ref.current = null
    }
}

function attach_ref_node<T>(target_ref: Ref<T> | undefined, node: T): () => void {
    if (typeof target_ref === "function") {
        const cleanup = target_ref(node)
        return typeof cleanup === "function" ? cleanup : () => target_ref(null)
    }
    if (target_ref) {
        target_ref.current = node
        return () => {
            target_ref.current = null
        }
    }
    return () => {}
}

export function useMergedRef<T>(ref_a: Ref<T> | undefined, ref_b: Ref<T> | undefined): RefCallback<T> {
    return useCallback(
        (node: T | null) => {
            if (!node) {
                apply_ref_null(ref_a)
                apply_ref_null(ref_b)
                return
            }

            const cleanup_a = attach_ref_node(ref_a, node)
            const cleanup_b = attach_ref_node(ref_b, node)
            return () => {
                cleanup_b()
                cleanup_a()
            }
        },
        [ref_a, ref_b]
    )
}

export function useEscapeKey(enabled: boolean, on_escape?: () => void): void {
    const on_escape_ref = useRef(on_escape)

    useLayoutEffect(() => {
        on_escape_ref.current = on_escape
    }, [on_escape])

    useEffect(() => {
        if (!enabled) return

        const handle_keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && on_escape_ref.current) {
                event.preventDefault()
                on_escape_ref.current()
            }
        }

        window.addEventListener("keydown", handle_keydown)
        return () => window.removeEventListener("keydown", handle_keydown)
    }, [enabled])
}
