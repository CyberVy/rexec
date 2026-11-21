"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { create_press_gesture } from "@/infra/gestures.client"
import { Menu } from "../controls/Menu"
import { useEscapeKey } from "../hooks"
import { Portal } from "./Portal"
import { Transition } from "./Transition"

import type { MouseEvent as ReactMouseEvent, PointerEvent, ReactNode, Ref } from "react"
import type { MenuItem, MenuSection } from "../controls/Menu"

export type ContextMenuProps = {
    children: ReactNode
    sections: MenuSection[]
    on_select?: (key: string, item: MenuItem) => void
    header?: ReactNode
    footer?: ReactNode
    selected_key?: string
    default_selected_key?: string
    enable_haptic?: boolean
    disabled?: boolean
    long_press_ms?: number
    close_after_select?: boolean
    close_label?: string
    on_click_trigger?: (event: PointerEvent<HTMLDivElement>) => void
    // className and ref apply to the trigger wrapper, not to the menu panel.
    className?: string
    ref?: Ref<HTMLDivElement>
}

function get_context_menu_render_point(
    context_menu_element: HTMLElement,
    context_menu_point: [number, number]
): [number, number] {
    const safe_padding = 12
    const max_x = Math.max(safe_padding, window.innerWidth - context_menu_element.offsetWidth - safe_padding)
    const max_y = Math.max(safe_padding, window.innerHeight - context_menu_element.offsetHeight - safe_padding)
    const next_x = Math.min(Math.max(context_menu_point[0], safe_padding), max_x)
    const next_y = Math.min(Math.max(context_menu_point[1], safe_padding), max_y)

    return [next_x, next_y]
}

