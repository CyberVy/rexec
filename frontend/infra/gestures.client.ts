export type PressCancelReason = "move" | "leave" | "cancel"

/**
 * Helper to prevent mobile WebKit (iOS) blue magnifier outline on specific target elements.
 * Only calls preventDefault on touchend when the event was triggered directly on the element itself (e.target === e.currentTarget).
 * @param event touch event object
 * @param should_trigger_click whether to supplement currentTarget.click() (defaults to true)
 */
export function prevent_ios_magnifier_on_target<
    TEvent extends { target: unknown; currentTarget: unknown; preventDefault?: () => void }
>(event: TEvent, should_trigger_click = true) {
    if (event.target === event.currentTarget) {
        if (typeof event.preventDefault === "function") {
            event.preventDefault()
        }
        if (should_trigger_click) {
            const el = event.currentTarget as { click?: () => void } | null
            if (el && typeof el.click === "function") {
                el.click()
            }
        }
    }
}

type GestureEnabled<TEvent> = boolean | ((event: TEvent) => boolean)

type PressGestureActionParams<TEvent extends { clientX: number; clientY: number }> = {
    on_trigger: (event: TEvent) => void
    enabled?: GestureEnabled<TEvent>
}

type LongPressParams<TEvent extends { clientX: number; clientY: number }> = PressGestureActionParams<TEvent> & {
    on_end?: (event: TEvent) => void
    ms?: number
}

type PressGestureParams<
    TEvent extends { clientX: number; clientY: number; stopPropagation?: () => void; preventDefault?: () => void }
> = {
    click?: PressGestureActionParams<TEvent>
    on_cancel?: (reason: PressCancelReason, event: TEvent) => void
    on_success?: (event: TEvent) => void
    enabled?: GestureEnabled<TEvent>
    long_press?: LongPressParams<TEvent>
    move_threshold?: number
    stop_propagation?: boolean | ((event: TEvent) => boolean)
    prevent_default?: boolean | ((event: TEvent) => boolean)
}

const is_gesture_enabled = <TEvent>(enabled: GestureEnabled<TEvent> | undefined, event: TEvent) => {
    if (typeof enabled === "function") {
        return enabled(event)
    }

    return enabled ?? true
}

export function create_press_gesture<
    TEvent extends { clientX: number; clientY: number; stopPropagation?: () => void; preventDefault?: () => void }
