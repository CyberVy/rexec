"use client"

import { useState } from "react"
import { NaiveButton } from "../base/Buttons"
import { MigrationService } from "@/infra"
import type { TargetDatabasesConfig } from "@/infra/migration.client"
import { BodyPortal } from "@/components/base/Portal"
import { FloatingModalContainer } from "@/components/composite/ModalContainer"
import { AnimationContainer } from "@/components/animation/AnimationContainer"
import { string_icons } from "@/components/ui_constants"
import type { ReactNode } from "react"

type MigrationAlertModalProps = {
    show: boolean
    message: ReactNode
    title?: string
    on_close: () => void
}

function MigrationAlertModal({ show, message, title = "Notice", on_close }: MigrationAlertModalProps) {
    return (
        <BodyPortal>
            {/* Backdrop */}
            <AnimationContainer
                show={show}
                enter_from={{ opacity: 0 }}
                enter_to={{ opacity: 1 }}
                exit_from={{ opacity: 1 }}
                exit_to={{ opacity: 0 }}
                duration={250}
                unmount_on_exit={true}
                className="fixed inset-0 z-100 bg-black/40 dark:bg-black/60 backdrop-blur-xs cursor-pointer"
                onClick={on_close}
            >
                <div className="w-full h-full" />
            </AnimationContainer>

            {/* Modal dialog */}
            <AnimationContainer
                show={show}
                enter_from={{ transform: "scale(0)", opacity: 1 }}
                enter_to={{ transform: "scale(1)", opacity: 1 }}
                exit_from={{ transform: "scale(1)", opacity: 1 }}
                exit_to={{ transform: "scale(0)", opacity: 1 }}
                duration={250}
                unmount_on_exit={true}
                className="fixed inset-0 z-101 flex items-center justify-center pointer-events-none p-4"
            >
                <FloatingModalContainer on_escape={on_close} className="w-80 min-h-40 p-3 select-none">
                    <div className="flex flex-col justify-between h-full w-full p-2">
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-2 mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-black/85 dark:text-white/85">{title}</span>
                            </div>
                            <NaiveButton
                                className="w-7 h-7 rounded-full border border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-xs"
                                on_click={on_close}
                            >
                                {string_icons.close}
                            </NaiveButton>
                        </div>
                        {/* Content */}
                        <div className="text-xs text-black/70 dark:text-white/70 leading-relaxed mb-4 whitespace-pre-wrap grow flex items-center justify-center text-center px-2">
                            {message}
                        </div>
                        {/* Action */}
                        <div className="flex justify-end pt-2 border-t border-black/5 dark:border-white/5">
                            <NaiveButton
                                className="w-16 h-7.5 text-xs font-semibold border border-black/10 dark:border-white/10 rounded-xl bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                                on_click={on_close}
                            >
                                OK
                            </NaiveButton>
                        </div>
                    </div>
                </FloatingModalContainer>
            </AnimationContainer>
        </BodyPortal>
    )
}

function useMigrationAlert() {
    const [open, set_open] = useState(false)
    const [title, set_title] = useState("")
    const [message, set_message] = useState("")
    const [on_close, set_on_close] = useState<(() => void) | null>(null)

    const trigger_alert = (new_title: string, new_message: string, on_close?: () => void) => {
        set_title(new_title)
        set_message(new_message)
        set_on_close(() => on_close || null)
        set_open(true)
    }

    const handle_close = () => {
        set_open(false)
        if (on_close) {
            on_close()
        }
    }

    const alert_element = <MigrationAlertModal show={open} title={title} message={message} on_close={handle_close} />

    return { trigger_alert, alert_element }
}

export type MigrationExportProps = {
    app_id: string
    app_version: string
    target_databases: TargetDatabasesConfig
    className?: string
    children?: ReactNode
}

export function MigrationExport({
    app_id,
    app_version,
    target_databases,
    className = "w-28 h-7.5 border border-black/10 dark:border-white/10 rounded-xl bg-transparent hover:bg-black/5 dark:hover:bg-white/5",
    children = <span className="text-xs font-medium">Export Backup</span>
}: MigrationExportProps) {
    const handle_export = async () => {
        await MigrationService.export_file(app_id, app_version, target_databases)
    }

    return (
        <NaiveButton className={className} on_click={handle_export}>
            {children}
        </NaiveButton>
    )
}

export type MigrationMergeProps = {
    app_id: string
    merge_rules?: Record<string, { identity_key: string | string[] }>
    className?: string
    children?: ReactNode
}

export function MigrationMerge({
    app_id,
    merge_rules,
    className = "w-16 h-7.5 border border-black/10 dark:border-white/10 rounded-xl bg-transparent hover:bg-black/5 dark:hover:bg-white/5",
    children = <span className="text-xs font-medium">Merge</span>
}: MigrationMergeProps) {
    const { trigger_alert, alert_element } = useMigrationAlert()

    const handle_import = async () => {
        const content = await MigrationService.read_file()
        if (!content) return

        const options = {
            mode: "merge" as const,
            merge_rules
        }

        const result = await MigrationService.restore_from_backup_data(content, app_id, options)
        if (result.success) {
            trigger_alert(
                "Restore Success",
                `Backup restored successfully. And ${app_id} will reload to apply changes.`,
                () => {
                    window.location.reload()
                }
            )
        } else {
            trigger_alert("Restore Failed", "Restore failed: " + (result.error || "Unknown error"))
        }
    }

    return (
        <>
            <NaiveButton className={className} on_click={handle_import}>
                {children}
            </NaiveButton>
            {alert_element}
        </>
    )
}

export type MigrationOverwriteProps = {
    app_id: string
    className?: string
    children?: ReactNode
}

export function MigrationOverwrite({
    app_id,
    className = "w-20 h-7.5 border border-red-500/20 rounded-xl bg-transparent hover:bg-red-500/10",
    children = <span className="text-xs font-medium text-red-600 dark:text-red-400">Overwrite</span>
}: MigrationOverwriteProps) {
    const { trigger_alert, alert_element } = useMigrationAlert()

    const handle_import = async () => {
        const content = await MigrationService.read_file()
        if (!content) return

        const options = {
            mode: "overwrite" as const
        }

        const result = await MigrationService.restore_from_backup_data(content, app_id, options)
        if (result.success) {
            trigger_alert(
                "Restore Success",
                `Backup restored successfully! And ${app_id} will reload to apply changes.`,
                () => {
                    window.location.reload()
                }
            )
        } else {
            trigger_alert("Restore Failed", "Restore failed: " + (result.error || "Unknown error"))
        }
    }

    return (
        <>
            <NaiveButton className={className} on_click={handle_import}>
                {children}
            </NaiveButton>
            {alert_element}
        </>
    )
}
