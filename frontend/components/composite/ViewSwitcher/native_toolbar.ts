"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import type { ResolvedToolbarColor, ToolbarLayout, View } from "./types"

interface NativeToolbarItem {
    id: string
    label: string
    icon: string
}

interface NativeToolbarSync {
    type: "sync"
    switcher_id: string
    layout: ToolbarLayout
    visible: boolean
    animated: boolean
    interaction_enabled: boolean
    active_id: string
    active_color: ResolvedToolbarColor | null
    items: NativeToolbarItem[]
}

interface NativeToolbarRemove {
    type: "remove"
    switcher_id: string
    animated: boolean
}

interface NativeToolbarSelect {
    type: "select"
    switcher_id: string
    view_id: string
}

type NativeToolbarWindow = Window & {
    __VIEW_SWITCHER_NATIVE_TOOLBAR__?: boolean
    __view_switcher_native_toolbar_dispatch?: (message: NativeToolbarSelect) => void
    webkit?: {
        messageHandlers?: {
            viewSwitcherToolbar?: { postMessage: (body: NativeToolbarSync | NativeToolbarRemove) => void }
        }
    }
}

const select_handlers = new Map<string, (view_id: string) => void>()

function native_window(): NativeToolbarWindow | null {
    if (typeof window === "undefined") return null
    return window as NativeToolbarWindow
}

export function is_native_toolbar_active(): boolean {
    return native_window()?.__VIEW_SWITCHER_NATIVE_TOOLBAR__ === true
}

function ensure_dispatch(): void {
    const host = native_window()
    if (!host || host.__view_switcher_native_toolbar_dispatch) return
    host.__view_switcher_native_toolbar_dispatch = (message) => {
        if (!message || typeof message !== "object") return
        if (message.type === "select") {
            select_handlers.get(message.switcher_id)?.(message.view_id)
        }
    }
}

function post_toolbar_message(message: NativeToolbarSync | NativeToolbarRemove): void {
    native_window()?.webkit?.messageHandlers?.viewSwitcherToolbar?.postMessage(message)
}

export function useNativeToolbar<T extends string>({
    enabled,
    host_transitioning = false,
    switcher_id,
    layout,
    views,
    active_id,
    active_color,
    visible,
    interactive,
    on_select
}: {
    enabled: boolean
    host_transitioning?: boolean
    switcher_id: string
    layout: ToolbarLayout
    views: View<T>[]
    active_id: T
    active_color: ResolvedToolbarColor | null
    visible: boolean
    interactive: boolean
    on_select: (view_id: T) => boolean | void
}): void {
    const on_select_ref = useRef(on_select)
    const snapshot_ref = useRef("")
    const latest_sync_ref = useRef<NativeToolbarSync | null>(null)
    const was_enabled_ref = useRef(false)
    const latest_host_transitioning_ref = useRef(host_transitioning)
    const prev_host_transitioning_ref = useRef(host_transitioning)

    useEffect(() => {
        on_select_ref.current = on_select
    }, [on_select])

    useLayoutEffect(() => {
        latest_host_transitioning_ref.current = host_transitioning
    }, [host_transitioning])

    useEffect(() => {
        if (!enabled) return
        ensure_dispatch()
        select_handlers.set(switcher_id, (view_id) => {
            const accepted = on_select_ref.current(view_id as T)
            if (accepted === false && latest_sync_ref.current) {
                post_toolbar_message(latest_sync_ref.current)
            }
        })
        return () => {
            select_handlers.delete(switcher_id)
            snapshot_ref.current = ""
            latest_sync_ref.current = null
            was_enabled_ref.current = false
            post_toolbar_message({
                type: "remove",
                switcher_id,
                animated: latest_host_transitioning_ref.current
            })
        }
    }, [enabled, switcher_id])

    useEffect(() => {
        if (!enabled) return
        // Animate on initial show only when settling from a host swipe; keep later visible toggles animated.
        const animated = was_enabled_ref.current || prev_host_transitioning_ref.current || host_transitioning
        was_enabled_ref.current = true
        const items: NativeToolbarItem[] = views.map((view) => ({
            id: view.id,
            label: view.label ?? "",
            icon: view.native_icon ?? ""
        }))
        const message: NativeToolbarSync = {
            type: "sync",
            switcher_id,
            layout,
            visible,
            animated,
            interaction_enabled: interactive,
            active_id,
            active_color,
            items
        }
        latest_sync_ref.current = message
        const state_snapshot = JSON.stringify({
            switcher_id,
            layout,
            visible,
            interaction_enabled: interactive,
            active_id,
            active_color,
            items
        })
        if (snapshot_ref.current === state_snapshot) return
        snapshot_ref.current = state_snapshot
        post_toolbar_message(message)
    }, [enabled, host_transitioning, switcher_id, layout, views, active_id, active_color, visible, interactive])

    useEffect(() => {
        prev_host_transitioning_ref.current = host_transitioning
    }, [host_transitioning])
}
