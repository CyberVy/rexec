"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useController } from "@/components/hooks"
import {
    FullscreenModalContainer,
    AnimationContainer,
    BodyPortal,
    view_switcher_controller,
    CloseIcon,
    ChevronDownIcon,
    ButtonGroup,
    BackIcon
} from "@/components"
import { pty_controller } from "@/core/controllers/pty_controller"
import { session_controller } from "@/core/controllers/session_controller"
import { format_entry_size } from "@/core/workspace"
import { NaiveButton } from "@/components/base/Buttons"
import {
    RunIcon,
    PlusIcon,
    TrashIcon,
    RefreshIcon,
    KeyboardIcon,
    FolderIcon,
    FileIcon,
    FolderUpIcon,
    PinIcon
} from "../icons"

function format_display_path(cwd: string | null): string {
    if (!cwd) return "Workspace"
    const segments = cwd.split("/").filter(Boolean)
    if (segments.length <= 2) return cwd
    return `.../${segments.slice(-2).join("/")}`
}

interface AccessoryKey {
    label: string
    payload: string
    title?: string
}

const ACCESSORY_KEYS: AccessoryKey[] = [
    { label: "ESC", payload: "\x1b", title: "Escape" },
    { label: "TAB", payload: "\t", title: "Tab" },
    { label: "ENTER", payload: "\r", title: "Enter" },
    { label: "^C", payload: "\x03", title: "Interrupt (SIGINT)" },
    { label: "←", payload: "\x1b[D", title: "Left" },
    { label: "→", payload: "\x1b[C", title: "Right" },
    { label: "↑", payload: "\x1b[A", title: "Up" },
    { label: "↓", payload: "\x1b[B", title: "Down" },
    { label: "^D", payload: "\x04", title: "EOF (Exit)" },
    { label: "^Z", payload: "\x1a", title: "Suspend (SIGTSTP)" },
    { label: "^L", payload: "\x0c", title: "Clear Screen" },
    { label: "HOME", payload: "\x1b[H", title: "Line Start" },
    { label: "END", payload: "\x1b[F", title: "Line End" },
    { label: "PGUP", payload: "\x1b[5~", title: "Page Up" },
    { label: "PGDN", payload: "\x1b[6~", title: "Page Down" },
    { label: "|", payload: "|", title: "Pipe" },
    { label: "~", payload: "~", title: "Tilde" },
    { label: "/", payload: "/", title: "Slash" },
    { label: "-", payload: "-", title: "Dash" },
    { label: "_", payload: "_", title: "Underscore" }
]

