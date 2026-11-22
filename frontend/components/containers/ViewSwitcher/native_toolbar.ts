"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import { handle_ios_ipc, has_ios_capability, ios_ipc_call } from "@/infra"
import type { ResolvedToolbarColor, ToolbarLayout, View } from "./types"

const TOOLBAR_CAPABILITY = "view_switcher_toolbar"
const TOOLBAR_SYNC_TYPE = "view_switcher_toolbar.sync"
const TOOLBAR_REMOVE_TYPE = "view_switcher_toolbar.remove"
const TOOLBAR_SELECT_TYPE = "view_switcher_toolbar.select"

type NativeToolbarItem = {
    id: string
    label: string
    icon: string
}

type NativeToolbarSyncPayload = {
    switcher_id: string
    layout: ToolbarLayout
    visible: boolean
    animated: boolean
    interaction_enabled: boolean
    active_id: string
    active_color: ResolvedToolbarColor | null
    items: NativeToolbarItem[]
}

export function is_native_toolbar_active(): boolean {
    return has_ios_capability(TOOLBAR_CAPABILITY)
}

function post_toolbar_ipc(type: string, payload: Record<string, unknown>): void {
    ios_ipc_call({ type, payload }).catch(() => {})
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
    const latest_sync_ref = useRef<NativeToolbarSyncPayload | null>(null)
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
        const unsubscribe = handle_ios_ipc({
            type: TOOLBAR_SELECT_TYPE,
            handler: (payload) => {
                if (payload.switcher_id !== switcher_id) return
                const view_id = typeof payload.view_id === "string" ? payload.view_id : ""
                if (!view_id) return

                const accepted = on_select_ref.current(view_id as T)
                if (accepted === false && latest_sync_ref.current) {
                    post_toolbar_ipc(TOOLBAR_SYNC_TYPE, latest_sync_ref.current)
                }
            }
        })
        return () => {
            unsubscribe()
            snapshot_ref.current = ""
            latest_sync_ref.current = null
            was_enabled_ref.current = false
            post_toolbar_ipc(TOOLBAR_REMOVE_TYPE, {
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
        const payload: NativeToolbarSyncPayload = {
            switcher_id,
            layout,
            visible,
            animated,
            interaction_enabled: interactive,
            active_id,
            active_color,
            items
        }
        latest_sync_ref.current = payload
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
        post_toolbar_ipc(TOOLBAR_SYNC_TYPE, payload)
    }, [enabled, host_transitioning, switcher_id, layout, views, active_id, active_color, visible, interactive])

    useEffect(() => {
        prev_host_transitioning_ref.current = host_transitioning
    }, [host_transitioning])
}
