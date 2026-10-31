"use client"

import { useState, useEffect } from "react"
import { TerminalBlock, ExecBlock, NodesBlock, TerminalIcon, ExecIcon, NodesIcon } from "@/blocks"
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
        <main className="select-none h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
            <ViewSwitcher<ActiveView>
                id="rexec_view_switcher"
                className="w-full h-full flex flex-col min-h-0"
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
                        content: <TerminalBlock />
                    },
                    {
                        id: "exec",
                        icon: <ExecIcon className="size-5" />,
                        label: "Exec",
                        swipe_enabled: true,
                        content: <ExecBlock />
                    },
                    {
                        id: "nodes",
                        icon: <NodesIcon className="size-5" />,
                        label: "Nodes",
                        swipe_enabled: true,
                        content: <NodesBlock />
                    }
                ]}
            />
        </main>
    )
}