export function TerminalView() {
    const container_ref = useRef<HTMLDivElement>(null)
    const term_ref = useRef<Terminal | null>(null)
    const fit_addon_ref = useRef<FitAddon | null>(null)
    const [is_sessions_modal_open, set_is_sessions_modal_open] = useState(false)
    const [is_workspace_modal_open, set_is_workspace_modal_open] = useState(false)
    const [is_accessory_bar_open, set_is_accessory_bar_open] = useState(true)

    const handle_open_sessions_modal = useCallback(() => {
        void pty_controller.refresh_sessions()
        set_is_sessions_modal_open((prev) => {
            if (prev) return prev
            view_switcher_controller.hide_all_toolbars()
            return true
        })
    }, [])

    const handle_close_sessions_modal = useCallback(() => {
        set_is_sessions_modal_open((prev) => {
            if (!prev) return prev
            view_switcher_controller.show_all_toolbars()
            return false
        })
    }, [])

    const handle_open_workspace_modal = useCallback(() => {
        void pty_controller.load_directory(pty_controller.state.cwd ?? undefined)
        set_is_workspace_modal_open((prev) => {
            if (prev) return prev
            view_switcher_controller.hide_all_toolbars()
            return true
        })
    }, [])

    const handle_close_workspace_modal = useCallback(() => {
        set_is_workspace_modal_open((prev) => {
            if (!prev) return prev
            view_switcher_controller.show_all_toolbars()
            return false
        })
    }, [])

    useEffect(() => {
        return () => {
            if (is_sessions_modal_open) {
                view_switcher_controller.show_all_toolbars()
            }
        }
    }, [is_sessions_modal_open])

    useEffect(() => {
        return () => {
            if (is_workspace_modal_open) {
                view_switcher_controller.show_all_toolbars()
            }
        }
    }, [is_workspace_modal_open])
    const [command_input, set_command_input] = useState("")
    const [command_history, set_command_history] = useState<string[]>([])
    const [history_index, set_history_index] = useState(-1)
    const command_draft_ref = useRef("")
    const command_input_ref = useRef<HTMLInputElement>(null)

    const pty_state = useController(pty_controller, {
        events: ["change", "ready", "exit"]
    })

    const session_state = useController(session_controller, {
        events: ["change", "status_change"]
    })

    useEffect(() => {
        void pty_controller.refresh_sessions()
        if (session_state.agent_online && !pty_controller.state.cwd) {
            void pty_controller.load_directory()
        }
    }, [session_state.agent_online])

    useEffect(() => {
        if (!container_ref.current) return

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            theme: {
                background: "#09090b",
                foreground: "#fafafa",
                cursor: "#10b981",
                selectionBackground: "#27272a",
                black: "#18181b",
                red: "#ef4444",
                green: "#10b981",
                yellow: "#f59e0b",
                blue: "#3b82f6",
                magenta: "#ec4899",
                cyan: "#06b6d4",
                white: "#f4f4f5",
                brightBlack: "#71717a",
                brightRed: "#f87171",
                brightGreen: "#34d399",
                brightYellow: "#fbbf24",
                brightBlue: "#60a5fa",
                brightMagenta: "#f472b6",
                brightCyan: "#22d3ee",
                brightWhite: "#ffffff"
            }
        })

        const fit_addon = new FitAddon()
        term.loadAddon(fit_addon)
        term.open(container_ref.current)

        term_ref.current = term
        fit_addon_ref.current = fit_addon

        // Initial fit
        const fit_timer = setTimeout(() => {
            try {
                fit_addon.fit()
                pty_controller.resize(term.cols, term.rows)
            } catch {
                // Ignore initial fit race
            }
        }, 50)

        // Wire incoming data from PTY
        const remove_data_listener = pty_controller.on_data((bytes) => {
            term.write(bytes)
        })

        // Wire user typing to PTY
        const on_data_sub = term.onData((data) => {
            pty_controller.send(data)
        })

        // Wire terminal resize to PTY
        const on_resize_sub = term.onResize(({ cols, rows }) => {
            pty_controller.resize(cols, rows)
        })

        // Wire OSC 7 current working directory notifications
        const osc7_sub = term.parser.registerOscHandler(7, (data) => {
            pty_controller.update_cwd_from_osc7(data)
            return true
        })

        // Window resize observer
        const resize_observer = new ResizeObserver(() => {
            try {
                fit_addon.fit()
                if (term.cols > 0 && term.rows > 0) {
                    pty_controller.resize(term.cols, term.rows)
                }
            } catch {
                // Ignore observer disconnect
            }
        })
        resize_observer.observe(container_ref.current)

        return () => {
            clearTimeout(fit_timer)
            remove_data_listener()
            on_data_sub.dispose()
            on_resize_sub.dispose()
            osc7_sub.dispose()
            resize_observer.disconnect()
            term.dispose()
            term_ref.current = null
            fit_addon_ref.current = null
        }
    }, [])

    const handle_connect = () => {
        const cols = term_ref.current?.cols ?? 80
        const rows = term_ref.current?.rows ?? 24
        void pty_controller.connect({ cols, rows })
    }

    const handle_disconnect = () => {
        pty_controller.disconnect()
    }

    const handle_clear = () => {
        term_ref.current?.clear()
    }

    const handle_command_submit = (e: React.FormEvent) => {
        e.preventDefault()
        const trimmed = command_input
        if (!trimmed) return
        pty_controller.send(trimmed + "\n")
        set_command_history((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, 50))
        set_history_index(-1)
        command_draft_ref.current = ""
        set_command_input("")
    }

    const handle_command_keydown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowUp") {
            e.preventDefault()
            if (command_history.length === 0) return
            const next_index = Math.min(history_index + 1, command_history.length - 1)
            if (history_index === -1) {
                command_draft_ref.current = command_input
            }
            set_history_index(next_index)
            set_command_input(command_history[next_index] ?? "")
        } else if (e.key === "ArrowDown") {
            e.preventDefault()
            if (history_index <= 0) {
                set_history_index(-1)
                set_command_input(command_draft_ref.current)
                return
            }
            const next_index = history_index - 1
            set_history_index(next_index)
            set_command_input(command_history[next_index] ?? "")
        }
    }

    const handle_paste_event = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData("text")
        if (text.includes("\n")) {
            e.preventDefault()
            if (term_ref.current) {
                term_ref.current.paste(text)
            } else {
                pty_controller.send(text)
            }
        }
    }

    const handle_accessory_scroll_ref = useCallback((scroll_container: HTMLDivElement | null) => {
        if (!scroll_container) return

        const stop_touch_propagation = (e: TouchEvent) => {
            e.stopPropagation()
        }

        scroll_container.addEventListener("touchstart", stop_touch_propagation, { passive: true })
        scroll_container.addEventListener("touchmove", stop_touch_propagation, { passive: true })

        return () => {
            scroll_container.removeEventListener("touchstart", stop_touch_propagation)
            scroll_container.removeEventListener("touchmove", stop_touch_propagation)
        }
    }, [])

    return (
        <div className="flex flex-col h-[calc(100vh-env(safe-area-inset-top))] p-4 gap-2 pb-24 min-h-0">
            {/* Terminal Top Control Bar */}
            <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono shrink-0">
                {/* Row 1: Status & Context */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex items-center gap-1.5 shrink-0">
                            <span
                                className={`size-2 rounded-full ${
                                    pty_state.status === "connected"
                                        ? "bg-emerald-500 animate-pulse"
                                        : pty_state.status === "connecting"
                                          ? "bg-amber-400 animate-ping"
                                          : "bg-zinc-500"
                                }`}
                            />
                            <span className="capitalize text-foreground font-medium">{pty_state.status}</span>
                        </div>

                        {/* Session Selector Capsule */}
                        <button
                            type="button"
                            onClick={handle_open_sessions_modal}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition cursor-pointer text-[11px] truncate shrink-0"
                        >
                            <span className="truncate">
                                {pty_state.session_id
                                    ? `Session: ${pty_state.session_id.slice(0, 8)}`
                                    : `Sessions (${pty_state.sessions.length})`}
                            </span>
                            <ChevronDownIcon className="size-3 shrink-0" />
                        </button>

                        {/* Workspace Folder Capsule */}
                        <button
                            type="button"
                            onClick={handle_open_workspace_modal}
                            disabled={!session_state.agent_online && !pty_state.cwd}
                            title={pty_state.cwd ? `Current workspace: ${pty_state.cwd}` : "Browse workspace folder"}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 text-muted-foreground hover:text-foreground transition cursor-pointer text-[11px] min-w-0 max-w-[200px] sm:max-w-[320px]"
                        >
                            <FolderIcon className="size-3 shrink-0" />
                            <span className="truncate">{format_display_path(pty_state.cwd)}</span>
                            <ChevronDownIcon className="size-3 shrink-0" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {pty_state.exit_code !== null && (
                            <span className="text-[11px] text-amber-500">Exited with code {pty_state.exit_code}</span>
                        )}

                        {pty_state.error && (
                            <span className="text-[11px] text-red-400 truncate max-w-[140px]">{pty_state.error}</span>
                        )}
                    </div>
                </div>

                {/* Row 2: Action Controls */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-black/5 dark:border-white/5">
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => set_is_accessory_bar_open((prev) => !prev)}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition cursor-pointer ${
                                is_accessory_bar_open
                                    ? "bg-black/15 dark:bg-white/15 text-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                            }`}
                            title={is_accessory_bar_open ? "Hide virtual keys" : "Show virtual keys"}
                        >
                            <KeyboardIcon className="size-3" />
                            <span>Keys</span>
                        </button>

                        <button
                            type="button"
                            onClick={handle_clear}
                            className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                        >
                            Clear
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        {pty_state.status === "connected" || pty_state.status === "connecting" ? (
                            <button
                                type="button"
                                onClick={handle_disconnect}
                                className="px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 text-white font-medium text-xs transition cursor-pointer"
                            >
                                Disconnect
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handle_connect}
                                disabled={!session_state.agent_online && !session_state.is_checking}
                                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium text-xs transition flex items-center gap-1.5 cursor-pointer"
                            >
                                <RunIcon className="size-3" /> Connect
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* XTerm Container */}
            <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden border border-zinc-800 bg-[#09090b] shadow-inner p-2">
                <div ref={container_ref} className="absolute inset-2" />

                {pty_state.status === "disconnected" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs gap-3.5 z-10 p-4">
                        <div className="text-zinc-300 text-sm font-mono font-medium">
                            Interactive Remote Terminal (PTY)
                        </div>

                        {pty_state.sessions.filter((s) => s.status === "detached").length > 0 ? (
                            <div className="flex flex-col items-center gap-2.5 max-w-sm w-full">
                                <div className="text-xs text-zinc-400 font-mono">Available Detached Sessions:</div>
                                <div className="w-full space-y-2">
                                    {pty_state.sessions
                                        .filter((s) => s.status === "detached")
                                        .slice(0, 3)
                                        .map((s) => (
                                            <div
                                                key={s.session_id}
                                                className="p-2.5 rounded-lg border border-white/10 bg-white/5 flex items-center justify-between gap-2 font-mono text-xs"
                                            >
                                                <div className="flex items-center gap-2 truncate">
                                                    <span className="size-2 rounded-full bg-amber-400 shrink-0" />
                                                    <span className="text-zinc-200 font-medium truncate">
                                                        {s.command || "shell"}
                                                    </span>
                                                    <span className="text-zinc-500 text-[11px]">
                                                        ({s.session_id.slice(0, 6)})
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void pty_controller.connect({ session_id: s.session_id })
                                                    }
                                                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shrink-0 cursor-pointer transition"
                                                >
                                                    Resume
                                                </button>
                                            </div>
                                        ))}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <button
                                        type="button"
                                        onClick={handle_connect}
                                        disabled={!session_state.agent_online}
                                        className="px-3.5 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 text-zinc-200 font-medium text-xs font-mono transition cursor-pointer"
                                    >
                                        New Shell Session
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handle_connect}
                                disabled={!session_state.agent_online}
                                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium text-xs font-mono transition shadow-lg flex items-center gap-2 cursor-pointer"
                            >
                                <RunIcon className="size-3" />
                                {session_state.agent_online
                                    ? "Open Terminal Session"
                                    : "Waiting for Agent to Connect..."}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Native Command Input Bar */}
            {pty_state.status === "connected" && (
                <form
                    onSubmit={handle_command_submit}
                    className="shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono"
                >
                    <span className="text-muted-foreground select-none shrink-0 font-bold">$</span>
                    <input
                        ref={command_input_ref}
                        type="text"
                        value={command_input}
                        onChange={(e) => {
                            set_command_input(e.target.value)
                            if (history_index !== -1) {
                                set_history_index(-1)
                            }
                        }}
                        onKeyDown={handle_command_keydown}
                        onPaste={handle_paste_event}
                        placeholder="Type command or paste..."
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className="flex-1 bg-transparent border-none outline-hidden text-foreground placeholder:text-muted-foreground text-xs font-mono min-w-0"
                    />
                    <NaiveButton
                        type="submit"
                        disabled={!command_input.trim()}
                        className="px-2.5 py-1 rounded bg-foreground text-background font-medium text-xs hover:opacity-90 disabled:opacity-25 disabled:pointer-events-none shrink-0"
                    >
                        Send
                    </NaiveButton>
                </form>
            )}

            {/* Accessory Virtual Keys Bar */}
            {is_accessory_bar_open && (
                <div
                    ref={handle_accessory_scroll_ref}
                    className="shrink-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono"
                >
                    {ACCESSORY_KEYS.map((key) => (
                        <NaiveButton
                            key={key.label}
                            type="button"
                            title={key.title}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => {
                                pty_controller.send(key.payload)
                            }}
                            className="px-2.5 py-1 rounded bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 active:bg-black/25 dark:active:bg-white/25 text-foreground font-medium shrink-0"
                        >
                            {key.label}
                        </NaiveButton>
                    ))}
                </div>
            )}

            {/* Sessions Management Fullscreen Modal */}
            <BodyPortal>
                <AnimationContainer
                    enter_from={{ transform: "translateY(100vh)" }}
                    enter_to={{ transform: "translateY(0)" }}
                    show={is_sessions_modal_open}
                    unmount_on_exit={true}
                    duration={250}
                    className="fixed inset-0 z-50"
                >
                    <FullscreenModalContainer
                        enable_escape={is_sessions_modal_open}
                        on_escape={handle_close_sessions_modal}
                        className="bg-background/95 backdrop-blur-2xl text-foreground pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] px-4 sm:px-6"
                    >
                        <div className="w-full max-w-2xl mx-auto flex flex-col gap-4 py-4">
                            <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
                                <div className="flex items-center gap-2.5">
                                    <span className="font-semibold text-base font-mono">Terminal Sessions</span>
                                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground">
                                        {pty_state.sessions.length} Available
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void pty_controller.refresh_sessions()}
                                        disabled={pty_state.is_listing}
                                        title="Refresh sessions"
                                        className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                                    >
                                        <RefreshIcon
                                            className={`size-4 ${pty_state.is_listing ? "animate-spin" : ""}`}
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handle_close_sessions_modal}
                                        className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                                        title="Close"
                                    >
                                        <CloseIcon className="size-5" />
                                    </button>
                                </div>
                            </div>

                            {/* List */}
                            <div className="space-y-2.5 font-mono text-xs">
                                {pty_state.sessions.length === 0 ? (
                                    <div className="py-16 text-center text-muted-foreground text-xs font-mono border border-dashed border-black/10 dark:border-white/10 rounded-xl">
                                        No active or detached sessions on remote agent.
                                    </div>
                                ) : (
                                    pty_state.sessions.map((s) => {
                                        const is_current =
                                            s.session_id === pty_state.session_id && pty_state.status === "connected"
                                        const time_left_min = Math.max(
                                            0,
                                            Math.ceil((s.remaining_ttl_ms ?? s.orphan_ttl_ms) / 60000)
                                        )
                                        return (
                                            <div
                                                key={s.session_id}
                                                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition ${
                                                    is_current
                                                        ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-500/10"
                                                        : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5"
                                                }`}
                                            >
                                                <div className="flex flex-col gap-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className={`size-2 rounded-full shrink-0 ${
                                                                s.status === "attached"
                                                                    ? "bg-emerald-500"
                                                                    : "bg-amber-400"
                                                            }`}
                                                        />
                                                        <span className="font-bold text-foreground truncate">
                                                            {s.command || "shell"}
                                                        </span>
                                                        <span className="text-[11px] text-muted-foreground">
                                                            ({s.session_id.slice(0, 8)})
                                                        </span>
                                                        {is_current && (
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                                                                Active
                                                            </span>
                                                        )}
                                                        {s.persistent && (
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/10 text-foreground/80 font-medium">
                                                                Persistent
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                                                        <span className="capitalize">{s.status}</span>
                                                        {s.persistent ? (
                                                            <>
                                                                <span>•</span>
                                                                <span>No TTL</span>
                                                            </>
                                                        ) : s.status === "detached" ? (
                                                            <>
                                                                <span>•</span>
                                                                <span>~{time_left_min}m TTL left</span>
                                                            </>
                                                        ) : null}
                                                        {s.buffered_bytes > 0 && (
                                                            <>
                                                                <span>•</span>
                                                                <span>
                                                                    {Math.round(s.buffered_bytes / 1024)} KB buffered
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void pty_controller.set_session_persistent(
                                                                s.session_id,
                                                                !s.persistent
                                                            )
                                                        }
                                                        title={
                                                            s.persistent
                                                                ? "Disable persistence (restore 10m orphan TTL)"
                                                                : "Enable persistence (keep alive indefinitely)"
                                                        }
                                                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono transition cursor-pointer flex items-center gap-1.5 ${
                                                            s.persistent
                                                                ? "border-black/30 dark:border-white/30 bg-black/10 dark:bg-white/15 text-foreground font-medium"
                                                                : "border-black/10 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                                                        }`}
                                                    >
                                                        <PinIcon className="size-3" />
                                                    </button>
                                                    {!is_current && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                void pty_controller.switch_session(s.session_id)
                                                                handle_close_sessions_modal()
                                                            }}
                                                            className="px-3 py-1.5 rounded-lg bg-foreground text-background font-medium text-xs transition hover:opacity-90 cursor-pointer"
                                                        >
                                                            Attach
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => void pty_controller.kill_session(s.session_id)}
                                                        title="Kill session process"
                                                        className="p-1.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-red-500/10 hover:text-red-400 text-muted-foreground transition cursor-pointer"
                                                    >
                                                        <TrashIcon className="size-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            {/* Footer Action */}
                            <div className="pt-3 border-t border-black/10 dark:border-white/10 flex items-center justify-between">
                                <span className="text-[11px] text-muted-foreground font-mono">
                                    Detached sessions keep running in background.
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        void pty_controller.new_session()
                                        handle_close_sessions_modal()
                                    }}
                                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-foreground text-background font-medium text-xs font-mono transition hover:opacity-90 cursor-pointer"
                                >
                                    <PlusIcon className="size-3.5" />
                                    <span>New</span>
                                </button>
                            </div>
                        </div>
                    </FullscreenModalContainer>

                    <ButtonGroup
                        className="fixed text-2xl bottom-17 right-4 z-1 rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-xl shadow-sm p-1"
                        items={[
                            {
                                content: <BackIcon key="back" />,
                                className: "w-10 h-10",
                                on_click: handle_close_sessions_modal
                            }
                        ]}
                    />
                </AnimationContainer>
            </BodyPortal>

            {/* Workspace Folder Explorer Fullscreen Modal */}
            <BodyPortal>
                <AnimationContainer
                    enter_from={{ transform: "translateY(100vh)" }}
                    enter_to={{ transform: "translateY(0)" }}
                    show={is_workspace_modal_open}
                    unmount_on_exit={true}
                    duration={250}
                    className="fixed inset-0 z-50"
                >
                    <FullscreenModalContainer
                        enable_escape={is_workspace_modal_open}
                        on_escape={handle_close_workspace_modal}
                        className="bg-background/95 backdrop-blur-2xl text-foreground pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] px-4 sm:px-6"
                    >
                        <div className="w-full max-w-2xl mx-auto flex flex-col gap-4 py-4">
                            {/* Header */}
                            <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
                                <div className="flex items-center gap-2">
                                    <FolderIcon className="size-5 text-foreground shrink-0" />
                                    <span className="font-semibold text-base font-mono">Workspace Explorer</span>
                                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground">
                                        {pty_state.dir_entries.length} Items
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void pty_controller.load_directory()}
                                        disabled={pty_state.is_loading_dir}
                                        title="Refresh directory"
                                        className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                                    >
                                        <RefreshIcon
                                            className={`size-4 ${pty_state.is_loading_dir ? "animate-spin" : ""}`}
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handle_close_workspace_modal}
                                        className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                                        title="Close"
                                    >
                                        <CloseIcon className="size-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Current Path Bar */}
                            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 font-mono text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                    <button
                                        type="button"
                                        onClick={() => void pty_controller.navigate_parent_directory()}
                                        disabled={
                                            pty_state.is_loading_dir ||
                                            !pty_state.dir_path ||
                                            pty_state.dir_path === "/"
                                        }
                                        title="Parent directory (..)"
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40 text-foreground transition cursor-pointer shrink-0 text-[11px]"
                                    >
                                        <FolderUpIcon className="size-3.5" />
                                        <span>..</span>
                                    </button>
                                    <span
                                        className="truncate text-foreground font-medium select-text"
                                        title={pty_state.dir_path ?? pty_state.cwd ?? "/"}
                                    >
                                        {pty_state.dir_path ?? pty_state.cwd ?? "/"}
                                    </span>
                                </div>

                                {pty_state.status === "connected" &&
                                    pty_state.dir_path &&
                                    pty_state.dir_path !== pty_state.cwd && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (pty_state.dir_path) {
                                                    pty_controller.cd_to_directory(pty_state.dir_path)
                                                    handle_close_workspace_modal()
                                                }
                                            }}
                                            className="px-3 py-1 rounded-lg bg-foreground text-background font-medium text-xs hover:opacity-90 transition cursor-pointer shrink-0"
                                        >
                                            cd Here
                                        </button>
                                    )}
                            </div>

                            {/* Directory Entries List */}
                            <div className="space-y-1.5 font-mono text-xs">
                                {pty_state.dir_error ? (
                                    <div className="py-8 px-4 text-center text-muted-foreground text-xs font-mono border border-black/10 dark:border-white/10 rounded-xl">
                                        {pty_state.dir_error}
                                    </div>
                                ) : pty_state.is_loading_dir && pty_state.dir_entries.length === 0 ? (
                                    <div className="py-12 text-center text-muted-foreground text-xs font-mono">
                                        Loading directory contents...
                                    </div>
                                ) : pty_state.dir_entries.length === 0 ? (
                                    <div className="py-12 text-center text-muted-foreground text-xs font-mono border border-dashed border-black/10 dark:border-white/10 rounded-xl">
                                        Directory is empty.
                                    </div>
                                ) : (
                                    pty_state.dir_entries.map((entry) => (
                                        <div
                                            key={entry.path}
                                            onClick={() => {
                                                if (entry.is_directory) {
                                                    void pty_controller.load_directory(entry.path)
                                                }
                                            }}
                                            className={`px-3.5 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex items-center justify-between gap-3 transition ${
                                                entry.is_directory
                                                    ? "hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
                                                    : ""
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                {entry.is_directory ? (
                                                    <FolderIcon className="size-4 text-foreground shrink-0" />
                                                ) : (
                                                    <FileIcon className="size-4 text-muted-foreground shrink-0" />
                                                )}
                                                <div className="flex flex-col min-w-0">
                                                    <span
                                                        className={`truncate ${
                                                            entry.is_directory
                                                                ? "font-semibold text-foreground"
                                                                : "text-foreground/90"
                                                        }`}
                                                    >
                                                        {entry.name}
                                                        {entry.is_directory ? "/" : ""}
                                                    </span>
                                                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                                                        <span>{entry.permissions}</span>
                                                        <span>•</span>
                                                        <span>{entry.mtime_label}</span>
                                                        {!entry.is_directory && (
                                                            <>
                                                                <span>•</span>
                                                                <span>{format_entry_size(entry.size)}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {entry.is_directory && pty_state.status === "connected" && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        pty_controller.cd_to_directory(entry.path)
                                                        handle_close_workspace_modal()
                                                    }}
                                                    title={`cd into ${entry.name}`}
                                                    className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-foreground hover:text-background text-foreground font-medium text-xs transition shrink-0 cursor-pointer"
                                                >
                                                    cd
                                                </button>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Footer */}
                            <div className="pt-3 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-muted-foreground font-mono truncate">
                                    Terminal CWD: {pty_state.cwd ?? "Not connected"}
                                </span>
                                {pty_state.cwd && pty_state.dir_path && pty_state.dir_path !== pty_state.cwd && (
                                    <button
                                        type="button"
                                        onClick={() => void pty_controller.load_directory(pty_state.cwd ?? undefined)}
                                        className="px-3 py-1.5 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 text-foreground font-medium text-xs font-mono transition shrink-0 cursor-pointer"
                                    >
                                        Reset to Terminal CWD
                                    </button>
                                )}
                            </div>
                        </div>
                    </FullscreenModalContainer>

                    <ButtonGroup
                        className="fixed text-2xl bottom-17 right-4 z-1 rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-xl shadow-sm p-1"
                        items={[
                            {
                                content: <BackIcon key="back" />,
                                className: "w-10 h-10",
                                on_click: handle_close_workspace_modal
                            }
                        ]}
                    />
                </AnimationContainer>
            </BodyPortal>
        </div>
    )
}