>({
    click,
    on_cancel,
    on_success,
    enabled,
    long_press,
    move_threshold = 10,
    stop_propagation = false,
    prevent_default = false
}: PressGestureParams<TEvent>) {
    let timer = 0
    let start_event: TEvent | null = null
    let start_client_x = 0
    let start_client_y = 0
    let should_long_press = false
    let long_pressing = false

    const clear_timer = () => {
        if (!timer) return

        window.clearTimeout(timer)
        timer = 0
    }

    const reset_press = () => {
        clear_timer()
        start_event = null
        start_client_x = 0
        start_client_y = 0
        should_long_press = false
        long_pressing = false
    }

    const cancel_press = (reason: PressCancelReason, event: TEvent) => {
        if (!start_event) return

        reset_press()
        on_cancel?.(reason, event)
    }

    const handle_event_options = (event: TEvent) => {
        const should_stop = typeof stop_propagation === "function" ? stop_propagation(event) : stop_propagation
        if (should_stop && typeof event.stopPropagation === "function") {
            event.stopPropagation()
        }
        const should_prevent = typeof prevent_default === "function" ? prevent_default(event) : prevent_default
        if (should_prevent && typeof event.preventDefault === "function") {
            event.preventDefault()
        }
    }

    const on_pointer_down = (event: TEvent) => {
        if (!is_gesture_enabled(enabled, event)) {
            reset_press()
            return
        }

        reset_press()
        handle_event_options(event)

        start_event = event
        start_client_x = event.clientX
        start_client_y = event.clientY
        should_long_press = Boolean(long_press?.on_trigger) && is_gesture_enabled(long_press?.enabled, event)

        if (!should_long_press) return

        timer = window.setTimeout(() => {
            if (!start_event) return

            long_pressing = true
            long_press?.on_trigger(start_event)
        }, long_press?.ms ?? 300)
    }

    const on_pointer_move = (event: TEvent) => {
        if (!start_event) return

        if (is_gesture_enabled(enabled, event)) {
            handle_event_options(event)
        }

        if (long_pressing) return

        const moved_x = event.clientX - start_client_x
        const moved_y = event.clientY - start_client_y

        if (Math.hypot(moved_x, moved_y) < move_threshold) return

        cancel_press("move", event)
    }

    const on_pointer_up = (event: TEvent) => {
        if (!start_event) return

        if (is_gesture_enabled(enabled, event)) {
            handle_event_options(event)
        }

        const did_long_press = long_pressing

        if (did_long_press) {
            long_press?.on_end?.(event)
        }

        reset_press()
        if (did_long_press) {
            on_success?.(event)
            return
        }

        if (!click?.on_trigger) return
        if (!is_gesture_enabled(click.enabled, event)) return

        click.on_trigger(event)
        on_success?.(event)
    }

    const on_pointer_cancel = (event: TEvent) => {
        if (!start_event) return

        if (is_gesture_enabled(enabled, event)) {
            handle_event_options(event)
        }

        if (long_pressing) {
            long_press?.on_end?.(event)
            reset_press()
            return
        }

        cancel_press("cancel", event)
    }

    const on_pointer_leave = (event: TEvent) => {
        if (!start_event) return

        if (is_gesture_enabled(enabled, event)) {
            handle_event_options(event)
        }

        if (long_pressing) {
            long_press?.on_end?.(event)
            reset_press()
            return
        }

        cancel_press("leave", event)
    }

    return {
        on_pointer_down,
        on_pointer_move,
        on_pointer_up,
        on_pointer_cancel,
        on_pointer_leave,
        reset_press
    }
}

export type SwipeDirection = "left" | "right"

export interface SwipeEndResult {
    /** Swipe direction: "left" (dragged towards left, going next) or "right" (dragged towards right, going prev) */
    direction: SwipeDirection
    /** Total horizontal displacement from start position in px */
    diff_x: number
    /** Instantaneous swipe velocity in px/ms */
    velocity_x: number
    /** Recommended completion status based on combined distance and velocity */
    should_complete: boolean
}

export type SwipeGestureEnabled<TEvent> = boolean | ((direction: SwipeDirection, event: TEvent) => boolean)

export interface SwipeGestureParams<TEvent extends TouchEvent = TouchEvent> {
    /** Whether the gesture is enabled. Can be boolean or predicate function. */
    enabled?: SwipeGestureEnabled<TEvent>
    /** Triggered when horizontal swipe locks in. Return false to cancel. */
    on_start?: (direction: SwipeDirection, event: TEvent) => boolean | void
    /** Triggered during swipe move with current horizontal displacement. */
    on_move?: (diff_x: number, event: TEvent) => void
    /** Triggered when swipe gesture ends on touch up or cancel. */
    on_end?: (result: SwipeEndResult, event: TEvent) => void

    /** Slope ratio threshold (Math.abs(dx) > Math.abs(dy) * angle_ratio). Default: 1.5 */
    angle_ratio?: number
    /** Minimum swipe distance in px to trigger should_complete. Default: 60 */
    min_distance?: number
    /** Minimum distance ratio relative to container width. Default: 0.2 */
    distance_ratio?: number
    /** Velocity threshold (px/ms) for quick flick detection. Default: 0.3 */
    velocity_threshold?: number
    /** Whether to stop event propagation when swiping. Default: false */
    stop_propagation?: boolean | ((event: TEvent) => boolean)
    /** Whether to prevent default scrolling when swiping. Default: true */
    prevent_default?: boolean | ((event: TEvent) => boolean)
    /** Whether to reset the X displacement reference point to 0 when swipe gesture is activated. Default: true */
    reset_offset_on_start?: boolean
}

