"use client"

import { Plus } from "lucide-react"
import { Button, HorizontalScroller } from "@/components"
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
    return (
        <div className="shrink-0 flex items-center gap-1.5 min-w-0">
            <HorizontalScroller className="flex-1 min-w-0 items-center gap-1.5 py-1 px-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono">
                {items.map((item) => (
                    <Button
                        key={item.id}
                        type="button"
                        variant="unstyled"
                        title={item.title ?? item.label}
                        disabled={disabled}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => on_select(item.id)}
                        className="px-2.5 py-1 rounded bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 active:bg-black/25 dark:active:bg-white/25 text-foreground font-medium shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <span>{item.label}</span>
                            {item.note && (
                                <span className="text-[10px] text-black/50 dark:text-white/50">{item.note}</span>
                            )}
                        </span>
                    </Button>
                ))}
                {items.length === 0 && (
                    <span className="px-1 text-[11px] text-black/50 dark:text-white/50 shrink-0">No shortcuts</span>
                )}
            </HorizontalScroller>
            <Button
                type="button"
                variant="secondary"
                size="icon"
                shape="none"
                title={manage_label}
                aria-label={manage_label}
                onClick={on_manage}
                className="shrink-0 rounded-lg"
            >
                <Plus className="size-3.5" />
            </Button>
        </div>
    )
}
