"use client"

import { useState } from "react"
import { useController } from "@/components/hooks"
import { FloatingModalContainer } from "@/components/composite/ModalContainer"
import { session_controller } from "@/core/controllers/session_controller"
import { PlusIcon, RefreshIcon, TrashIcon, CopyIcon, CheckIcon } from "./icons"
import { CloseIcon } from "@/components/icons"

export function NodesBlock() {
    const session = useController(session_controller, {
        events: ["change", "status_change"]
    })

    const [is_add_modal_open, set_is_add_modal_open] = useState(false)
    const [new_name, set_new_name] = useState("")
    const [new_hub, set_new_hub] = useState("http://localhost:8787")
    const [new_token, set_new_token] = useState("")
    const [copied, set_copied] = useState(false)
    const [show_tokens, set_show_tokens] = useState<Record<string, boolean>>({})

    const active_agent = session.agents[session.active_agent_id]
    const online_count = Object.values(session.agents).filter((a) => a.is_online).length
    const total_count = session.agent_ids.length

    const handle_add_node = (e: React.FormEvent) => {
        e.preventDefault()
        if (!new_hub.trim()) return

        session_controller.add_agent({
            name: new_name.trim() || undefined,
            hub_url: new_hub.trim(),
            token: new_token.trim() || "default-token"
        })

        set_new_name("")
        set_new_hub("http://localhost:8787")
        set_new_token("")
        set_is_add_modal_open(false)
    }

    const handle_copy_snippet = async () => {
        if (!active_agent) return
        const cmd = `rexec-agent --hub ${active_agent.hub_url} --token ${active_agent.token}`
        try {
            await navigator.clipboard.writeText(cmd)
            set_copied(true)
            setTimeout(() => set_copied(false), 1500)
        } catch {
            // Ignore clipboard errors
        }
    }

    const toggle_show_token = (id: string) => {
        set_show_tokens((prev) => ({ ...prev, [id]: !prev[id] }))
    }

    return (
        <div className="flex flex-col h-dvh p-4 gap-3 pb-24 min-h-0">
            {/* Header / Summary Bar */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 shrink-0">
                <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-sm tracking-tight text-foreground">Node Agents</span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 text-muted-foreground">
                        {online_count} / {total_count} Online
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => session_controller.refresh_all_agents()}
                        disabled={session.is_checking}
                        title="Refresh all nodes status"
                        className="p-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-background hover:bg-black/5 dark:hover:bg-white/10 text-foreground transition cursor-pointer disabled:opacity-40"
                    >
                        <RefreshIcon className={`size-3.5 ${session.is_checking ? "animate-spin" : ""}`} />
                    </button>

                    <button
                        type="button"
                        onClick={() => set_is_add_modal_open(true)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-foreground text-background font-medium text-xs font-mono transition cursor-pointer hover:opacity-90"
                    >
                        <PlusIcon className="size-3.5" />
                        <span>Add Node</span>
                    </button>
                </div>
            </div>

            {/* Nodes List */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
                {session.agent_ids.map((agent_id) => {
                    const agent = session.agents[agent_id]
                    if (!agent) return null
                    const is_active = agent_id === session.active_agent_id
                    const is_revealed = !!show_tokens[agent_id]

                    return (
                        <div
                            key={agent_id}
                            className={`p-3.5 rounded-xl border transition flex flex-col gap-2.5 ${
                                is_active
                                    ? "border-foreground/30 bg-black/[0.04] dark:bg-white/[0.06] shadow-sm"
                                    : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:border-black/20 dark:hover:border-white/20"
                            }`}
                        >
                            {/* Card Top: Status & Name */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span
                                        className={`size-2.5 rounded-full shrink-0 ${
                                            agent.is_checking
                                                ? "bg-foreground/50 animate-ping"
                                                : agent.is_online
                                                  ? "bg-foreground animate-pulse"
                                                  : "bg-foreground/20"
                                        }`}
                                    />
                                    <span className="font-semibold text-sm text-foreground truncate">{agent.name}</span>
                                    {is_active && (
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-foreground/30 bg-foreground/10 text-foreground shrink-0 font-bold">
                                            ACTIVE
                                        </span>
                                    )}
                                    {agent.node_id && (
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 text-muted-foreground truncate hidden sm:inline">
                                            {agent.node_id}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {agent.is_online && agent.latency_ms !== null && (
                                        <span className="text-[11px] font-mono text-muted-foreground">
                                            {agent.latency_ms}ms
                                        </span>
                                    )}
                                    <span className="text-xs font-mono text-muted-foreground">
                                        {agent.is_checking ? "Checking..." : agent.is_online ? "Online" : "Offline"}
                                    </span>
                                </div>
                            </div>

                            {/* Card Details: Hub URL & Token */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-background/50 p-2.5 rounded-lg border border-black/5 dark:border-white/5">
                                <div className="min-w-0 flex items-center gap-1.5">
                                    <span className="text-muted-foreground shrink-0">Hub:</span>
                                    <span className="text-foreground truncate" title={agent.hub_url}>
                                        {agent.hub_url}
                                    </span>
                                </div>

                                <div className="min-w-0 flex items-center justify-between gap-1">
                                    <div className="min-w-0 flex items-center gap-1.5">
                                        <span className="text-muted-foreground shrink-0">Token:</span>
                                        <span className="text-foreground truncate">
                                            {is_revealed
                                                ? agent.token
                                                : agent.token
                                                  ? `${agent.token.slice(0, 4)}••••••••`
                                                  : "(none)"}
                                        </span>
                                    </div>
                                    {agent.token && (
                                        <button
                                            type="button"
                                            onClick={() => toggle_show_token(agent_id)}
                                            className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer shrink-0"
                                        >
                                            {is_revealed ? "hide" : "show"}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Card Actions */}
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                                <div className="flex items-center gap-1.5">
                                    {!is_active ? (
                                        <button
                                            type="button"
                                            onClick={() => session_controller.select_agent(agent_id)}
                                            className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 bg-background hover:bg-black/5 dark:hover:bg-white/10 text-xs font-mono text-foreground transition cursor-pointer"
                                        >
                                            Activate
                                        </button>
                                    ) : (
                                        <span className="text-xs font-mono text-muted-foreground italic pl-1">
                                            Current active target
                                        </span>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => session_controller.refresh_agent_status(agent_id)}
                                        disabled={agent.is_checking}
                                        className="px-2 py-1 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-xs font-mono text-muted-foreground hover:text-foreground transition cursor-pointer disabled:opacity-40"
                                    >
                                        Check
                                    </button>
                                </div>

                                {session.agent_ids.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => session_controller.remove_agent(agent_id)}
                                        title="Delete node agent"
                                        className="p-1 rounded-lg border border-transparent hover:border-black/10 dark:hover:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition cursor-pointer"
                                    >
                                        <TrashIcon className="size-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Quick Run Command Snippet */}
            {active_agent && (
                <div className="p-3 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 shrink-0 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                        <span>Remote worker startup command:</span>
                        <button
                            type="button"
                            onClick={handle_copy_snippet}
                            className="flex items-center gap-1 px-2 py-0.5 rounded border border-black/10 dark:border-white/10 bg-background hover:bg-black/5 dark:hover:bg-white/10 text-foreground transition cursor-pointer"
                        >
                            {copied ? (
                                <>
                                    <CheckIcon className="size-3" />
                                    <span>Copied</span>
                                </>
                            ) : (
                                <>
                                    <CopyIcon className="size-3" />
                                    <span>Copy</span>
                                </>
                            )}
                        </button>
                    </div>

                    <div className="p-2 rounded-lg bg-black/10 dark:bg-black/40 border border-black/10 dark:border-white/5 font-mono text-xs text-foreground overflow-x-auto whitespace-nowrap">
                        <code>
                            rexec-agent --hub {active_agent.hub_url} --token {active_agent.token}
                        </code>
                    </div>
                </div>
            )}

            {/* Add Node Modal */}
            {is_add_modal_open && (
                <FloatingModalContainer
                    on_escape={() => set_is_add_modal_open(false)}
                    className="p-5 w-[92vw] max-w-md"
                >
                    <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
                        <span className="font-semibold text-sm text-foreground">Add Node Agent</span>
                        <button
                            type="button"
                            onClick={() => set_is_add_modal_open(false)}
                            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition cursor-pointer"
                        >
                            <CloseIcon className="size-4" />
                        </button>
                    </div>

                    <form onSubmit={handle_add_node} className="flex flex-col gap-3.5 pt-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-mono text-muted-foreground">Name (optional)</label>
                            <input
                                type="text"
                                value={new_name}
                                onChange={(e) => set_new_name(e.target.value)}
                                placeholder="e.g. Colab GPU, AWS Node"
                                className="px-3 py-1.5 rounded-lg bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-mono text-muted-foreground">Hub URL</label>
                            <input
                                type="text"
                                required
                                value={new_hub}
                                onChange={(e) => set_new_hub(e.target.value)}
                                placeholder="e.g. http://localhost:8787"
                                className="px-3 py-1.5 rounded-lg bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-mono text-muted-foreground">Session Token</label>
                            <input
                                type="text"
                                value={new_token}
                                onChange={(e) => set_new_token(e.target.value)}
                                placeholder="default-token or custom secret"
                                className="px-3 py-1.5 rounded-lg bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => set_is_add_modal_open(false)}
                                className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs font-mono text-muted-foreground hover:text-foreground transition cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-1.5 rounded-lg bg-foreground text-background font-medium text-xs font-mono transition cursor-pointer hover:opacity-90"
                            >
                                Save & Connect
                            </button>
                        </div>
                    </form>
                </FloatingModalContainer>
            )}
        </div>
    )
}
