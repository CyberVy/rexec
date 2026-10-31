"use client"

import { HapticContainer } from "./HapticContainer"
import { join_classes } from "../utils"

import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react"

export type NaiveButtonProps = ComponentPropsWithRef<"button"> & {
    on_click?: (event: MouseEvent<HTMLButtonElement>) => void
}

export type ButtonGroupItem = {
    key?: string | number
    content?: ReactNode
    className?: string
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void
    on_click?: (event: MouseEvent<HTMLButtonElement>) => void
    disabled?: boolean
    title?: string
    aria_label?: string
}

export type ButtonGroupProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
    items: ButtonGroupItem[]
}

function NaiveButton({ children, className, onClick, on_click, type = "button", ref, ...props }: NaiveButtonProps) {
    return (
        <button
            type={type}
            ref={ref}
            className={join_classes(
                "inline-flex items-center justify-center cursor-pointer select-none transition active:scale-[0.97]",
                className
            )}
            onClick={(event) => {
                const handle_click = on_click ?? onClick
                handle_click?.(event)
            }}
            {...props}
        >
            <HapticContainer disabled={props.disabled}>
                <div className="w-full h-full flex items-center justify-center">{children}</div>
            </HapticContainer>
        </button>
    )
}

function ButtonGroup({ items, className, ref, ...props }: ButtonGroupProps) {
    return (
        <div ref={ref} className={join_classes("inline-flex items-center select-none", className)} {...props}>
            {items.map((item, index) => {
                const handle_click = item.on_click ?? item.onClick

                return (
                    <button
                        key={item.key ?? index}
                        type="button"
                        disabled={item.disabled}
                        title={item.title}
                        aria-label={item.aria_label}
                        className={join_classes(
                            "inline-flex items-center justify-center cursor-pointer transition active:scale-[0.97]",
                            item.className
                        )}
                        onClick={(event) => {
                            handle_click?.(event)
                        }}
                    >
                        <HapticContainer disabled={item.disabled}>
                            <div className="w-full h-full flex items-center justify-center">{item.content}</div>
                        </HapticContainer>
                    </button>
                )
            })}
        </div>
    )
}

export { NaiveButton, ButtonGroup }
