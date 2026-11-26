export function join_classes(...classes: (string | false | null | undefined)[]) {
    return classes.filter(Boolean).join(" ")
}

/**
 * Checks if a DOM element has no rendered CSS layout box (disconnected or hidden via
 * `display: none` on itself or any ancestor, regardless of how the style is applied).
 */
export function is_element_hidden(element: HTMLElement | null): boolean {
    if (!element || !element.isConnected) return true
    return element.getClientRects().length === 0
}
