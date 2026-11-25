"use client"

import { ArrowLeft, X, Trash2 } from "lucide-react"
import type { ReactNode } from "react"
import { Button, EmptyState, FullscreenSheet, ListRow, SectionHeader, Text } from "@/components"
export interface ShortcutEditorModalEntry {
    id: string
    label: string
    detail: string
}

export interface ShortcutEditorModalProps {
    title: string
    open: boolean
    entries: ShortcutEditorModalEntry[]
    editing_id: string | null
    on_close: () => void
    on_edit: (id: string) => void
    on_remove: (id: string) => void
    on_move: (id: string, offset: -1 | 1) => void
    children: ReactNode
}

export function ShortcutEditorField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <Text variant="caption" tone="secondary" mono>
                {label}
            </Text>
            {children}
        </label>
    )
}

export const SHORTCUT_INPUT_CLASS =
    "px-3.5 py-2 rounded-xl bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"

export function ShortcutEditorModal({
    title,
    open,
    entries,
    editing_id,
    on_close,
    on_edit,
    on_remove,
    on_move,
    children
}: ShortcutEditorModalProps) {
    return (
        <FullscreenSheet
            open={open}
            on_close={on_close}
            duration={250}
            className="bg-background/95 pt-[max(env(safe-area-inset-top),10px)] pb-[max(env(safe-area-inset-bottom),10px)] pl-[max(env(safe-area-inset-left),10px)] pr-[max(env(safe-area-inset-right),10px)]"
        >
            <div className="flex flex-col w-full h-full">
                <div className="w-full max-w-xl mx-auto px-2 sm:px-4 pt-2 pb-3 flex items-center justify-between border-b border-black/10 dark:border-white/10 shrink-0">
                    <Text variant="headline" mono>
                        {title}
                    </Text>
                    <Button
                        variant="ghost"
                        size="icon"
                        shape="none"
                        onClick={on_close}
                        className="rounded-lg"
                        title="Close"
                    >
                        <X className="size-5" />
                    </Button>
                </div>

                <div className="flex-1 min-h-0 w-full overflow-y-auto overscroll-none no-scrollbar">
                    <div className="w-full max-w-xl mx-auto flex flex-col gap-4 px-2 sm:px-4 py-4">
                        {children}

                        <div className="flex flex-col gap-2">
                            <SectionHeader title="Saved Shortcuts" count={entries.length} className="font-mono" />
                            {entries.length === 0 && (
                                <EmptyState
                                    title="No shortcuts yet."
                                    className="rounded-xl border border-dashed border-(--ui-border) font-mono"
                                />
                            )}
                            {entries.map((entry, index) => {
                                const is_editing = entry.id === editing_id
                                return (
                                    <ListRow
                                        key={entry.id}
                                        size="sm"
                                        variant={is_editing ? "filled" : "plain"}
                                        on_click={() => on_edit(entry.id)}
                                        title={
                                            <Text variant="body" weight="medium" tone="inherit" mono>
                                                {entry.label}
                                            </Text>
                                        }
                                        subtitle={
                                            <Text variant="footnote" tone="inherit" mono>
                                                {entry.detail}
                                            </Text>
                                        }
                                        className={
                                            is_editing ? "border border-foreground/40" : "border border-(--ui-border)"
                                        }
                                        trailing={
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    shape="none"
                                                    title="Move earlier"
                                                    disabled={index === 0}
                                                    onClick={() => on_move(entry.id, -1)}
                                                    className="px-1.5 py-1 rounded text-xs font-mono"
                                                >
                                                    ↑
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    shape="none"
                                                    title="Move later"
                                                    disabled={index === entries.length - 1}
                                                    onClick={() => on_move(entry.id, 1)}
                                                    className="px-1.5 py-1 rounded text-xs font-mono"
                                                >
                                                    ↓
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    shape="none"
                                                    title="Delete shortcut"
                                                    onClick={() => on_remove(entry.id)}
                                                    className="size-7 rounded-lg"
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </Button>
                                            </>
                                        }
                                    />
                                )
                            })}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end px-2 my-2 shrink-0 select-none">
                    <div className="inline-flex items-center select-none rounded-full border border-black/10 dark:border-white/10 p-1">
                        <Button className="w-14 h-8" onClick={on_close}>
                            <ArrowLeft key="back" />
                        </Button>
                    </div>
                </div>
            </div>
        </FullscreenSheet>
    )
}
