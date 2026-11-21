import type { ComponentPropsWithRef, ReactNode, RefObject, TransitionEvent } from "react"

// ============================================================================
// Public View & Component Types
// ============================================================================

export type ToolbarColor = string | { light: string; dark: string }

export interface ResolvedToolbarColor {
    light: string
    dark: string
}

export type ToolbarLayout = "bottom-floating" | "top-floating"

export interface View<T extends string = string> {
    /** Unique identifier for the view */
    id: T
    /** Label text displayed in web and native toolbars */
    label?: string
    /** React node for the icon displayed in the web navigation bar */
    icon?: ReactNode
    /** SF Symbol name for the iOS native toolbar */
    native_icon?: string
    /** Default active icon and label color for this view (overrides toolbar active_color) */
    active_color?: ToolbarColor
    /** Component or content to render when this view is selected */
    content: ReactNode
    /** Override global keep-alive setting for this specific view */
    keep_alive?: boolean
    /** Override global scroll memory setting for this specific view. Only effective when keep_alive resolves to true. */
    remember_scroll?: boolean
    /** Whether horizontal swipe transition is enabled for this view. Defaults to true. */
    swipe_enabled?: boolean
    /** Hide the floating toolbar while this view is active */
    hide_toolbar?: boolean
    /** Whether overscroll (rubber-band) behavior is enabled on the root element for this view. Defaults to true. */
    overscroll_enabled?: boolean
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
    /** Layout positioning: bottom floating (default) or top floating */
    toolbar_layout?: ToolbarLayout
    /** Suppress floating toolbars for this switcher and nested switchers (e.g. during launch splash) */
    toolbar_hidden?: boolean
    /** Default active icon and label color for the toolbar */
    active_color?: ToolbarColor
}

// ============================================================================
// Internal Controller & Presentation Types
// ============================================================================

export interface ViewSwitcherInstance {
    id: string
    parent_id: string | null
    active_view_id: string
    is_transitioning: boolean
}

export interface ViewSwitcherControllerState {
    instances: Record<string, ViewSwitcherInstance>
    is_toolbar_hidden: boolean
    active_color_overrides: Record<string, ResolvedToolbarColor>
    view_active_color_overrides: Record<string, ResolvedToolbarColor>
}

export interface SwitchViewEventDetail {
    switcher_id: string
    view_id: string
}

export interface ViewSwitcherToolbarProps<T extends string> {
    views: View<T>[]
    active_view_id: T
    toolbar_layout: ToolbarLayout
    visible: boolean
    interactive: boolean
    active_color: ResolvedToolbarColor | null
    on_view_select: (view_id: T) => void
}

// ============================================================================
// Internal Gesture & Swipe Transition Types
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
    active_swipe_enabled: boolean
    container_element_ref: RefObject<HTMLDivElement | null>
    scroll_positions_ref: RefObject<Record<string, number>>
    commit_view_change: (view_id: T) => void
}

export interface UseViewSwipeGestureResult<T extends string> {
    transition_state: TransitionState<T>
    is_transitioning: boolean
    set_view_element: (view_id: T, element: HTMLDivElement | null) => void
    handle_transition_end: (e?: TransitionEvent) => void
    reset_transition: () => void
}
