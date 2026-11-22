"use client"

import { useState, useCallback } from "react"
import { useController } from "@/components/hooks"
import { Button, view_switcher_controller } from "@/components"
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
        view_switcher_controller.hide_toolbar()
        set_is_editor_open(true)
    }, [])

    const handle_close_editor = useCallback(() => {
        view_switcher_controller.show_toolbar()
        set_is_editor_open(false)
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
                            <Button variant="outline" size="md" onClick={reset_form} className="font-mono">
                                Cancel
                            </Button>
                        )}
                        <Button
                            type="submit"
                            variant="primary"
                            size="md"
                            disabled={!form.command.trim()}
                            className="font-mono"
                        >
                            {editing_id ? "Save" : "Add"}
                        </Button>
                    </div>
                </form>
            </ShortcutEditorModal>
        </>
    )
}
