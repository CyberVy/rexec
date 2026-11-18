"use client"

import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type { View } from "./types"

type NativeToolbarLayout = "bottom-floating" | "top-floating"

interface NativeToolbarItem {
    id: string
    label: string
    icon: string
}

interface NativeToolbarSync {
    type: "sync"
    switcher_id: string
    layout: NativeToolbarLayout
    visible: boolean
    interaction_enabled: boolean
    active_id: string
    items: NativeToolbarItem[]
}

interface NativeToolbarRemove {
    type: "remove"
    switcher_id: string
}

interface NativeToolbarSelect {
    type: "select"
    switcher_id: string
    view_id: string
}

type NativeToolbarInbound = NativeToolbarSelect

type NativeToolbarWindow = Window & {
    __VIEW_SWITCHER_NATIVE_TOOLBAR__?: boolean
    __view_switcher_native_toolbar_dispatch?: (message: NativeToolbarInbound) => void
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

function ensure_dispatch() {
    const host = native_window()
    if (!host || host.__view_switcher_native_toolbar_dispatch) return
    host.__view_switcher_native_toolbar_dispatch = (message) => {
        if (!message || typeof message !== "object") return
        if (message.type === "select") {
            select_handlers.get(message.switcher_id)?.(message.view_id)
        }
    }
}

function post_toolbar_message(message: NativeToolbarSync | NativeToolbarRemove) {
    native_window()?.webkit?.messageHandlers?.viewSwitcherToolbar?.postMessage(message)
}

function native_item_label(label: ReactNode): string {
    return typeof label === "string" ? label : ""
}

export function useNativeToolbar<T extends string>({
    enabled,
    switcher_id,
    layout,
    views,
    active_id,
    visible,
    interaction_enabled,
    on_select
}: {
    enabled: boolean
    switcher_id: string
    layout: NativeToolbarLayout
    views: View<T>[]
    active_id: T
    visible: boolean
    interaction_enabled: boolean
    on_select: (view_id: T) => void
}) {
    const on_select_ref = useRef(on_select)
    const snapshot_ref = useRef("")

    useEffect(() => {
        on_select_ref.current = on_select
    }, [on_select])

    useEffect(() => {
        if (!enabled) return
        ensure_dispatch()
        select_handlers.set(switcher_id, (view_id) => {
            on_select_ref.current(view_id as T)
        })
        return () => {
            select_handlers.delete(switcher_id)
            post_toolbar_message({ type: "remove", switcher_id })
        }
    }, [enabled, switcher_id])

    useEffect(() => {
        if (!enabled) return
        const message: NativeToolbarSync = {
            type: "sync",
            switcher_id,
            layout,
            visible,
            interaction_enabled,
            active_id,
            items: views.map((view) => ({
                id: view.id,
                label: native_item_label(view.label),
                icon: view.native_toolbar?.icon ?? ""
            }))
        }
        const encoded = JSON.stringify(message)
        if (snapshot_ref.current === encoded) return
        snapshot_ref.current = encoded
        post_toolbar_message(message)
    }, [enabled, switcher_id, layout, views, active_id, visible, interaction_enabled])
}
