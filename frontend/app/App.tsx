"use client"

import { Terminal as TerminalIcon, Terminal as ExecIcon, Network as NodesIcon } from "lucide-react"
import { useState, useEffect } from "react"
import { TerminalView, ExecView, NodesView, LaunchAnimation } from "@/blocks"
import { ViewSwitcher } from "@/components"
import { session_controller } from "@/core/controllers/session_controller"
import { mount_debug_controllers } from "@/core/controllers/mount"

type ActiveView = "terminal" | "exec" | "nodes"

export default function App() {
    const [active_view, set_active_view] = useState<ActiveView>("terminal")
    const [show_launch_animation, set_show_launch_animation] = useState(true)

    useEffect(() => {
        mount_debug_controllers()
        const cleanup_session = session_controller.start_auto_refresh(10000)
        return () => {
            cleanup_session()
        }
    }, [])

    return (
        <>
            <div className="select-none" {...(show_launch_animation ? { inert: true } : {})}>
                <ViewSwitcher<ActiveView>
                    id="rexec_view_switcher"
                    className="select-none"
                    toolbar_layout="bottom-floating"
                    toolbar_hidden={show_launch_animation}
                    active_view_id={active_view}
                    on_view_change={set_active_view}
                    keep_alive_default={true}
                    views={[
                        {
                            id: "terminal",
                            icon: <TerminalIcon className="size-5" />,
                            native_icon: "terminal",
                            label: "Terminal",
                            swipe_enabled: true,
                            content: <TerminalView />,
                            overscroll_enabled: false
                        },
                        {
                            id: "exec",
                            icon: <ExecIcon className="size-5" />,
                            native_icon: "bolt.fill",
                            label: "Exec",
                            swipe_enabled: true,
                            content: <ExecView />,
                            overscroll_enabled: false
                        },
                        {
                            id: "nodes",
                            icon: <NodesIcon className="size-5" />,
                            native_icon: "server.rack",
                            label: "Nodes",
                            swipe_enabled: true,
                            content: <NodesView />
                        }
                    ]}
                />
            </div>
            {show_launch_animation && <LaunchAnimation on_finish={() => set_show_launch_animation(false)} />}
        </>
    )
}
