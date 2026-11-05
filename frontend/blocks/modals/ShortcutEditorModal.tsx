"use client"

import { useCallback, useEffect } from "react"
import type { ReactNode } from "react"
import {
    AnimationContainer,
    BackIcon,
    BodyPortal,
    ButtonGroup,
    CloseIcon,
    FullscreenModalContainer,
    view_switcher_controller
} from "@/components"
import { TrashIcon } from "../icons"

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
    const handle_close = useCallback(() => {
        view_switcher_controller.show_all_toolbars()
        on_close()
    }, [on_close])

    useEffect(() => {
        if (!open) return
        view_switcher_controller.hide_all_toolbars()
        return () => {
            view_switcher_controller.show_all_toolbars()
        }
    }, [open])

    return (
        <BodyPortal>
            <AnimationContainer
                enter_from={{ transform: "translateY(100vh)" }}
                enter_to={{ transform: "translateY(0)" }}
                show={open}
                unmount_on_exit={true}
                duration={250}
                className="fixed inset-0 z-50"
            >
                <FullscreenModalContainer
                    enable_escape={open}
                    on_escape={handle_close}
                    className="bg-background/95 backdrop-blur-2xl text-foreground pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] px-4 sm:px-6"
                >
                    <div className="w-full max-w-xl mx-auto flex flex-col gap-4 py-2">
                        <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
                            <span className="font-semibold text-base font-mono text-foreground">{title}</span>
                            <button
                                type="button"
                                onClick={handle_close}
                                className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition cursor-pointer"
                                title="Close"
                            >
                                <CloseIcon className="size-5" />
                            </button>
                        </div>

                        {children}

                        <div className="flex flex-col gap-2">
                            {entries.length === 0 && (
                                <div className="text-xs font-mono text-muted-foreground py-6 text-center">
                                    No shortcuts yet.
                                </div>
                            )}
                            {entries.map((entry, index) => {
                                const is_editing = entry.id === editing_id
                                return (
                                    <div
                                        key={entry.id}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                                            is_editing
                                                ? "border-foreground/40 bg-black/5 dark:bg-white/10"
                                                : "border-black/10 dark:border-white/10"
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => on_edit(entry.id)}
                                            className="flex-1 min-w-0 text-left cursor-pointer"
                                        >
                                            <div className="text-sm font-mono text-foreground truncate">
                                                {entry.label}
                                            </div>
                                            <div className="text-[11px] font-mono text-muted-foreground truncate">
                                                {entry.detail}
                                            </div>
                                        </button>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                type="button"
                                                title="Move earlier"
                                                disabled={index === 0}
                                                onClick={() => on_move(entry.id, -1)}
                                                className="px-1.5 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                type="button"
                                                title="Move later"
                                                disabled={index === entries.length - 1}
                                                onClick={() => on_move(entry.id, 1)}
                                                className="px-1.5 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                type="button"
                                                title="Delete shortcut"
                                                onClick={() => on_remove(entry.id)}
                                                className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer"
                                            >
                                                <TrashIcon className="size-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </FullscreenModalContainer>

                <ButtonGroup
                    className="fixed text-2xl bottom-17 right-4 z-1 rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-xl shadow-sm p-1"
                    items={[
                        {
                            content: <BackIcon key="back" />,
                            className: "w-10 h-10",
                            on_click: handle_close
                        }
                    ]}
                />
            </AnimationContainer>
        </BodyPortal>
    )
}
