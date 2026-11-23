"use client"

import { ArrowLeft, X, Trash2 } from "lucide-react"
import type { ReactNode } from "react"
import { Button, EmptyState, FullscreenSheet, ListRow, Portal, SectionHeader } from "@/components"
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
            <span className="text-xs font-mono text-muted-foreground">{label}</span>
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
            className="bg-background/95 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] px-4 sm:px-6"
        >
            <div className="w-full max-w-xl mx-auto flex flex-col gap-4 py-2">
                <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
                    <span className="font-semibold text-base font-mono text-foreground">{title}</span>
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
                                title={<span className="font-mono">{entry.label}</span>}
                                subtitle={<span className="font-mono text-[11px]">{entry.detail}</span>}
                                className={is_editing ? "border border-foreground/40" : "border border-(--ui-border)"}
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
            <Portal>
                <div
                    className={
                        "inline-flex items-center select-none fixed text-2xl bottom-17 right-4 z-51 rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-xl shadow-sm p-1"
                    }
                >
                    <Button className={"w-10 h-10"} onClick={on_close}>
                        {<ArrowLeft key="back" />}
                    </Button>
                </div>
            </Portal>
        </FullscreenSheet>
    )
}
