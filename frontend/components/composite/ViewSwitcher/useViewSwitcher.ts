"use client"

import { useCallback } from "react"
import { useController } from "@/components/hooks"
import type { ViewSwitcherState, ViewSwitcherRegistryState } from "./types"
import {
    view_switcher_controller,
    STATIC_EMPTY_VIEW_SWITCHER_STATE,
    INITIAL_VIEW_SWITCHER_REGISTRY_STATE
} from "./ViewSwitcherController"

export function useViewSwitcher(switcher_id?: string): ViewSwitcherState {
    const selector = useCallback(
        (_state: ViewSwitcherRegistryState) => {
            const target_id = switcher_id ?? view_switcher_controller.get_default_switcher_id() ?? ""
            return view_switcher_controller.get_state(target_id)
        },
        [switcher_id]
    )

    return useController(view_switcher_controller, {
        events: "change",
        selector,
        server_snapshot: STATIC_EMPTY_VIEW_SWITCHER_STATE
    })
}

export function useViewSwitcherRegistry(): ViewSwitcherRegistryState {
    return useController(view_switcher_controller, {
        events: "change",
        server_snapshot: INITIAL_VIEW_SWITCHER_REGISTRY_STATE
    })
}
