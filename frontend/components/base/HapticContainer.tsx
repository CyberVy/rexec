"use client"

import { is_ios_device, vibrate } from "@/infra"
import type { ReactNode } from "react"

export type HapticContainerProps = {
    children: ReactNode
    disabled?: boolean
}

const IS_IOS_DEVICE = typeof window !== "undefined" && is_ios_device()

function HapticContainer({ children, disabled }: HapticContainerProps) {
    if (IS_IOS_DEVICE) {
        return (
            <label className="contents">
                <input
                    disabled={disabled}
                    onClick={(event) => event.stopPropagation()}
                    onTouchStart={(event) => event.stopPropagation()}
                    onTouchMove={(event) => event.stopPropagation()}
                    onTouchCancel={(event) => event.stopPropagation()}
                    onTouchEnd={(event) => event.stopPropagation()}
                    onTouchCancelCapture={(event) => event.stopPropagation()}
                    onTouchEndCapture={(event) => event.stopPropagation()}
                    onTouchMoveCapture={(event) => event.stopPropagation()}
                    onTouchStartCapture={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerMove={(event) => event.stopPropagation()}
                    onPointerCancel={(event) => event.stopPropagation()}
                    onPointerEnter={(event) => event.stopPropagation()}
                    onPointerLeave={(event) => event.stopPropagation()}
                    onPointerCancelCapture={(event) => event.stopPropagation()}
                    onPointerDownCapture={(event) => event.stopPropagation()}
                    onPointerMoveCapture={(event) => event.stopPropagation()}
                    onPointerOut={(event) => event.stopPropagation()}
                    onPointerOutCapture={(event) => event.stopPropagation()}
                    onPointerOver={(event) => event.stopPropagation()}
                    onPointerOverCapture={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onPointerUpCapture={(event) => event.stopPropagation()}
                    ref={(node) => {
                        if (!node) return
                        node.setAttribute("switch", "")
                    }}
                    type="checkbox"
                    className="hidden"
                />
                {children}
            </label>
        )
    }

    return (
        <label
            className="contents"
            onClickCapture={() => {
                if (disabled) return
                vibrate()
            }}
        >
            {children}
        </label>
    )
}

export { HapticContainer }
