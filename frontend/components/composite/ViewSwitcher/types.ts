import type { ComponentPropsWithRef, ReactNode, RefObject, TransitionEvent } from "react"

// ============================================================================
// View & Component Props
// ============================================================================

export interface View<T extends string = string> {
    /** Unique identifier for the view */
    id: T
    /** React node for the icon displayed in the navigation bar (optional) */
    icon?: ReactNode
    /** Label text or node displayed below the icon (optional) */
    label?: ReactNode
    /** Component or content to render when this view is selected */
    content: ReactNode
    /** Override global keep-alive setting for this specific view */
    keep_alive?: boolean
    /** Override global scroll memory setting for this specific view. Only effective when keep_alive resolves to true. */
    remember_scroll?: boolean
    /** Whether horizontal swipe transition is enabled for this view. Defaults to true. */
    swipe_enabled?: boolean | "left" | "right" | "both" | "none"
    /** Control whether to hide the floating toolbar based on scroll position */
    should_hide_toolbar?: boolean | ((scroll_y: number) => boolean)
}

export type ViewSwitcherProps<T extends string = string> = Omit<
    ComponentPropsWithRef<"div">,
    "children" | "onChange"
> & {
    /** Unique identifier for registering with the view switcher controller */
    id?: string
    /** List of view configurations */
    views: View<T>[]
    /** The active view ID for controlled mode */
    active_view_id?: T
    /** Initial active view ID for uncontrolled mode */
    default_active_view_id?: T
    /** Callback triggered when active view changes */
    on_view_change?: (view_id: T) => void
    /** Default keep-alive value if a view doesn't specify keep_alive */
    keep_alive_default?: boolean
    /** Whether to automatically remember and restore scroll positions of keep-alive views */
    remember_scroll?: boolean
    /** Extra actions/buttons to display on the right side of the floating toolbar */
    toolbar_extra_actions?: ReactNode
    /** Custom class for the floating bottom bar */
    toolbar_className?: string
    /** Custom class for individual view buttons */
    toolbar_item_className?: string
    /** Layout positioning: bottom floating (default) or top floating */
    toolbar_layout?: "bottom-floating" | "top-floating"
}

export type ViewSwitcherToolbarProps<T extends string> = Pick<
    ViewSwitcherProps<T>,
    "views" | "toolbar_layout" | "toolbar_extra_actions" | "toolbar_className" | "toolbar_item_className"
> & {
    active_view_id: T
    is_toolbar_visible: boolean
    is_navigation_disabled: boolean
    on_view_select: (view_id: T) => void
}

// ============================================================================
// Controller & Registry State Types
// ============================================================================

export interface ViewSwitcherState {
    id: string
    is_toolbar_visible: boolean
    is_transitioning: boolean
    has_other_transitioning: boolean
    active_view_id: string
    target_view_id: string | null
}

export type ViewSwitcherInitState = Omit<ViewSwitcherState, "has_other_transitioning">

export type ViewSwitcherListener = (state: ViewSwitcherState) => void

export interface SetToolbarVisibleOptions {
    wait_until_stable?: boolean
}

export interface SwitchViewEventDetail {
    switcher_id: string
    view_id: string
}

export interface ViewSwitcherRegistryState {
    instances: Record<string, ViewSwitcherState>
    has_any_transitioning: boolean
    global_hide_count: number
}

// ============================================================================
// Gesture & Swipe Transition Types
// ============================================================================

/** Geometry captured at gesture start and retained through the release animation. */
export interface TransitionGeometry<T extends string> {
    active_view_id: T
    active_view_height: number
    active_view_scroll_y: number
    /** Active view's document offset before it becomes fixed. */
    active_view_top: number
    viewport_height: number
    viewport_width: number
    prev_view_id?: T
    prev_view_scroll_y?: number
    next_view_id?: T
    next_view_scroll_y?: number
}

/** The visual destination, even if a controlled parent has not accepted the switch yet. */
export interface SwipeRelease<T extends string> {
    outcome: "return" | "switch"
    view_id: T
    scroll_y: number
    translation_x: number
}

export type TransitionState<T extends string> =
    | { status: "idle" }
    | (TransitionGeometry<T> & { status: "dragging" })
    | (TransitionGeometry<T> & {
          status: "released"
          release: SwipeRelease<T>
      })

export interface UseViewSwipeGestureOptions<T extends string> {
    switcher_instance_id: string
    views: View<T>[]
    current_active_view_id: T
    active_view_index: number
    active_swipe_enabled?: View<T>["swipe_enabled"]
    container_element_ref: RefObject<HTMLDivElement | null>
    scroll_positions_ref: RefObject<Record<string, number>>
    commit_view_change: (view_id: T) => void
}

export interface UseViewSwipeGestureResult<T extends string> {
    transition_state: TransitionState<T>
    is_transitioning: boolean
    target_view_id: T | null
    view_elements_ref: RefObject<Record<string, HTMLDivElement | null>>
    handle_transition_end: (e?: TransitionEvent) => void
    reset_transition: () => void
}
