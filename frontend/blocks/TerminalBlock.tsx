"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useController } from "@/components/hooks"
import { FloatingModalContainer } from "@/components/composite/ModalContainer"
import { CloseIcon, ChevronDownIcon } from "@/components/icons"
import { pty_controller } from "@/core/controllers/pty_controller"
import { session_controller } from "@/core/controllers/session_controller"
import { vibrate } from "@/infra/device.client"
import { RunIcon, PlusIcon, TrashIcon, RefreshIcon, KeyboardIcon } from "./icons"

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

export function TerminalBlock() {
    const container_ref = useRef<HTMLDivElement>(null)
    const term_ref = useRef<Terminal | null>(null)
    const fit_addon_ref = useRef<FitAddon | null>(null)
    const [is_sessions_modal_open, set_is_sessions_modal_open] = useState(false)
    const [is_accessory_bar_open, set_is_accessory_bar_open] = useState(true)
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
        vibrate()
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
            vibrate()
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
        <div className="flex flex-col h-dvh p-4 gap-2 pb-24 min-h-0">
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
                            onClick={() => {
                                void pty_controller.refresh_sessions()
                                set_is_sessions_modal_open(true)
                            }}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition cursor-pointer text-[11px] truncate"
                        >
                            <span className="truncate">
                                {pty_state.session_id
                                    ? `Session: ${pty_state.session_id.slice(0, 8)}`
                                    : `Sessions (${pty_state.sessions.length})`}
                            </span>
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
                                <RunIcon className="size-3" /> Connect Terminal
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
                    <button
                        type="submit"
                        disabled={!command_input.trim()}
                        className="px-2.5 py-1 rounded bg-foreground text-background font-medium text-xs transition disabled:opacity-25 disabled:pointer-events-none cursor-pointer shrink-0 select-none hover:opacity-90 active:scale-95"
                    >
                        Send
                    </button>
                </form>
            )}

            {/* Accessory Virtual Keys Bar */}
            {is_accessory_bar_open && (
                <div
                    ref={handle_accessory_scroll_ref}
                    className="shrink-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono"
                >
                    {ACCESSORY_KEYS.map((key) => (
                        <button
                            key={key.label}
                            type="button"
                            title={key.title}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => {
                                vibrate()
                                pty_controller.send(key.payload)
                            }}
                            className="px-2.5 py-1 rounded bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 active:bg-black/25 dark:active:bg-white/25 active:scale-95 text-foreground font-medium transition cursor-pointer shrink-0 select-none"
                        >
                            {key.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Sessions Management Modal */}
            {is_sessions_modal_open && (
                <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4"
                    onClick={() => set_is_sessions_modal_open(false)}
                >
                    <FloatingModalContainer
                        className="w-full max-w-lg p-5 gap-3.5"
                        on_escape={() => set_is_sessions_modal_open(false)}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm font-mono">Terminal Sessions</span>
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground">
                                    {pty_state.sessions.length} Available
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => void pty_controller.refresh_sessions()}
                                    disabled={pty_state.is_listing}
                                    title="Refresh sessions"
                                    className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                                >
                                    <RefreshIcon className={`size-3.5 ${pty_state.is_listing ? "animate-spin" : ""}`} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => set_is_sessions_modal_open(false)}
                                    className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                                >
                                    <CloseIcon className="size-4" />
                                </button>
                            </div>
                        </div>

                        {/* List */}
                        <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5 font-mono text-xs">
                            {pty_state.sessions.length === 0 ? (
                                <div className="py-8 text-center text-muted-foreground text-xs font-mono">
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
                                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition ${
                                                is_current
                                                    ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-500/10"
                                                    : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5"
                                            }`}
                                        >
                                            <div className="flex flex-col gap-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className={`size-2 rounded-full shrink-0 ${
                                                            s.status === "attached" ? "bg-emerald-500" : "bg-amber-400"
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
                                                </div>
                                                <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                                                    <span className="capitalize">{s.status}</span>
                                                    {s.status === "detached" && (
                                                        <>
                                                            <span>•</span>
                                                            <span>~{time_left_min}m TTL left</span>
                                                        </>
                                                    )}
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
                                                {!is_current && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            void pty_controller.switch_session(s.session_id)
                                                            set_is_sessions_modal_open(false)
                                                        }}
                                                        className="px-2.5 py-1 rounded-lg bg-foreground text-background font-medium text-xs transition hover:opacity-90 cursor-pointer"
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
                        <div className="pt-2 border-t border-black/10 dark:border-white/10 flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground font-mono">
                                Detached sessions keep running in background.
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    void pty_controller.new_session()
                                    set_is_sessions_modal_open(false)
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background font-medium text-xs font-mono transition hover:opacity-90 cursor-pointer"
                            >
                                <PlusIcon className="size-3" />
                                <span>New Session</span>
                            </button>
                        </div>
                    </FloatingModalContainer>
                </div>
            )}
        </div>
    )
}
