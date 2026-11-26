"use client"

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react"
import { flushSync } from "react-dom"
import type { ReactNode } from "react"
import { useController, useMergedRef } from "../../hooks"
import { join_classes } from "../../utils"
import { INITIAL_VIEW_SWITCHER_STATE, resolve_host_status, view_switcher_controller } from "./ViewSwitcherController"
import { ViewSwitcherToolbarHost } from "./ViewSwitcherToolbar"
import { SwipeTransitionEngine, is_in_overscroll, resolve_remember_scroll } from "./swipe_transition_engine"
import type { SwitchViewEventDetail, ViewSwitcherProps } from "./types"
import styles from "./ViewSwitcher.module.css"

interface HostContextValue {
    switcher_id: string | null
    view_id: string | null
    is_toolbar_hidden: boolean
}

const ViewSwitcherHostContext = createContext<HostContextValue>({
    switcher_id: null,
    view_id: null,
    is_toolbar_hidden: false
})

const overscroll_disabled_switchers = new Set<string>()

function sync_root_overscroll(): void {
    if (typeof document === "undefined") return
    document.documentElement.style.overscrollBehaviorY = overscroll_disabled_switchers.size > 0 ? "none" : ""
}

function RootOverscrollLock({
    switcher_id,
    host_switcher_id,
    host_view_id,
    overscroll_enabled
}: {
    switcher_id: string
    host_switcher_id: string | null
    host_view_id: string | null
    overscroll_enabled: boolean
}) {
    const controller_state = useController(view_switcher_controller, {
        events: "change",
        server_snapshot: INITIAL_VIEW_SWITCHER_STATE
    })
    const { is_host_visible } = resolve_host_status(controller_state, host_switcher_id, host_view_id)
    const disabled = is_host_visible && !overscroll_enabled

    useEffect(() => {
        if (!disabled) return
        overscroll_disabled_switchers.add(switcher_id)
        sync_root_overscroll()
        return () => {
            overscroll_disabled_switchers.delete(switcher_id)
            sync_root_overscroll()
        }
    }, [switcher_id, disabled])

    return null
}

/**
 * Window-scroll ViewSwitcher with strict 6-step DOM swipe transitions.
 *
 * All swipe lifecycle mutations (fixed positioning, spacer sizing, containing block
 * compensation, GPU transform tracking, and static + scroll restoration) execute inside
 * SwipeTransitionEngine without re-rendering panel subtrees during gestures.
 */
