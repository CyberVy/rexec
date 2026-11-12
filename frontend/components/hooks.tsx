import type { RefObject } from "react"
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react"
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
    const event_keys = Array.isArray(events) ? events : [events]
    const events_key = event_keys.slice().sort().join(",")

    const subscribe = useCallback(
        (on_store_change: () => void) => {
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
    const key_events = useMemo(() => controller.get_key_events(key), [controller, key])
    const events_key = key_events.slice().sort().join(",")

    const subscribe = useCallback(
        (on_store_change: () => void) => {
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
    const dispatch_func = (value: T | ((prev: T) => T)) => {
        if (typeof value !== "function") {
            set_state(value)
            state_ref.current = value
        } else {
            const f = value as (prev: T) => T
            const r = f(state_ref.current)
            set_state(r)
            state_ref.current = r
        }
    }
    return [state_ref, dispatch_func, state]
}

let is_hidden_during_rotation = false
const rotation_subscribers = new Set<() => void>()
let is_rotation_listener_initialized = false
let is_portrait = false

const subscribe_rotation = (callback: () => void) => {
    rotation_subscribers.add(callback)
    if (!is_rotation_listener_initialized) {
        is_rotation_listener_initialized = true
        if (typeof window !== "undefined" && typeof document !== "undefined" && is_ios_device()) {
            is_portrait = document.documentElement.clientHeight > document.documentElement.clientWidth
            window.addEventListener("resize", () => {
                const is_portrait_after = document.documentElement.clientHeight > document.documentElement.clientWidth
                if (is_portrait === is_portrait_after) return
                is_portrait = is_portrait_after
                is_hidden_during_rotation = true
                for (const sub of rotation_subscribers) sub()
                setTimeout(() => {
                    is_hidden_during_rotation = false
                    for (const sub of rotation_subscribers) sub()
                }, 200)
            })
        }
    }
    return () => {
        rotation_subscribers.delete(callback)
    }
}

const get_rotation_snapshot = () => is_hidden_during_rotation

// beta feature: screen rotation in iOS Safari may cause a crash when document height is large
export function useOptimizedRotation(): boolean {
    return useSyncExternalStore(subscribe_rotation, get_rotation_snapshot, () => false)
}
