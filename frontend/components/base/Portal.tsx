"use client"

import { createPortal } from "react-dom"
import type { ReactNode } from "react"

type BodyPortalProps = {
    children: ReactNode
}
/**
 * Render children into document.body.
 * Useful for overlays that must escape parent layout, scroll, and stacking contexts.
 */
function BodyPortal({ children }: BodyPortalProps) {
    if (typeof document === "undefined") return null

    return createPortal(children, document.body)
}

export { BodyPortal }
export type { BodyPortalProps }