export function ViewSwitcher<T extends string = string>({
    id,
    views,
    active_view_id,
    default_active_view_id,
    on_view_change_start,
    on_view_change,
    keep_alive_default = false,
    remember_scroll = true,
    className,
    toolbar_layout = "bottom-floating",
    toolbar_hidden = false,
    active_color,
    ref,
    ...props
}: ViewSwitcherProps<T>) {
    const fallback_id = useId()
    const switcher_instance_id = id ?? fallback_id
    const {
        switcher_id: host_switcher_id,
        view_id: host_view_id,
        is_toolbar_hidden: is_host_toolbar_hidden
    } = useContext(ViewSwitcherHostContext)

    const [internal_active_view_id, set_internal_active_view_id] = useState<T>(default_active_view_id ?? views[0]?.id)
    const [mounted_preview_ids, set_mounted_preview_ids] = useState<T[]>([])
    const current_active_view_id = active_view_id !== undefined ? active_view_id : internal_active_view_id

    const container_element_ref = useRef<HTMLDivElement | null>(null)
    const spacer_element_ref = useRef<HTMLDivElement | null>(null)
    const panel_elements_ref = useRef<Map<T, HTMLDivElement>>(new Map())
    const last_committed_view_id_ref = useRef<T>(current_active_view_id)
    const skip_next_layout_scroll_ref = useRef(false)
    const set_container_element_ref = useMergedRef(container_element_ref, ref)

    const active_view = views.find((view) => view.id === current_active_view_id)
    const active_overscroll_enabled = active_view?.overscroll_enabled ?? true
    const is_toolbar_suppressed = is_host_toolbar_hidden || toolbar_hidden

    const latest_props_ref = useRef({
        views,
        current_active_view_id,
        active_view_id,
        keep_alive_default,
        remember_scroll,
        on_view_change_start,
        on_view_change
    })

    useLayoutEffect(() => {
        latest_props_ref.current = {
            views,
            current_active_view_id,
            active_view_id,
            keep_alive_default,
            remember_scroll,
            on_view_change_start,
            on_view_change
        }
    })

    const engine_ref = useRef<SwipeTransitionEngine<T> | null>(null)

    const get_engine = useCallback((): SwipeTransitionEngine<T> => {
        if (!engine_ref.current) {
            engine_ref.current = new SwipeTransitionEngine<T>(switcher_instance_id, {
                get_snapshot: () => {
                    const latest = latest_props_ref.current
                    return {
                        views: latest.views,
                        active_view_id: latest.current_active_view_id,
                        keep_alive_default: latest.keep_alive_default,
                        remember_scroll_default: latest.remember_scroll,
                        container_el: container_element_ref.current,
                        spacer_el: spacer_element_ref.current,
                        get_panel_el: (view_id: T) => panel_elements_ref.current.get(view_id) ?? null
                    }
                },
                ensure_views_mounted: (view_ids: T[]) => {
                    flushSync(() => {
                        set_mounted_preview_ids(view_ids)
                    })
                },
                on_view_change_start: (view_id: T) => {
                    latest_props_ref.current.on_view_change_start?.(view_id)
                },
                on_transition_settled: (switched_view_id: T | null) => {
                    set_mounted_preview_ids((prev) => (prev.length === 0 ? prev : []))
                    if (switched_view_id !== null) {
                        // Step 6 already restored window.scrollY synchronously before React commits
                        skip_next_layout_scroll_ref.current = true
                        const latest = latest_props_ref.current
                        if (latest.active_view_id === undefined) {
                            latest.current_active_view_id = switched_view_id
                            set_internal_active_view_id(switched_view_id)
                        }
                        latest.on_view_change?.(switched_view_id)
                    }
                }
            })
        }
        return engine_ref.current
    }, [switcher_instance_id])

    // Bind gesture engine to container element and cleanly tear down on unmount
    useEffect(() => {
        const container_el = container_element_ref.current
        if (!container_el) return
        const engine = get_engine()
        engine.bind(container_el)
        return () => {
            engine.destroy()
            if (engine_ref.current === engine) {
                engine_ref.current = null
            }
        }
    }, [get_engine])

    // Register instance with global controller
    useLayoutEffect(() => {
        return view_switcher_controller.register({
            id: switcher_instance_id,
            parent_id: host_switcher_id,
            parent_view_id: host_view_id,
            active_view_id: latest_props_ref.current.current_active_view_id,
            preview_view_id: null,
            is_transitioning: false
        })
    }, [switcher_instance_id, host_switcher_id, host_view_id])

    // Sync active_view_id changes into controller
    useLayoutEffect(() => {
        view_switcher_controller.update_instance(switcher_instance_id, {
            parent_id: host_switcher_id,
            parent_view_id: host_view_id,
            active_view_id: current_active_view_id
        })
    }, [switcher_instance_id, host_switcher_id, host_view_id, current_active_view_id])

    // Restore target scroll once for non-swipe view changes (toolbar click, controller API, or controlled prop update).
    // Swipe transitions restore scroll synchronously in Step 6 and set skip_next_layout_scroll_ref.
    // Never triggers when a parent switcher toggles host visibility without changing this switcher's active_view_id.
    useLayoutEffect(() => {
        if (last_committed_view_id_ref.current === current_active_view_id) return
        last_committed_view_id_ref.current = current_active_view_id

        if (skip_next_layout_scroll_ref.current) {
            skip_next_layout_scroll_ref.current = false
            return
        }

        if (!view_switcher_controller.is_instance_host_visible(switcher_instance_id)) return

        const latest = latest_props_ref.current
        const target_view = latest.views.find((view) => view.id === current_active_view_id)
        if (!target_view) return

        const target_remember = resolve_remember_scroll(target_view, latest.keep_alive_default, latest.remember_scroll)
        const engine = get_engine()
        const target_scroll_y = engine.get_restore_scroll_y(target_view.id, target_remember)
        window.scrollTo(0, target_scroll_y)
        engine.begin_scroll_sync_barrier()
    }, [current_active_view_id, switcher_instance_id, get_engine])

    const switch_view_instant = useCallback(
        (target_view_id: T, block_on_overscroll: boolean): boolean => {
            const engine = get_engine()
            if (engine.is_busy() || view_switcher_controller.is_transition_locked()) return false
            if (block_on_overscroll && is_in_overscroll()) return false

            const latest = latest_props_ref.current
            if (target_view_id === latest.current_active_view_id) return false

            const target_view = latest.views.find((view) => view.id === target_view_id)
            if (!target_view) return false

            const is_host_visible = view_switcher_controller.is_instance_host_visible(switcher_instance_id)
            if (is_host_visible) {
                const current_view = latest.views.find((view) => view.id === latest.current_active_view_id)
                if (current_view) {
                    const current_remember = resolve_remember_scroll(
                        current_view,
                        latest.keep_alive_default,
                        latest.remember_scroll
                    )
                    engine.record_scroll(current_view.id, current_remember)
                }
            }

            latest.on_view_change_start?.(target_view.id)
            if (latest.active_view_id === undefined) {
                set_internal_active_view_id(target_view.id)
            }
            latest.on_view_change?.(target_view.id)
            return true
        },
        [get_engine, switcher_instance_id]
    )

    const handle_toolbar_select = useCallback(
        (view_id: T): boolean => switch_view_instant(view_id, true),
        [switch_view_instant]
    )

    // React to imperative switch_view events from controller
    useEffect(() => {
        const handle_switch = (event: Event) => {
            const custom_event = event as CustomEvent<SwitchViewEventDetail>
            if (!custom_event.detail || custom_event.detail.switcher_id !== switcher_instance_id) return
            switch_view_instant(custom_event.detail.view_id as T, false)
        }
        view_switcher_controller.addEventListener("switch_view", handle_switch)
        return () => {
            view_switcher_controller.removeEventListener("switch_view", handle_switch)
        }
    }, [switcher_instance_id, switch_view_instant])

    const set_panel_element = useCallback((view_id: T, element: HTMLDivElement | null) => {
        if (element) {
            panel_elements_ref.current.set(view_id, element)
        } else {
            panel_elements_ref.current.delete(view_id)
        }
    }, [])

    return (
        <div
            ref={set_container_element_ref}
            className={join_classes("w-full min-h-[calc(100vh-env(safe-area-inset-top))]", className)}
            {...props}
        >
            {views.map((view) => {
                const is_active = view.id === current_active_view_id
                const is_keep_alive = view.keep_alive ?? keep_alive_default
                const is_preview_mounted = mounted_preview_ids.includes(view.id)
                if (!is_active && !is_keep_alive && !is_preview_mounted) return null

                return (
                    <ViewSwitcherPanel
                        key={view.id}
                        switcher_id={switcher_instance_id}
                        view_id={view.id}
                        is_active={is_active}
                        is_toolbar_hidden={is_toolbar_suppressed}
                        on_element_ref={set_panel_element}
                    >
                        {view.content}
                    </ViewSwitcherPanel>
                )
            })}

            {/* Spacer held by SwipeTransitionEngine during Step 3-5 to prevent document height collapse */}
            <div ref={spacer_element_ref} className={styles.spacer} aria-hidden="true" />

            <RootOverscrollLock
                switcher_id={switcher_instance_id}
                host_switcher_id={host_switcher_id}
                host_view_id={host_view_id}
                overscroll_enabled={active_overscroll_enabled}
            />

            <ViewSwitcherToolbarHost
                switcher_id={switcher_instance_id}
                host_switcher_id={host_switcher_id}
                host_view_id={host_view_id}
                views={views}
                active_view_id={current_active_view_id}
                toolbar_layout={toolbar_layout}
                toolbar_suppressed={is_toolbar_suppressed}
                active_color={active_color}
                on_view_select={handle_toolbar_select}
            />
        </div>
    )
}

function ViewSwitcherPanel<T extends string>({
    switcher_id,
    view_id,
    is_active,
    is_toolbar_hidden,
    on_element_ref,
    children
}: {
    switcher_id: string
    view_id: T
    is_active: boolean
    is_toolbar_hidden: boolean
    on_element_ref: (view_id: T, el: HTMLDivElement | null) => void
    children: ReactNode
}) {
    const attach_panel_ref = useCallback(
        (el: HTMLDivElement | null) => {
            on_element_ref(view_id, el)
        },
        [on_element_ref, view_id]
    )

    const host_context = useMemo<HostContextValue>(
        () => ({
            switcher_id,
            view_id,
            is_toolbar_hidden
        }),
        [switcher_id, view_id, is_toolbar_hidden]
    )

    return (
        <ViewSwitcherHostContext value={host_context}>
            <div ref={attach_panel_ref} data-active={is_active ? "true" : "false"} className={styles.panel}>
                {children}
            </div>
        </ViewSwitcherHostContext>
    )
}
