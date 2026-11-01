"use client"

import { useState, useEffect } from "react"
import { TerminalView, ExecView, NodesView, TerminalIcon, ExecIcon, NodesIcon } from "@/blocks"
import { ViewSwitcher } from "@/components"
import { session_controller } from "@/core/controllers/session_controller"
import { mount_debug_controllers } from "@/core/controllers/mount"

type ActiveView = "terminal" | "exec" | "nodes"

export default function App() {
    const [active_view, set_active_view] = useState<ActiveView>("terminal")

    useEffect(() => {
        mount_debug_controllers()
        const cleanup_session = session_controller.start_auto_refresh(10000)
        return () => {
            cleanup_session()
        }
    }, [])

    return (
        <ViewSwitcher<ActiveView>
            id="rexec_view_switcher"
            className="select-none"
            toolbar_layout="bottom-floating"
            active_view_id={active_view}
            on_view_change={set_active_view}
            keep_alive_default={true}
            views={[
                {
                    id: "terminal",
                    icon: <TerminalIcon className="size-5" />,
                    label: "Terminal",
                    swipe_enabled: true,
                    content: <TerminalView />
                },
                {
                    id: "exec",
                    icon: <ExecIcon className="size-5" />,
                    label: "Exec",
                    swipe_enabled: true,
                    content: <ExecView />
                },
                {
                    id: "nodes",
                    icon: <NodesIcon className="size-5" />,
                    label: "Nodes",
                    swipe_enabled: true,
                    content: <NodesView />
                }
            ]}
        />
    )
}