function ContextMenu({
    children,
    disabled = false,
    long_press_ms = 300,
    close_after_select = true,
    close_label = "Close",
    on_click_trigger,
    className,
    ref,
    sections,
    on_select,
    enable_haptic = true,
    header,
    footer,
    selected_key,
    default_selected_key
}: ContextMenuProps) {
    const backdrop_press_active_ref = useRef(false)
    const context_menu_active_ref = useRef(false)
    const menu_element_ref = useRef<HTMLDivElement | null>(null)

    const [show_context_menu, set_show_context_menu] = useState(false)
    const [context_menu_point, set_context_menu_point] = useState<[number, number]>([0, 0])
    const [context_menu_render_point, set_context_menu_render_point] = useState<[number, number]>([0, 0])

    const has_context_menu = Boolean(sections && sections.length > 0)

    const context_menu_enter_from = useMemo(() => ({ transform: "scale(0.0)" }), [])
    const context_menu_enter_to = useMemo(() => ({ transform: "scale(1.0)" }), [])

    const close_context_menu = useCallback(() => {
        backdrop_press_active_ref.current = false
        set_show_context_menu(false)
    }, [])

    useEscapeKey(show_context_menu, close_context_menu)

    const open_context_menu = useCallback(
        (client_x: number, client_y: number, target_el?: HTMLElement | null) => {
            if (disabled || !has_context_menu) return

            let final_x = client_x
            let final_y = client_y

            if (final_x === 0 && final_y === 0 && target_el) {
                const rect = target_el.getBoundingClientRect()
                final_x = Math.round(rect.left + rect.width / 2)
                final_y = Math.round(rect.top + rect.height / 2)
            }

            set_context_menu_point([final_x, final_y])
            set_context_menu_render_point([final_x, final_y])
            set_show_context_menu(true)
        },
        [disabled, has_context_menu]
    )

    useLayoutEffect(() => {
        if (!show_context_menu || !menu_element_ref.current) return

        const next_render_point = get_context_menu_render_point(menu_element_ref.current, context_menu_point)
        set_context_menu_render_point((prev) => {
            if (prev[0] === next_render_point[0] && prev[1] === next_render_point[1]) {
                return prev
            }
            return next_render_point
        })
    }, [show_context_menu, context_menu_point, sections])

    const press_config_ref = useRef({
        disabled,
        has_context_menu,
        on_click_trigger,
        open_context_menu
    })
    const press_gesture_ref = useRef<ReturnType<typeof create_press_gesture<PointerEvent<HTMLDivElement>>> | null>(null)

    useLayoutEffect(() => {
        press_config_ref.current = {
            disabled,
            has_context_menu,
            on_click_trigger,
            open_context_menu
        }
    })

    useLayoutEffect(() => {
        const gesture = create_press_gesture<PointerEvent<HTMLDivElement>>({
            enabled: (event) => {
                const cfg = press_config_ref.current
                if (event.button !== 0) return false
                if (cfg.on_click_trigger) return true
                return !cfg.disabled && cfg.has_context_menu
            },
            click: {
                on_trigger: (event) => {
                    press_config_ref.current.on_click_trigger?.(event)
                }
            },
            long_press: {
                enabled: (event) => {
                    const cfg = press_config_ref.current
                    return cfg.has_context_menu && !cfg.disabled && event.pointerType === "touch"
                },
                on_trigger: (event) => {
                    press_config_ref.current.open_context_menu(event.clientX, event.clientY, event.currentTarget)
                },
                ms: long_press_ms
            }
        })
        press_gesture_ref.current = gesture

        return () => {
            gesture.reset_press()
            if (press_gesture_ref.current === gesture) {
                press_gesture_ref.current = null
            }
        }
    }, [long_press_ms])

    useEffect(() => {
        if (disabled || (!has_context_menu && !on_click_trigger)) {
            press_gesture_ref.current?.reset_press()
        }
    }, [disabled, has_context_menu, on_click_trigger])

    const handle_context_menu = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (disabled || !has_context_menu) return

        event.preventDefault()
        event.stopPropagation()
        open_context_menu(event.clientX, event.clientY, event.currentTarget)
    }

    return (
        <>
            <div
                ref={ref}
                className={className}
                onContextMenu={handle_context_menu}
                onPointerDown={(event) => press_gesture_ref.current?.on_pointer_down(event)}
                onPointerMove={(event) => press_gesture_ref.current?.on_pointer_move(event)}
                onPointerUp={(event) => press_gesture_ref.current?.on_pointer_up(event)}
                onPointerCancel={(event) => press_gesture_ref.current?.on_pointer_cancel(event)}
                onPointerLeave={(event) => press_gesture_ref.current?.on_pointer_leave(event)}
            >
                {children}
            </div>
            {has_context_menu && !disabled && (
                <Portal>
                    <Transition
                        duration={300}
                        enter_from={context_menu_enter_from}
                        enter_to={context_menu_enter_to}
                        show={show_context_menu}
                        unmount_on_exit={true}
                        className="fixed inset-0 z-100 select-none"
                        style={{
                            transformOrigin: `${context_menu_point[0]}px ${context_menu_point[1]}px`
                        }}
                    >
                        <button
                            type="button"
                            aria-label={close_label}
                            className="fixed inset-0 block w-full h-full"
                            onPointerDown={(event) => {
                                event.stopPropagation()
                                backdrop_press_active_ref.current = true
                                close_context_menu()
                            }}
                            onClick={(event) => {
                                event.stopPropagation()
                                if (!backdrop_press_active_ref.current) return
                                close_context_menu()
                            }}
                        />
                        <div
                            ref={menu_element_ref}
                            className="fixed z-10 w-[min(208px,calc(100vw-24px))]"
                            style={{
                                left: context_menu_render_point[0],
                                top: context_menu_render_point[1]
                            }}
                            onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                            }}
                            onPointerDown={(event) => {
                                event.stopPropagation()
                                context_menu_active_ref.current = true
                            }}
                            onClickCapture={(event) => {
                                if (!context_menu_active_ref.current) {
                                    event.stopPropagation()
                                }
                                context_menu_active_ref.current = false
                            }}
                            onClick={(event) => {
                                event.stopPropagation()
                            }}
                        >
                            <Menu
                                className="overscroll-none overflow-auto w-full"
                                header={header}
                                footer={footer}
                                selected_key={selected_key}
                                default_selected_key={default_selected_key}
                                sections={sections || []}
                                enable_haptic={enable_haptic}
                                on_select={(key, item) => {
                                    on_select?.(key, item)
                                    if (close_after_select === false) return
                                    close_context_menu()
                                }}
                            />
                        </div>
                    </Transition>
                </Portal>
            )}
        </>
    )
}

export { ContextMenu }
