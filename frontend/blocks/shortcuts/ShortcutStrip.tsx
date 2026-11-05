"use client"

import { useCallback } from "react"
import { NaiveButton } from "@/components/base/Buttons"
import { PlusIcon } from "../icons"

export interface ShortcutStripItem {
    id: string
    label: string
    title?: string
    note?: string
}

export interface ShortcutStripProps {
    items: ShortcutStripItem[]
    disabled?: boolean
    on_select: (id: string) => void
    on_manage: () => void
    manage_label?: string
}

export function ShortcutStrip({
    items,
    disabled = false,
    on_select,
    on_manage,
    manage_label = "Edit shortcuts"
}: ShortcutStripProps) {
    const handle_strip_ref = useCallback((strip: HTMLDivElement | null) => {
        if (!strip) return

        const stop_touch_propagation = (event: TouchEvent) => {
            event.stopPropagation()
        }

        strip.addEventListener("touchstart", stop_touch_propagation, { passive: true })
        strip.addEventListener("touchmove", stop_touch_propagation, { passive: true })

        return () => {
            strip.removeEventListener("touchstart", stop_touch_propagation)
            strip.removeEventListener("touchmove", stop_touch_propagation)
        }
    }, [])

    return (
        <div ref={handle_strip_ref} className="shrink-0 flex items-center gap-1.5 min-w-0">
            <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono">
                {items.map((item) => (
                    <NaiveButton
                        key={item.id}
                        type="button"
                        title={item.title ?? item.label}
                        disabled={disabled}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => on_select(item.id)}
                        className="px-2.5 py-1 rounded bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 active:bg-black/25 dark:active:bg-white/25 text-foreground font-medium shrink-0 disabled:opacity-40"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <span>{item.label}</span>
                            {item.note && <span className="text-[10px] text-muted-foreground">{item.note}</span>}
                        </span>
                    </NaiveButton>
                ))}
                {items.length === 0 && (
                    <span className="px-1 text-[11px] text-muted-foreground shrink-0">No shortcuts</span>
                )}
            </div>
            <NaiveButton
                type="button"
                title={manage_label}
                aria-label={manage_label}
                onClick={on_manage}
                className="shrink-0 size-8 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-foreground"
            >
                <PlusIcon className="size-3.5" />
            </NaiveButton>
        </div>
    )
}
