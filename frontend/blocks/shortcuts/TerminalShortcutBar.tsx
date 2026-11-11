"use client"

import { useState, useCallback } from "react"
import { useController } from "@/components/hooks"
import { view_switcher_controller } from "@/components"
import { pty_controller } from "@/core/controllers/pty_controller"
import { pty_shortcut_controller, type PtyShortcutKind } from "@/core/controllers/pty_shortcut_controller"
import { SHORTCUT_INPUT_CLASS, ShortcutEditorField, ShortcutEditorModal } from "../modals"
import { ShortcutStrip } from "./ShortcutStrip"

interface TerminalShortcutForm {
    label: string
    payload: string
    kind: PtyShortcutKind
}

const EMPTY_FORM: TerminalShortcutForm = { label: "", payload: "", kind: "command" }

function send_terminal_shortcut(kind: PtyShortcutKind, payload: string): void {
    if (kind === "command") {
        const command = payload.trim()
        if (!command) return
        pty_controller.send(command + "\r")
        return
    }
    if (!payload) return
    pty_controller.send(payload)
}

export interface TerminalShortcutBarProps {
    disabled?: boolean
}

export function TerminalShortcutBar({ disabled = false }: TerminalShortcutBarProps = {}) {
    const shortcut_state = useController(pty_shortcut_controller, { events: ["change"] })
    const [is_editor_open, set_is_editor_open] = useState(false)
    const [editing_id, set_editing_id] = useState<string | null>(null)
    const [form, set_form] = useState<TerminalShortcutForm>(EMPTY_FORM)

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
        const payload = form.kind === "key" ? form.payload : form.payload.trim()
        if (!payload) return
        if (editing_id) {
            pty_shortcut_controller.update(editing_id, form)
        } else {
            pty_shortcut_controller.add(form)
        }
        reset_form()
    }

    return (
        <>
            <ShortcutStrip
                items={shortcut_state.items.map((item) => ({
                    id: item.id,
                    label: item.label,
                    title: item.kind === "key" ? `Keys: ${item.payload}` : item.payload,
                    note: item.kind === "key" ? "key" : undefined
                }))}
                disabled={disabled}
                manage_label="Edit terminal shortcuts"
                on_select={(id) => {
                    if (disabled) return
                    const item = shortcut_state.items.find((entry) => entry.id === id)
                    if (!item) return
                    send_terminal_shortcut(item.kind, item.payload)
                }}
                on_manage={handle_open_editor}
            />
            <ShortcutEditorModal
                title="Terminal Shortcuts"
                open={is_editor_open}
                editing_id={editing_id}
                entries={shortcut_state.items.map((item) => ({
                    id: item.id,
                    label: item.label,
                    detail: item.kind === "key" ? `key  ${item.payload}` : item.payload
                }))}
                on_close={handle_close_editor}
                on_edit={(id) => {
                    const item = shortcut_state.items.find((entry) => entry.id === id)
                    if (!item) return
                    set_editing_id(id)
                    set_form({ label: item.label, payload: item.payload, kind: item.kind })
                }}
                on_remove={(id) => {
                    pty_shortcut_controller.remove(id)
                    if (editing_id === id) reset_form()
                }}
                on_move={(id, offset) => pty_shortcut_controller.move(id, offset)}
            >
                <form onSubmit={handle_save} className="flex flex-col gap-3">
                    <ShortcutEditorField label="Label">
                        <input
                            type="text"
                            value={form.label}
                            onChange={(event) => set_form((prev) => ({ ...prev, label: event.target.value }))}
                            placeholder="Shown on the chip. Defaults to the payload."
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className={SHORTCUT_INPUT_CLASS}
                        />
                    </ShortcutEditorField>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-mono text-muted-foreground">Send as</span>
                        <div className="inline-flex rounded-lg border border-black/10 dark:border-white/10 overflow-hidden w-fit">
                            {(["command", "key"] as const).map((kind) => {
                                const is_selected = form.kind === kind
                                return (
                                    <button
                                        key={kind}
                                        type="button"
                                        onClick={() => set_form((prev) => ({ ...prev, kind }))}
                                        className={`px-3 py-1.5 text-xs font-mono cursor-pointer ${
                                            is_selected
                                                ? "bg-foreground text-background"
                                                : "text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {kind === "command" ? "Command" : "Keys"}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    <ShortcutEditorField label={form.kind === "command" ? "Command" : "Keys"}>
                        <input
                            type="text"
                            value={form.payload}
                            onChange={(event) => set_form((prev) => ({ ...prev, payload: event.target.value }))}
                            placeholder={form.kind === "command" ? "ls -la" : "q"}
                            required
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className={SHORTCUT_INPUT_CLASS}
                        />
                    </ShortcutEditorField>
                    <p className="text-[11px] font-mono text-muted-foreground">
                        {form.kind === "command"
                            ? "Sent as one line, then Enter."
                            : "Sent exactly as typed, with no Enter. Use this inside a full-screen program."}
                    </p>
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
                            disabled={form.kind === "key" ? form.payload.length === 0 : !form.payload.trim()}
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
