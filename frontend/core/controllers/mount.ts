import { session_controller } from "./session_controller"
import { exec_controller } from "./exec_controller"
import { pty_controller } from "./pty_controller"

export const debug_controllers = {
    session: session_controller,
    exec: exec_controller,
    pty: pty_controller,

    session_controller,
    exec_controller,
    pty_controller,

    dump_state: () => ({
        session: session_controller.state,
        exec: exec_controller.state,
        pty: pty_controller.state
    })
}

export type DebugControllers = typeof debug_controllers

export function mount_debug_controllers(): void {
    if (typeof window === "undefined") return

    ;(window as any).__controllers__ = debug_controllers
    ;(window as any).controllers = debug_controllers
}
