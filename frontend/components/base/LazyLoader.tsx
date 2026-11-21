import { useState, useEffect, useRef } from "react"
import type { FC, ReactNode, Ref, RefObject } from "react"
import { useMergedRef } from "@/components/hooks"
import { is_element_hidden } from "@/components/utils"

export type KeepLoadedMargin = {
    top?: number
    bottom?: number
    left?: number
    right?: number
}

export type LazyContainerProps = {
    children: ReactNode
    // The placeholder element should have the same dimensions as the children to avoid layout shifts (CLS).
    placeholder?: ReactNode
    threshold?: number | number[]
    root_margin?: string
    // Accepts a DOM Element, a React Ref object, or null (defaults to browser viewport)
    root?: Element | RefObject<Element | null> | null
    keep_loaded_margin?: KeepLoadedMargin
    className?: string
    ref?: Ref<HTMLDivElement>
}

const DEFAULT_PLACEHOLDER = <div style={{ minHeight: "200px" }} />

const LazyContainer: FC<LazyContainerProps> = ({
    children,
    placeholder = DEFAULT_PLACEHOLDER,
    threshold = 0,
    root_margin = "200px",
    root = null,
    keep_loaded_margin,
    className,
    ref
}) => {
    const threshold_key = Array.isArray(threshold) ? threshold.join(",") : String(threshold)
    const {
        top: keep_loaded_top,
        bottom: keep_loaded_bottom,
        left: keep_loaded_left,
        right: keep_loaded_right
    } = keep_loaded_margin || {}

    // Track visibility of the element in the viewport
    const [is_visible, set_is_visible] = useState<boolean>(false)

    // Use a ref to access the latest loaded state inside the observer callback
    const has_loaded_ref = useRef<boolean>(false)

    const element_ref = useRef<HTMLDivElement>(null)
    const set_element_ref = useMergedRef(element_ref, ref)

    useEffect(() => {
        const current_ref = element_ref.current
        if (!current_ref) return

        // Resolve the root element whether passed as a DOM node or a React ref object
        const root_element =
            root && typeof root === "object" && "current" in root ? root.current : (root as Element | null)

        const resolved_threshold = threshold_key.includes(",")
            ? threshold_key.split(",").map(Number)
            : Number(threshold_key)

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries

                if (entry.isIntersecting) {
                    // The element enters the viewport
                    set_is_visible(true)
                    has_loaded_ref.current = true
                } else {
                    // The element leaves the viewport
                    if (has_loaded_ref.current && element_ref.current) {
                        // If the element (or its parent) has display: none, skip unmounting to prevent layout collapse.
                        // We use the optimized, reflow-free is_element_hidden implementation here.
                        if (is_element_hidden(element_ref.current)) {
                            return
                        }
                        const rect = entry.boundingClientRect

                        let should_keep_loaded = false

                        if (
                            keep_loaded_top !== undefined ||
                            keep_loaded_bottom !== undefined ||
                            keep_loaded_left !== undefined ||
                            keep_loaded_right !== undefined
                        ) {
                            let element_absolute_top = 0
                            let element_absolute_bottom = 0
                            let element_absolute_left = 0
                            let element_absolute_right = 0
                            let scroll_content_height = 0
                            let scroll_content_width = 0

                            if (root_element) {
                                const root_rect = root_element.getBoundingClientRect()
                                element_absolute_top = rect.top - root_rect.top + root_element.scrollTop
                                element_absolute_bottom = rect.bottom - root_rect.top + root_element.scrollTop
                                element_absolute_left = rect.left - root_rect.left + root_element.scrollLeft
                                element_absolute_right = rect.right - root_rect.left + root_element.scrollLeft
                                scroll_content_height = root_element.scrollHeight
                                scroll_content_width = root_element.scrollWidth
                            } else {
                                element_absolute_top = rect.top + window.scrollY
                                element_absolute_bottom = rect.bottom + window.scrollY
                                element_absolute_left = rect.left + window.scrollX
                                element_absolute_right = rect.right + window.scrollX
                                scroll_content_height = document.documentElement.scrollHeight
                                scroll_content_width = document.documentElement.scrollWidth
                            }

                            const distance_from_top = element_absolute_top
                            const distance_from_bottom = scroll_content_height - element_absolute_bottom
                            const distance_from_left = element_absolute_left
                            const distance_from_right = scroll_content_width - element_absolute_right

                            if (keep_loaded_top !== undefined && distance_from_top <= keep_loaded_top) {
                                should_keep_loaded = true
                            }
                            if (keep_loaded_bottom !== undefined && distance_from_bottom <= keep_loaded_bottom) {
                                should_keep_loaded = true
                            }
                            if (keep_loaded_left !== undefined && distance_from_left <= keep_loaded_left) {
                                should_keep_loaded = true
                            }
                            if (keep_loaded_right !== undefined && distance_from_right <= keep_loaded_right) {
                                should_keep_loaded = true
                            }
                        }

                        if (should_keep_loaded) {
                            return
                        }

                        // Unmount the real children to save memory
                        set_is_visible(false)
                    }
                }
            },
            {
                root: root_element,
                rootMargin: root_margin,
                threshold: resolved_threshold
            }
        )

        observer.observe(current_ref)

        return () => {
            observer.disconnect()
        }
    }, [threshold_key, root_margin, root, keep_loaded_top, keep_loaded_bottom, keep_loaded_left, keep_loaded_right])

    return (
        <div ref={set_element_ref} className={className} data-lazy-state={is_visible ? "content" : "placeholder"}>
            {is_visible ? children : placeholder}
        </div>
    )
}

export { LazyContainer }
