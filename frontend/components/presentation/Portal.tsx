"use client"

import { createPortal } from "react-dom"
import type { ReactNode } from "react"

export type PortalProps = {
    children: ReactNode
    container?: Element | null
}

/**
 * Render children into a DOM portal container (defaults to `document.body`).
 * Useful for overlays that must escape parent layout, scroll, and stacking contexts.
 */
function Portal({ children, container }: PortalProps) {
    if (typeof document === "undefined") return null

    const target = container ?? document.body
    if (!target) return null

    return createPortal(children, target)
}

export { Portal }