export function create_swipe_gesture<TEvent extends TouchEvent = TouchEvent>({
    enabled,
    on_start,
    on_move,
    on_end,
    angle_ratio = 1.5,
    min_distance = 60,
    distance_ratio = 0.2,
    velocity_threshold = 0.3,
    stop_propagation = false,
    prevent_default = true,
    reset_offset_on_start = true
}: SwipeGestureParams<TEvent>) {
    let bound_element: HTMLElement | null = null
    let touch_start_ref: { x: number; y: number; time: number } | null = null
    let touch_last_ref: { x: number; time: number } | null = null
    let swipe_start_x: number | null = null
    let active_touch_id: number | null = null
    let is_swiping = false
    let has_scrolled_vertically = false
    let current_direction: SwipeDirection = "right"
    let last_diff_x = 0

    const reset_swipe = () => {
        touch_start_ref = null
        touch_last_ref = null
        swipe_start_x = null
        active_touch_id = null
        is_swiping = false
        has_scrolled_vertically = false
        last_diff_x = 0
    }

    const handle_event_options = (event: TEvent) => {
        const should_stop = typeof stop_propagation === "function" ? stop_propagation(event) : stop_propagation
        if (should_stop && typeof event.stopPropagation === "function") {
            event.stopPropagation()
        }
        const should_prevent = typeof prevent_default === "function" ? prevent_default(event) : prevent_default
        if (should_prevent && typeof event.preventDefault === "function" && event.cancelable !== false) {
            event.preventDefault()
        }
    }

    const find_active_touch = (touch_list: TouchList): Touch | null => {
        if (active_touch_id === null) return null

        for (const touch of touch_list) {
            if (touch.identifier === active_touch_id) {
                return touch
            }
        }
        return null
    }

    const on_touch_start = (event: TEvent) => {
        if (event.touches && event.touches.length > 1) {
            return
        }

        const touch = event.touches ? event.touches[0] : null
        if (!touch) {
            reset_swipe()
            return
        }

        const now = Date.now()
        touch_start_ref = {
            x: touch.clientX,
            y: touch.clientY,
            time: now
        }
        touch_last_ref = {
            x: touch.clientX,
            time: now
        }
        active_touch_id = touch.identifier
        is_swiping = false
        has_scrolled_vertically = false
        last_diff_x = 0
    }

    const on_touch_move = (event: TEvent) => {
        if (!touch_start_ref) return

        const touch = find_active_touch(event.touches)
        if (!touch) return

        const now = Date.now()
        const diff_x = touch.clientX - touch_start_ref.x
        const diff_y = touch.clientY - touch_start_ref.y

        // Track last move position sample for instantaneous velocity calculation (sample every >10ms)
        if (!touch_last_ref || now - touch_last_ref.time >= 10) {
            touch_last_ref = {
                x: touch.clientX,
                time: now
            }
        }

        if (!is_swiping) {
            if (has_scrolled_vertically) return

            const abs_x = Math.abs(diff_x)
            const abs_y = Math.abs(diff_y)

            if (abs_x <= 2 && abs_y <= 2) return

            const direction: SwipeDirection = diff_x < 0 ? "left" : "right"
            current_direction = direction

            const is_enabled = typeof enabled === "function" ? enabled(direction, event) : (enabled ?? true)

            if (abs_x > abs_y * angle_ratio && is_enabled) {
                const start_result = on_start?.(direction, event)
                if (start_result === false) {
                    has_scrolled_vertically = true
                    return
                }

                is_swiping = true
                if (reset_offset_on_start) {
                    swipe_start_x = touch.clientX
                }
                const active_diff_x = swipe_start_x !== null ? touch.clientX - swipe_start_x : diff_x
                last_diff_x = active_diff_x
                handle_event_options(event)
                on_move?.(active_diff_x, event)
            } else {
                has_scrolled_vertically = true
            }
        } else {
            const active_diff_x = swipe_start_x !== null ? touch.clientX - swipe_start_x : diff_x
            last_diff_x = active_diff_x
            handle_event_options(event)
            on_move?.(active_diff_x, event)
        }
    }

    const calculate_swipe_velocity = (event: TEvent): number => {
        if (!touch_start_ref) return 0

        const last_touch = find_active_touch(event.changedTouches) ?? find_active_touch(event.touches)
        const end_x = last_touch ? last_touch.clientX : (touch_last_ref?.x ?? touch_start_ref.x)
        const now = Date.now()

        const time_since_last_move = now - (touch_last_ref ? touch_last_ref.time : touch_start_ref.time)
        if (time_since_last_move <= 100 && touch_last_ref) {
            const last_dt = Math.max(1, now - touch_last_ref.time)
            const last_dx = end_x - touch_last_ref.x
            return last_dx / last_dt
        }
        return 0
    }

    const on_touch_end = (event: TEvent) => {
        if (!is_swiping || !touch_start_ref) {
            reset_swipe()
            return
        }

        if (event.touches && active_touch_id !== null) {
            let is_active_touch_still_down = false
            for (const touch of event.touches) {
                if (touch.identifier === active_touch_id) {
                    is_active_touch_still_down = true
                    break
                }
            }
            if (is_active_touch_still_down) {
                return
            }
        }

        handle_event_options(event)

        const last_touch = find_active_touch(event.changedTouches) ?? find_active_touch(event.touches)
        const end_x = last_touch ? last_touch.clientX : (touch_last_ref?.x ?? touch_start_ref.x)
        const diff_x = swipe_start_x !== null ? end_x - swipe_start_x : end_x - touch_start_ref.x
        const velocity_x = calculate_swipe_velocity(event)

        const container_width = bound_element?.getBoundingClientRect().width || window.innerWidth
        const threshold = Math.min(container_width * distance_ratio, min_distance)

        const final_direction: SwipeDirection = diff_x < 0 ? "left" : diff_x > 0 ? "right" : current_direction

        const is_fast_flick =
            final_direction === "left" ? velocity_x < -velocity_threshold : velocity_x > velocity_threshold
        const is_distance_enough = final_direction === "left" ? diff_x < -threshold : diff_x > threshold
        const should_complete = is_fast_flick || is_distance_enough

        on_end?.(
            {
                direction: final_direction,
                diff_x,
                velocity_x,
                should_complete
            },
            event
        )

        reset_swipe()
    }

    const on_touch_cancel = (event: TEvent) => {
        if (is_swiping) {
            const velocity_x = calculate_swipe_velocity(event)

            on_end?.(
                {
                    direction: current_direction,
                    diff_x: last_diff_x,
                    velocity_x,
                    should_complete: false
                },
                event
            )
        }
        reset_swipe()
    }

    return {
        on_touch_start,
        on_touch_move,
        on_touch_end,
        on_touch_cancel,
        reset_swipe,
        bind: (element: HTMLElement) => {
            bound_element = element

            element.addEventListener("touchstart", on_touch_start as EventListener, { passive: false })
            element.addEventListener("touchmove", on_touch_move as EventListener, { passive: false })
            element.addEventListener("touchend", on_touch_end as EventListener, { passive: true })
            element.addEventListener("touchcancel", on_touch_cancel as EventListener, { passive: true })

            return () => {
                element.removeEventListener("touchstart", on_touch_start as EventListener)
                element.removeEventListener("touchmove", on_touch_move as EventListener)
                element.removeEventListener("touchend", on_touch_end as EventListener)
                element.removeEventListener("touchcancel", on_touch_cancel as EventListener)
                bound_element = null
            }
        }
    }
}
