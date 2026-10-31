"use client"

import { useEffect, useRef } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useController } from "@/components/hooks"
import { pty_controller } from "@/core/controllers/pty_controller"
import { session_controller } from "@/core/controllers/session_controller"
import { RunIcon } from "./icons"

export function TerminalBlock() {
    const container_ref = useRef<HTMLDivElement>(null)
    const term_ref = useRef<Terminal | null>(null)
    const fit_addon_ref = useRef<FitAddon | null>(null)

    const pty_state = useController(pty_controller, {
        events: ["change", "ready", "exit"]
    })

    const session_state = useController(session_controller, {
        events: ["change", "status_change"]
    })

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
        pty_controller.connect({ cols, rows })
    }

    const handle_disconnect = () => {
        pty_controller.disconnect()
    }

    const handle_clear = () => {
        term_ref.current?.clear()
    }

    return (
        <div className="flex flex-col h-dvh p-4 gap-2 pb-24 min-h-0">
            {/* Terminal Top Control Bar */}
            <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono shrink-0">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
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

                    {pty_state.session_id && (
                        <span className="text-[11px] text-muted-foreground hidden sm:inline">
                            Session: <span className="text-foreground">{pty_state.session_id.slice(0, 8)}</span>
                        </span>
                    )}

                    {pty_state.exit_code !== null && (
                        <span className="text-[11px] text-amber-500">Exited with code {pty_state.exit_code}</span>
                    )}

                    {pty_state.error && <span className="text-[11px] text-red-400">{pty_state.error}</span>}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handle_clear}
                        className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition"
                    >
                        Clear
                    </button>

                    {pty_state.status === "connected" || pty_state.status === "connecting" ? (
                        <button
                            type="button"
                            onClick={handle_disconnect}
                            className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium text-xs transition"
                        >
                            Disconnect
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handle_connect}
                            disabled={!session_state.agent_online && !session_state.is_checking}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium text-xs transition flex items-center gap-1.5"
                        >
                            <RunIcon className="size-3" /> Connect Terminal
                        </button>
                    )}
                </div>
            </div>

            {/* XTerm Container */}
            <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden border border-zinc-800 bg-[#09090b] shadow-inner p-2">
                <div ref={container_ref} className="absolute inset-2" />

                {pty_state.status === "disconnected" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs gap-3 z-10">
                        <div className="text-zinc-400 text-sm font-mono">Interactive Remote Terminal (PTY)</div>
                        <button
                            type="button"
                            onClick={handle_connect}
                            disabled={!session_state.agent_online}
                            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium text-xs font-mono transition shadow-lg flex items-center gap-2"
                        >
                            <RunIcon className="size-3" />
                            {session_state.agent_online ? "Open Terminal Session" : "Waiting for Agent to Connect..."}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
