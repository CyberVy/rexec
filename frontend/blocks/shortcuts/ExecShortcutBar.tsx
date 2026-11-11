"use client"

import { useState, useCallback } from "react"
import { useController } from "@/components/hooks"
import { view_switcher_controller } from "@/components"
import { exec_shortcut_controller } from "@/core/controllers/exec_shortcut_controller"
import { SHORTCUT_INPUT_CLASS, ShortcutEditorField, ShortcutEditorModal } from "../modals"
import { ShortcutStrip } from "./ShortcutStrip"

interface ExecShortcutForm {
    label: string
    command: string
}

const EMPTY_FORM: ExecShortcutForm = { label: "", command: "" }

export interface ExecShortcutBarProps {
    disabled?: boolean
    on_run: (command: string) => void
}

export function ExecShortcutBar({ disabled = false, on_run }: ExecShortcutBarProps) {
    const shortcut_state = useController(exec_shortcut_controller, { events: ["change"] })
    const [is_editor_open, set_is_editor_open] = useState(false)
    const [editing_id, set_editing_id] = useState<string | null>(null)
    const [form, set_form] = useState<ExecShortcutForm>(EMPTY_FORM)

    const reset_form = useCallback(() => {
        set_editing_id(null)
        set_form(EMPTY_FORM)
    }, [])

    const handle_open_editor = useCallback(() => {
        set_is_editor_open((prev) => {
            if (prev) return prev
            view_switcher_controller.hide_all_toolbars()
            return true
        })
    }, [])

    const handle_close_editor = useCallback(() => {
        set_is_editor_open((prev) => {
            if (!prev) return prev
            view_switcher_controller.show_all_toolbars()
            return false
        })
        reset_form()
    }, [reset_form])

    const handle_save = (event: React.FormEvent) => {
        event.preventDefault()
        if (!form.command.trim()) return
        if (editing_id) {
            exec_shortcut_controller.update(editing_id, form)
        } else {
            exec_shortcut_controller.add(form)
        }
        reset_form()
    }

    return (
        <>
            <ShortcutStrip
                items={shortcut_state.items.map((item) => ({
                    id: item.id,
                    label: item.label,
                    title: item.command
                }))}
                disabled={disabled}
                manage_label="Edit exec shortcuts"
                on_select={(id) => {
                    const item = shortcut_state.items.find((entry) => entry.id === id)
                    if (!item) return
                    on_run(item.command)
                }}
                on_manage={handle_open_editor}
            />
            <ShortcutEditorModal
                title="Exec Shortcuts"
                open={is_editor_open}
                editing_id={editing_id}
                entries={shortcut_state.items.map((item) => ({
                    id: item.id,
                    label: item.label,
                    detail: item.command
                }))}
                on_close={handle_close_editor}
                on_edit={(id) => {
                    const item = shortcut_state.items.find((entry) => entry.id === id)
                    if (!item) return
                    set_editing_id(id)
                    set_form({ label: item.label, command: item.command })
                }}
                on_remove={(id) => {
                    exec_shortcut_controller.remove(id)
                    if (editing_id === id) reset_form()
                }}
                on_move={(id, offset) => exec_shortcut_controller.move(id, offset)}
            >
                <form onSubmit={handle_save} className="flex flex-col gap-3">
                    <ShortcutEditorField label="Label">
                        <input
                            type="text"
                            value={form.label}
                            onChange={(event) => set_form((prev) => ({ ...prev, label: event.target.value }))}
                            placeholder="Shown on the chip. Defaults to the command."
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className={SHORTCUT_INPUT_CLASS}
                        />
                    </ShortcutEditorField>
                    <ShortcutEditorField label="Command">
                        <input
                            type="text"
                            value={form.command}
                            onChange={(event) => set_form((prev) => ({ ...prev, command: event.target.value }))}
                            placeholder="uname -a"
                            required
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className={SHORTCUT_INPUT_CLASS}
                        />
                    </ShortcutEditorField>
                    <div className="flex items-center justify-end gap-3">
                        {editing_id && (
                            <button
                                type="button"
                                onClick={reset_form}
                                className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/10 text-xs font-mono text-muted-foreground hover:text-foreground transition cursor-pointer"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            type="submit"
                            disabled={!form.command.trim()}
                            className="px-4 py-2 rounded-xl bg-foreground text-background text-xs font-mono disabled:opacity-40 cursor-pointer"
                        >
                            {editing_id ? "Save" : "Add"}
                        </button>
                    </div>
                </form>
            </ShortcutEditorModal>
        </>
    )
}
