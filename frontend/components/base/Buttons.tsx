"use client"

import { HapticContainer } from "./HapticContainer"
import { join_classes } from "../utils"

import type { ComponentPropsWithRef } from "react"

export type NaiveButtonProps = ComponentPropsWithRef<"button">

function NaiveButton({ children, className, type = "button", ref, ...props }: NaiveButtonProps) {
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

export { NaiveButton }
