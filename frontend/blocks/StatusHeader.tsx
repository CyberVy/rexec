"use client"

import { useState } from "react"
import { useController } from "@/components/hooks"
import { session_controller } from "@/core/controllers/session_controller"
import { RefreshIcon, EditIcon } from "./icons"

export function StatusHeader() {
    const session = useController(session_controller, {
        events: ["change", "status_change"]
    })

    const [editing, set_editing] = useState(false)
    const [hub_input, set_hub_input] = useState(session.hub_url)
    const [token_input, set_token_input] = useState(session.token)

    const handle_save = () => {
        session_controller.set_hub_url(hub_input)
        session_controller.set_token(token_input)
        set_editing(false)
    }

    const handle_cancel = () => {
        set_hub_input(session.hub_url)
        set_token_input(session.token)
        set_editing(false)
    }

    const handle_input_key_down = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            handle_save()
        } else if (e.key === "Escape") {
            e.preventDefault()
            handle_cancel()
        }
    }

    return (
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-black/10 dark:border-white/10 bg-background/80 backdrop-blur-md sticky top-0 z-20">
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm tracking-tight text-foreground flex items-center gap-1.5">
                        <span className="text-emerald-500 font-mono font-bold">{">_"}</span>
                        rexec
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-black/5 dark:bg-white/10 text-muted-foreground">
                        edge-client
                    </span>
                </div>

                <div className="h-4 w-px bg-black/10 dark:bg-white/10 hidden sm:block" />

                {/* Connection Status Badge */}
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
                    <span
                        className={`size-2 rounded-full ${
                            session.is_checking
                                ? "bg-amber-400 animate-ping"
                                : session.agent_online
                                  ? "bg-emerald-500 animate-pulse"
                                  : "bg-red-500/80"
                        }`}
                    />
                    <span className="text-foreground">
                        {session.is_checking
                            ? "Checking..."
                            : session.agent_online
                              ? "Agent Online"
                              : session.hub_url
                                ? "Agent Offline"
                                : "No Node"}
                    </span>
                    {session.latency_ms !== null && session.agent_online && (
                        <span className="text-emerald-500 text-[10px]">({session.latency_ms}ms)</span>
                    )}
                </div>
            </div>

            {/* Quick Hub / Token indicator & config */}
            <div className="flex items-center gap-2 text-xs">
                {editing ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type="text"
                            value={hub_input}
                            onChange={(e) => set_hub_input(e.target.value)}
                            onKeyDown={handle_input_key_down}
                            placeholder="Hub URL"
                            className="px-2 py-1 rounded bg-black/5 dark:bg-white/10 border border-black/20 dark:border-white/20 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 w-48 sm:w-64"
                            autoFocus
                        />
                        <input
                            type="password"
                            value={token_input}
                            onChange={(e) => set_token_input(e.target.value)}
                            onKeyDown={handle_input_key_down}
                            placeholder="Token"
                            className="px-2 py-1 rounded bg-black/5 dark:bg-white/10 border border-black/20 dark:border-white/20 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 w-28 sm:w-36"
                        />
                        <button
                            type="button"
                            onClick={handle_save}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition"
                        >
                            Save
                        </button>
                        <button
                            type="button"
                            onClick={handle_cancel}
                            className="px-2.5 py-1 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-muted-foreground text-xs transition"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <div
                            onClick={() => {
                                set_hub_input(session.hub_url)
                                set_token_input(session.token)
                                set_editing(true)
                            }}
                            title="Click to edit Hub URL and Token"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 transition font-mono text-[11px] text-muted-foreground border border-transparent hover:border-black/10 dark:hover:border-white/10"
                        >
                            <span className="text-foreground truncate max-w-[180px] sm:max-w-[260px]">
                                {session.hub_url || "(no hub url)"}
                            </span>
                            <span className="text-black/30 dark:text-white/30">•</span>
                            <span className="opacity-70">
                                {session.token ? `${session.token.slice(0, 4)}...` : "(no token)"}
                            </span>
                            <EditIcon className="size-3 opacity-50 ml-1 inline-block" />
                        </div>

                        <button
                            type="button"
                            onClick={() => session_controller.refresh_status()}
                            disabled={session.is_checking}
                            title="Refresh status"
                            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition disabled:opacity-40"
                        >
                            <RefreshIcon className={`size-3.5 ${session.is_checking ? "animate-spin" : ""}`} />
                        </button>
                    </div>
                )}
            </div>
        </header>
    )
}
