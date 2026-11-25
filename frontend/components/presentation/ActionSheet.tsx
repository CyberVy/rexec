"use client"

import { Button } from "../controls/Button"
import { HapticContainer } from "../feedback/HapticContainer"
import { join_classes } from "../utils"
import { Text } from "../views/Text"
import { Modal } from "./Modal"

import type { ReactNode, Ref } from "react"

export type ActionSheetAction = {
    key: string
    label: ReactNode
    description?: ReactNode
    icon?: ReactNode
    badge?: ReactNode
    trailing?: ReactNode
    tone?: "default" | "destructive"
    disabled?: boolean
    close_on_click?: boolean
    on_click?: () => void
}

export type ActionSheetProps = {
    open: boolean
    on_close: () => void
    title?: ReactNode
    message?: ReactNode
    actions: ActionSheetAction[]
    cancel_label?: ReactNode
    close_label?: string
    unmount_on_exit?: boolean
    z_index?: number
    className?: string
    ref?: Ref<HTMLDivElement>
}

const ENTER_FROM = { transform: "translateY(100%)", opacity: 1 }
const ENTER_TO = { transform: "translateY(0)", opacity: 1 }
const EXIT_FROM = { transform: "translateY(0)", opacity: 1 }
const EXIT_TO = { transform: "translateY(100%)", opacity: 1 }

/**
 * Bottom action sheet presentation with a grabber handle, optional title/message header,
 * icon/description action rows with haptic feedback, and an optional cancel button.
 */
function ActionSheet({
    open,
    on_close,
    title,
    message,
    actions,
    cancel_label,
    close_label,
    unmount_on_exit,
    z_index,
    className,
    ref
}: ActionSheetProps) {
    const handle_action = (action: ActionSheetAction) => {
        if (action.disabled) return
        if (action.close_on_click !== false) {
            on_close()
        }
        action.on_click?.()
    }

    return (
        <Modal
            ref={ref}
            open={open}
            on_close={on_close}
            close_label={close_label}
            unmount_on_exit={unmount_on_exit}
            z_index={z_index}
            center={false}
            duration={250}
            easing="ease-in-out"
            enter_from={ENTER_FROM}
            enter_to={ENTER_TO}
            exit_from={EXIT_FROM}
            exit_to={EXIT_TO}
            backdrop_class_name="bg-black/40 dark:bg-black/60 backdrop-blur-xs"
            container_class_name="flex flex-col justify-end px-3 sm:px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            className={join_classes(
                "w-full max-w-md max-h-[calc(100dvh-2rem-env(safe-area-inset-bottom))] mx-auto bg-white/60 dark:bg-black/60 p-4 gap-2 select-none",
                className
            )}
        >
            <div className="w-10 h-1 bg-black/20 dark:bg-white/20 rounded-full mx-auto mb-1 shrink-0" />

            {(title != null || message != null) && (
                <div className="shrink-0 border-b border-(--ui-separator) px-2 pb-3 text-center">
                    {title != null && (
                        <Text as="div" variant="body" weight="semibold">
                            {title}
                        </Text>
                    )}
                    {message != null && (
                        <Text as="div" variant="caption" tone="secondary" className="mt-1">
                            {message}
                        </Text>
                    )}
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar grid grid-cols-1 gap-1.5">
                {actions.map((action) => {
                    const is_destructive = action.tone === "destructive"

                    return (
                        <button
                            key={action.key}
                            type="button"
                            disabled={action.disabled}
                            onClick={() => handle_action(action)}
                            className={join_classes(
                                "w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all text-left",
                                action.disabled
                                    ? "cursor-not-allowed opacity-40"
                                    : "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-98",
                                is_destructive ? "text-(--ui-destructive)" : "text-foreground"
                            )}
                        >
                            <HapticContainer disabled={action.disabled}>
                                <span className="flex w-full items-center gap-3.5">
                                    {action.icon != null && (
                                        <span
                                            className={join_classes(
                                                "size-9 rounded-xl border flex items-center justify-center shrink-0",
                                                is_destructive
                                                    ? "border-(--ui-destructive)/20 bg-(--ui-destructive)/10"
                                                    : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5"
                                            )}
                                        >
                                            {action.icon}
                                        </span>
                                    )}

                                    <span className="flex-1 min-w-0">
                                        <span className="flex items-center gap-2">
                                            <Text variant="body" weight="medium" tone="inherit" truncate>
                                                {action.label}
                                            </Text>
                                            {action.badge}
                                        </span>
                                        {action.description != null && (
                                            <Text as="span" variant="caption" tone="secondary" className="block">
                                                {action.description}
                                            </Text>
                                        )}
                                    </span>

                                    {action.trailing != null && <span className="shrink-0">{action.trailing}</span>}
                                </span>
                            </HapticContainer>
                        </button>
                    )
                })}
            </div>

            {cancel_label != null && (
                <div className="shrink-0 pt-1">
                    <Button
                        variant="secondary"
                        shape="none"
                        className="w-full py-2.5 rounded-2xl text-sm font-medium text-center"
                        onClick={on_close}
                    >
                        {cancel_label}
                    </Button>
                </div>
            )}
        </Modal>
    )
}

export { ActionSheet }
