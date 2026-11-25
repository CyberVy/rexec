"use client"

import { useState } from "react"
import { Button } from "../controls/Button"
import { TextField } from "../controls/TextField"
import { Text } from "../views/Text"
import { Modal } from "./Modal"

import type { ReactNode } from "react"

export type AlertAction = {
    key: string
    label: ReactNode
    primary?: boolean
    is_disabled?: (text: string) => boolean
    on_click?: (text: string) => void
}

export type AlertTextField = {
    placeholder?: string
    initial_value?: string
    clear_label?: string
    clear_icon?: ReactNode
}

export type AlertProps = {
    open: boolean
    on_close: () => void
    title: ReactNode
    message?: ReactNode
    text_field?: AlertTextField
    actions: AlertAction[]
    close_label?: string
    unmount_on_exit?: boolean
    z_index?: number
}

/**
 * Alert dialog with a title, an optional message, an optional single text field and a row of actions.
 * Every action closes the alert after it runs, and the primary action also runs on Enter.
 * The text field resets to its initial value each time the alert opens.
 */
function Alert({
    open,
    on_close,
    title,
    message,
    text_field,
    actions,
    close_label,
    unmount_on_exit,
    z_index
}: AlertProps) {
    const initial_value = text_field?.initial_value ?? ""
    const [text, set_text] = useState(initial_value)
    const [prev_open, set_prev_open] = useState(open)
    const [prev_initial_value, set_prev_initial_value] = useState(initial_value)

    if (open !== prev_open || initial_value !== prev_initial_value) {
        set_prev_open(open)
        set_prev_initial_value(initial_value)
        if (open) {
            set_text(initial_value)
        }
    }

    const run_action = (action: AlertAction) => {
        action.on_click?.(text)
        on_close()
    }

    const handle_submit = () => {
        const primary_action = actions.find((action) => action.primary)
        if (primary_action && !primary_action.is_disabled?.(text)) {
            run_action(primary_action)
        }
    }

    return (
        <Modal
            open={open}
            on_close={on_close}
            close_label={close_label}
            unmount_on_exit={unmount_on_exit}
            z_index={z_index}
            duration={250}
            easing="ease-in-out"
            enter_from={{ transform: "scale(0)", opacity: 1 }}
            enter_to={{ transform: "scale(1)", opacity: 1 }}
            exit_from={{ transform: "scale(1)", opacity: 1 }}
            exit_to={{ transform: "scale(0)", opacity: 1 }}
            backdrop_class_name="bg-black/40 dark:bg-black/60 backdrop-blur-xs"
            className="w-[85vw] max-w-sm p-4 select-none"
        >
            <div className="flex flex-col gap-4">
                <Text as="h3" variant="headline" className="flex items-center gap-2">
                    {title}
                </Text>

                {message && (
                    <Text as="div" variant="body" tone="secondary" className="whitespace-pre-wrap">
                        {message}
                    </Text>
                )}

                {text_field && (
                    <TextField
                        auto_focus={true}
                        placeholder={text_field.placeholder}
                        clear_label={text_field.clear_label}
                        clear_icon={text_field.clear_icon}
                        className="text-sm"
                        value={text}
                        on_change={set_text}
                        on_submit={handle_submit}
                    />
                )}

                <div className="flex justify-end gap-2">
                    {actions.map((action) => (
                        <Button
                            key={action.key}
                            variant={action.primary ? "primary" : "outline"}
                            size="md"
                            disabled={action.is_disabled?.(text)}
                            onClick={() => run_action(action)}
                        >
                            {action.label}
                        </Button>
                    ))}
                </div>
            </div>
        </Modal>
    )
}

export { Alert }
