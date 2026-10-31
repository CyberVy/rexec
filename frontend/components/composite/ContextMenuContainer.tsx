"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { vibrate } from "@/infra/device.client"
import { create_press_gesture } from "@/infra/gestures.client"
import { FullscreenModalContainer } from "@/components/composite/ModalContainer"
import { VerticalMenuBar } from "@/components/base/MenuBar"
import { AnimationContainer } from "@/components/animation/AnimationContainer"
import { BodyPortal } from "@/components/base/Portal"
import type { PointerEvent, ReactNode } from "react"
import type { VerticalMenuBarProps } from "@/components/base/MenuBar"

export type ContextMenuProps = VerticalMenuBarProps & {
    children: ReactNode
    disabled?: boolean
    long_press_ms?: number
    close_after_select?: boolean
    on_click_trigger?: (event: PointerEvent<HTMLDivElement>) => void
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
    on_click_trigger,
    className,
    style,
    ref,
    ...menuProps
}: ContextMenuProps) {
    const { sections, on_select, enable_vibration = true, ...remainingMenuProps } = menuProps
    const backdrop_press_active_ref = useRef(false)
    const context_menu_active_ref = useRef(false)
    const menu_element_ref = useRef<HTMLDivElement | null>(null)

    const [show_context_menu, set_show_context_menu] = useState(false)
    const [context_menu_point, set_context_menu_point] = useState<[number, number]>([0, 0])
    const [context_menu_render_point, set_context_menu_render_point] = useState<[number, number]>([0, 0])

    const has_context_menu = Boolean(sections && sections.length > 0)

    const context_menu_enter_from = useMemo(() => {
        return { transform: "scale(0.0)" }
    }, [])

    const context_menu_enter_to = useMemo(() => {
        return { transform: "scale(1.0)" }
    }, [])

    const close_context_menu = useCallback(() => {
        backdrop_press_active_ref.current = false
        set_show_context_menu(false)
    }, [])

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
    }, [show_context_menu, context_menu_point])

    const press_gesture = create_press_gesture<PointerEvent<HTMLDivElement>>({
        enabled: (event) => {
            if (event.button !== 0) return false
            if (on_click_trigger) return true
            return !disabled && has_context_menu
        },
        on_success: () => {
            if (enable_vibration) {
                vibrate()
            }
        },
        click: {
            on_trigger: (event) => {
                on_click_trigger?.(event)
            }
        },
        long_press:
            has_context_menu && !disabled
                ? {
                      enabled: (event) => event.pointerType === "touch",
                      on_trigger: (event) => {
                          open_context_menu(event.clientX, event.clientY, event.currentTarget)
                      },
                      ms: long_press_ms
                  }
                : undefined
    })

    useEffect(() => {
        return () => {
            press_gesture.reset_press()
        }
    }, [press_gesture])

    useEffect(() => {
        if (!show_context_menu) return

        const close_on_escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return

            close_context_menu()
        }

        window.addEventListener("keydown", close_on_escape)

        return () => {
            window.removeEventListener("keydown", close_on_escape)
        }
    }, [close_context_menu, show_context_menu])

    const handle_context_menu = (event: React.MouseEvent<HTMLDivElement>) => {
        if (disabled || !has_context_menu) return

        event.preventDefault()
        event.stopPropagation()
        open_context_menu(event.clientX, event.clientY, event.currentTarget)
    }

    return (
        <>
            <div
                ref={ref}
                className={[className].filter(Boolean).join(" ")}
                style={style}
                onContextMenu={handle_context_menu}
                onPointerDown={press_gesture.on_pointer_down}
                onPointerMove={press_gesture.on_pointer_move}
                onPointerUp={press_gesture.on_pointer_up}
                onPointerCancel={press_gesture.on_pointer_cancel}
                onPointerLeave={press_gesture.on_pointer_leave}
            >
                {children}
            </div>
            {has_context_menu && !disabled && (
                <BodyPortal>
                    <AnimationContainer
                        duration={300}
                        enter_from={context_menu_enter_from}
                        enter_to={context_menu_enter_to}
                        show={show_context_menu}
                        unmount_on_exit={true}
                        className={"fixed inset-0 z-100 select-none"}
                        style={{
                            transformOrigin: `${context_menu_point[0]}px ${context_menu_point[1]}px`
                        }}
                    >
                        <FullscreenModalContainer
                            onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                            }}
                            onPointerDown={(event) => {
                                event.stopPropagation()
                                backdrop_press_active_ref.current = true
                                close_context_menu()
                            }}
                            onTouchStart={(event) => {
                                event.stopPropagation()
                                backdrop_press_active_ref.current = true
                            }}
                            onClick={(event) => {
                                event.stopPropagation()
                                if (!backdrop_press_active_ref.current) return
                                close_context_menu()
                            }}
                        >
                            <VerticalMenuBar
                                className={"overscroll-none overflow-auto fixed w-[min(208px,calc(100vw-24px))]"}
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
                                // In iOS PWA, an onClick event can be triggered automatically
                                // when a new element appears on the screen where the finger touched
                                // This makes sure the onClick event is triggered after an onPointerDown event
                                onClickCapture={(event) => {
                                    if (!context_menu_active_ref.current) {
                                        event.stopPropagation()
                                    }
                                    context_menu_active_ref.current = false
                                }}
                                onClick={(event) => {
                                    event.stopPropagation()
                                }}
                                ref={menu_element_ref}
                                sections={sections || []}
                                enable_vibration={enable_vibration}
                                on_select={(key, item) => {
                                    on_select?.(key, item)
                                    if (close_after_select === false) return

                                    close_context_menu()
                                }}
                                {...remainingMenuProps}
                            />
                        </FullscreenModalContainer>
                    </AnimationContainer>
                </BodyPortal>
            )}
        </>
    )
}

export { ContextMenu }
