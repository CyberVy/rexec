"use client"

import { HapticContainer } from "../feedback/HapticContainer"
import { join_classes } from "../utils"

import type { ComponentPropsWithRef } from "react"

export type ButtonProps = ComponentPropsWithRef<"button">

/** Unstyled interactive button primitive with press feedback and iOS native switch haptics. */
function Button({ children, className, type = "button", ref, ...props }: ButtonProps) {
    return (
        <button
            {...props}
            type={type}
            ref={ref}
            className={join_classes(
                "inline-flex items-center justify-center cursor-pointer select-none transition active:scale-[0.97]",
                className
            )}
        >
            <HapticContainer disabled={props.disabled}>
                <div className="w-full h-full flex items-center justify-center">{children}</div>
            </HapticContainer>
        </button>
    )
}

export { Button }
