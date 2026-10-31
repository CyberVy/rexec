import type { ComponentPropsWithRef, CSSProperties, ReactNode } from "react"

type AnimationStyle = Pick<CSSProperties, "opacity" | "transform" | "filter">

type AnimationContainerProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
    show?: boolean
    children: ReactNode
    duration?: number
    delay?: number
    easing?: string
    enter_from: AnimationStyle
    enter_to: AnimationStyle
    exit_from?: AnimationStyle
    exit_to?: AnimationStyle
    on_enter_start?: () => void
    on_enter_end?: () => void
    on_exit_start?: () => void
    on_exit_end?: () => void
    unmount_on_exit?: boolean
    animate_on_mount?: boolean
}

export type { AnimationStyle, AnimationContainerProps }
