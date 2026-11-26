"use client"

import { Plus } from "lucide-react"
import { Button, HorizontalScroller, Text } from "@/components"
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
            <HorizontalScroller className="flex-1 min-w-0 items-center gap-1.5 py-1 px-1.5 rounded-lg bg-ui-fill-subtle border border-ui-border text-xs font-mono">
                {items.map((item) => (
                    <Button
                        key={item.id}
                        type="button"
                        variant="unstyled"
                        title={item.title ?? item.label}
                        disabled={disabled}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => on_select(item.id)}
                        className="px-2.5 py-1 rounded bg-ui-fill-hover hover:bg-ui-fill-solid/15 active:bg-ui-fill-solid/25 text-foreground font-medium shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <Text variant="caption" weight="medium" tone="inherit" mono>
                                {item.label}
                            </Text>
                            {item.note && (
                                <Text variant="footnote" tone="secondary" mono className="text-[10px]">
                                    {item.note}
                                </Text>
                            )}
                        </span>
                    </Button>
                ))}
                {items.length === 0 && (
                    <Text variant="footnote" tone="secondary" mono className="px-1 shrink-0">
                        No shortcuts
                    </Text>
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
