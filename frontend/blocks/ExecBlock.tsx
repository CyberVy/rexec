"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useController } from "@/components/hooks"
import { exec_controller } from "@/core/controllers/exec_controller"
import { RunIcon, AbortIcon, ClearIcon, CopyIcon, CheckIcon } from "./icons"

const PRESETS = [
    "uname -a",
    "pwd",
    "ls -la",
    "nvidia-smi",
    "python3 --version",
    "cat /etc/os-release",
    "df -h",
    "free -m"
]

export function ExecBlock() {
    const exec_state = useController(exec_controller, {
        events: ["change"]
    })

    const [cmd_input, set_cmd_input] = useState(exec_state.command)
    const [cwd_input, set_cwd_input] = useState(exec_state.cwd)
    const [copied, set_copied] = useState(false)
    const output_ref = useRef<HTMLDivElement>(null)
    const was_near_bottom_ref = useRef(true)

    const handle_scroll = useCallback(() => {
        if (!output_ref.current) return
        const { scrollHeight, scrollTop, clientHeight } = output_ref.current
        was_near_bottom_ref.current = scrollHeight - scrollTop - clientHeight < 40
    }, [])

    useEffect(() => {
        if (output_ref.current && was_near_bottom_ref.current) {
            output_ref.current.scrollTop = output_ref.current.scrollHeight
        }
    }, [exec_state.chunks.length, exec_state.is_running])

    const handle_run = (command_to_run?: string) => {
        const cmd = command_to_run ?? cmd_input
        if (!cmd.trim() || exec_state.is_running) return
        exec_controller.run(cmd, cwd_input.trim() || undefined)
    }

    const handle_key_down = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handle_run()
        }
    }

    const handle_copy_output = async () => {
        const text = exec_state.chunks.map((c) => c.data).join("")
        if (!text) return
        try {
            await navigator.clipboard.writeText(text)
            set_copied(true)
            setTimeout(() => set_copied(false), 1500)
        } catch {
            // Ignore clipboard errors
        }
    }

    return (
        <div className="flex flex-col h-dvh p-4 gap-3 pb-24 min-h-0">
            {/* Command Input Bar */}
            <div className="flex flex-col gap-2 p-3 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-emerald-500 font-mono text-sm font-bold pl-1">{">"}</span>
                    <input
                        type="text"
                        value={cmd_input}
                        onChange={(e) => {
                            set_cmd_input(e.target.value)
                            exec_controller.set_command(e.target.value)
                        }}
                        onKeyDown={handle_key_down}
                        placeholder="Command to execute (e.g. uname -a, ls -la)"
                        disabled={exec_state.is_running}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
                    />

                    {exec_state.is_running ? (
                        <button
                            type="button"
                            onClick={() => exec_controller.abort()}
                            className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-xs font-mono transition flex items-center gap-1.5"
                        >
                            <AbortIcon className="size-3" />
                            Abort
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => handle_run()}
                            disabled={!cmd_input.trim()}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium text-xs font-mono transition flex items-center gap-1.5 shadow-sm"
                        >
                            <RunIcon className="size-3" />
                            Run
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <span className="text-[11px] font-mono text-muted-foreground">cwd:</span>
                        <input
                            type="text"
                            value={cwd_input}
                            onChange={(e) => {
                                set_cwd_input(e.target.value)
                                exec_controller.set_cwd(e.target.value)
                            }}
                            placeholder="Optional working directory (e.g. /workspace)"
                            disabled={exec_state.is_running}
                            className="flex-1 max-w-sm px-2 py-0.5 rounded bg-background/50 border border-black/10 dark:border-white/10 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
                        />
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground mr-1">Presets:</span>
                        {PRESETS.map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                onClick={() => {
                                    set_cmd_input(preset)
                                    exec_controller.set_command(preset)
                                    handle_run(preset)
                                }}
                                disabled={exec_state.is_running}
                                className="px-2 py-0.5 rounded text-[11px] font-mono bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-muted-foreground hover:text-foreground transition disabled:opacity-40"
                            >
                                {preset}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Output Panel Header */}
            <div className="flex items-center justify-between text-xs px-1 shrink-0">
                <div className="flex items-center gap-2 font-mono">
                    <span className="text-muted-foreground">Console Output</span>
                    {exec_state.is_running && (
                        <span className="text-amber-500 text-[11px] flex items-center gap-1">
                            <span className="size-1.5 rounded-full bg-amber-500 animate-ping" />
                            Streaming...
                        </span>
                    )}
                    {exec_state.exit_code !== null && (
                        <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                exec_state.exit_code === 0
                                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                    : "bg-red-500/10 text-red-500 border border-red-500/20"
                            }`}
                        >
                            Exit: {exec_state.exit_code}
                        </span>
                    )}
                    {exec_state.duration_ms !== null && (
                        <span className="text-[10px] text-muted-foreground">({exec_state.duration_ms}ms)</span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handle_copy_output}
                        disabled={exec_state.chunks.length === 0}
                        className="text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 transition flex items-center gap-1"
                    >
                        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
                        {copied ? "Copied" : "Copy"}
                    </button>

                    <button
                        type="button"
                        onClick={() => exec_controller.clear_output()}
                        disabled={exec_state.chunks.length === 0 && !exec_state.error}
                        className="text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 transition flex items-center gap-1"
                    >
                        <ClearIcon className="size-3" />
                        Clear Output
                    </button>
                </div>
            </div>

            {/* Terminal / Output Viewport */}
            <div
                ref={output_ref}
                onScroll={handle_scroll}
                className="flex-1 min-h-0 overflow-auto rounded-xl p-3 bg-zinc-950 text-zinc-100 font-mono text-xs leading-relaxed select-text border border-zinc-800"
            >
                {exec_state.chunks.length === 0 && !exec_state.error && !exec_state.is_running && (
                    <div className="text-zinc-600 py-8 text-center">
                        Execute a command to stream remote stdout / stderr in real time.
                    </div>
                )}

                {exec_state.chunks.map((chunk, index) => (
                    <span
                        key={index}
                        className={
                            chunk.stream === "stderr"
                                ? "text-amber-400 whitespace-pre-wrap"
                                : "text-zinc-200 whitespace-pre-wrap"
                        }
                    >
                        {chunk.data}
                    </span>
                ))}

                {exec_state.error && (
                    <div className="mt-2 text-red-400 p-2 rounded bg-red-950/40 border border-red-900/50">
                        Error: {exec_state.error}
                    </div>
                )}
            </div>
        </div>
    )
}
