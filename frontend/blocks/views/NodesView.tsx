"use client"

import { X, ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useState, useCallback } from "react"
import { useController } from "@/components/hooks"
import { Badge, Button, EmptyState, FullscreenSheet, view_switcher_controller } from "@/components"
import { session_controller } from "@/core/controllers/session_controller"
export function NodesView() {
    const session = useController(session_controller, {
        events: ["change", "status_change"]
    })

    const [is_add_modal_open, set_is_add_modal_open] = useState(false)
    const [new_name, set_new_name] = useState("")
    const [new_hub, set_new_hub] = useState("")
    const [new_token, set_new_token] = useState("")
    const [show_tokens, set_show_tokens] = useState<Record<string, boolean>>({})

    const handle_open_add_modal = useCallback(() => {
        view_switcher_controller.hide_toolbar()
        set_is_add_modal_open(true)
    }, [])

    const handle_close_add_modal = useCallback(() => {
        view_switcher_controller.show_toolbar()
        set_is_add_modal_open(false)
    }, [])

    const online_count = Object.values(session.agents).filter((a) => a.is_online).length
    const total_count = session.agent_ids.length

    const handle_add_node = (e: React.FormEvent) => {
        e.preventDefault()
        if (!new_hub.trim()) return

        session_controller.add_agent({
            name: new_name.trim() || undefined,
            hub_url: new_hub.trim(),
            token: new_token.trim()
        })

        set_new_name("")
        set_new_hub("")
        set_new_token("")
        handle_close_add_modal()
    }

    const toggle_show_token = (id: string) => {
        set_show_tokens((prev) => ({ ...prev, [id]: !prev[id] }))
    }

    return (
        <div className="flex flex-col p-4 gap-3 pb-24 min-h-0">
            {/* Header / Summary Bar */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 shrink-0">
                <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-sm tracking-tight text-foreground">Node Agents</span>
                    <Badge tone="subtle" shape="pill" mono className="border border-(--ui-border) px-2 text-[11px]">
                        {online_count} / {total_count} Online
                    </Badge>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        shape="none"
                        onClick={() => session_controller.refresh_all_agents()}
                        disabled={session.is_checking || session.agent_ids.length === 0}
                        title="Refresh all nodes status"
                        className="size-7 rounded-lg bg-background"
                    >
                        <RefreshCw className={`size-3.5 ${session.is_checking ? "animate-spin" : ""}`} />
                    </Button>

                    <Button
                        variant="primary"
                        size="xs"
                        shape="none"
                        onClick={handle_open_add_modal}
                        className="rounded-lg font-mono"
                    >
                        <span className="inline-flex items-center gap-1">
                            <Plus className="size-3.5" />
                            <span>Add</span>
                        </span>
                    </Button>
                </div>
            </div>

            {/* Nodes Grid */}
            <div className="flex-1 min-h-0">
                {session.agent_ids.length === 0 ? (
                    <EmptyState
                        title="No Node Agents configured"
                        description="Add a node agent to connect to a remote server or execution hub."
                        className="min-h-48 rounded-xl border border-dashed border-(--ui-border) font-mono"
                        action={
                            <Button
                                variant="primary"
                                size="sm"
                                shape="none"
                                onClick={handle_open_add_modal}
                                className="rounded-lg font-mono"
                            >
                                <span className="inline-flex items-center gap-1.5">
                                    <Plus className="size-3.5" />
                                    <span>Add Node</span>
                                </span>
                            </Button>
                        }
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 content-start">
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
                                            ? "border-foreground/30 bg-black/4 dark:bg-white/6 shadow-sm"
                                            : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:border-black/20 dark:hover:border-white/20"
                                    }`}
                                >
                                    {/* Card Top: Status & Name */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span
                                                className={`size-2 rounded-full shrink-0 ${
                                                    agent.is_online
                                                        ? "bg-emerald-500 animate-pulse"
                                                        : "bg-foreground/20"
                                                }`}
                                            />
                                            <span className="font-semibold text-sm text-foreground truncate">
                                                {agent.name}
                                            </span>
                                            {is_active && (
                                                <Badge
                                                    tone="custom"
                                                    mono
                                                    className="border border-foreground/30 bg-foreground/10 font-bold text-foreground"
                                                >
                                                    ACTIVE
                                                </Badge>
                                            )}
                                            {agent.node_id && (
                                                <Badge
                                                    tone="subtle"
                                                    mono
                                                    className="hidden max-w-32 truncate border border-(--ui-border) sm:inline-flex"
                                                >
                                                    {agent.node_id}
                                                </Badge>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {agent.is_online && agent.latency_ms !== null && (
                                                <span className="text-[11px] font-mono text-muted-foreground">
                                                    {agent.latency_ms}ms
                                                </span>
                                            )}
                                            <span className="text-xs font-mono text-muted-foreground">
                                                {agent.is_online
                                                    ? "Online"
                                                    : agent.channels &&
                                                        (agent.channels.pty ||
                                                            agent.channels.exec ||
                                                            agent.channels.file ||
                                                            agent.channels.forward)
                                                      ? "Partial"
                                                      : "Offline"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Card Details: Hub URL & Token */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-background/50 p-2.5 rounded-lg border border-black/5 dark:border-white/5">
                                        <div className="min-w-0 flex items-center gap-1.5">
                                            <span className="text-muted-foreground shrink-0">Hub:</span>
                                            <span className="text-foreground truncate" title={agent.hub_url}>
                                                {agent.hub_url || "(none)"}
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
                                                <Button
                                                    variant="unstyled"
                                                    onClick={() => toggle_show_token(agent_id)}
                                                    className="text-[10px] text-black/50 dark:text-white/50 hover:text-foreground underline shrink-0"
                                                >
                                                    {is_revealed ? "hide" : "show"}
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {agent.channels && (
                                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                                            {(["pty", "exec", "file", "forward"] as const).map((channel) => {
                                                const active = agent.channels![channel]
                                                return (
                                                    <Badge
                                                        key={channel}
                                                        tone={active ? "subtle" : "custom"}
                                                        mono
                                                        className={
                                                            active
                                                                ? "gap-1 border border-black/15 dark:border-white/15 text-foreground"
                                                                : "gap-1 border border-(--ui-border) text-black/50 dark:text-white/50 opacity-50"
                                                        }
                                                    >
                                                        <span
                                                            className={`size-1.5 rounded-full ${
                                                                active ? "bg-foreground" : "bg-foreground/25"
                                                            }`}
                                                        />
                                                        {channel}
                                                    </Badge>
                                                )
                                            })}
                                        </div>
                                    )}

                                    {/* Card Actions */}
                                    <div className="flex items-center justify-between gap-2 pt-0.5">
                                        <div className="flex items-center gap-1.5">
                                            {!is_active ? (
                                                <Button
                                                    variant="outline"
                                                    size="xs"
                                                    shape="none"
                                                    onClick={() => session_controller.select_agent(agent_id)}
                                                    className="rounded-lg bg-background font-mono"
                                                >
                                                    Activate
                                                </Button>
                                            ) : (
                                                <span className="text-xs font-mono text-muted-foreground italic pl-1">
                                                    Current active target
                                                </span>
                                            )}

                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                shape="none"
                                                onClick={() => {
                                                    if (agent.is_checking) return
                                                    session_controller.refresh_agent_status(agent_id)
                                                }}
                                                className="rounded-lg border border-(--ui-border) font-mono"
                                            >
                                                Check
                                            </Button>
                                        </div>

                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            shape="none"
                                            onClick={() => session_controller.remove_agent(agent_id)}
                                            title="Delete node agent"
                                            className="size-7 rounded-lg border-transparent hover:border-(--ui-destructive)/20"
                                        >
                                            <Trash2 className="size-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Add Node Fullscreen Modal */}
            <FullscreenSheet
                open={is_add_modal_open}
                on_close={handle_close_add_modal}
                duration={250}
                className="bg-background/95 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] px-4 sm:px-6"
            >
                <div className="w-full max-w-xl mx-auto flex flex-col gap-5 py-2">
                    <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
                        <span className="font-semibold text-base font-mono text-foreground">Add Node Agent</span>
                        <Button
                            variant="ghost"
                            size="icon"
                            shape="none"
                            onClick={handle_close_add_modal}
                            className="rounded-lg"
                            title="Close"
                        >
                            <X className="size-5" />
                        </Button>
                    </div>

                    <form onSubmit={handle_add_node} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-mono text-muted-foreground">Name (optional)</label>
                            <input
                                type="text"
                                value={new_name}
                                onChange={(e) => set_new_name(e.target.value)}
                                placeholder="e.g. Colab GPU, AWS Node"
                                className="px-3.5 py-2 rounded-xl bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-mono text-muted-foreground">Hub URL</label>
                            <input
                                type="text"
                                required
                                value={new_hub}
                                onChange={(e) => set_new_hub(e.target.value)}
                                placeholder="e.g. https://hub.example.com"
                                className="px-3.5 py-2 rounded-xl bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-mono text-muted-foreground">Session Token</label>
                            <input
                                type="text"
                                value={new_token}
                                onChange={(e) => set_new_token(e.target.value)}
                                placeholder="Session token (optional)"
                                className="px-3.5 py-2 rounded-xl bg-background border border-black/15 dark:border-white/15 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-black/10 dark:border-white/10">
                            <Button variant="outline" size="md" onClick={handle_close_add_modal} className="font-mono">
                                Cancel
                            </Button>
                            <Button type="submit" variant="primary" size="md" className="px-5 font-mono">
                                Save & Connect
                            </Button>
                        </div>
                    </form>
                </div>
                <div
                    className={
                        "inline-flex items-center select-none fixed text-2xl bottom-17 right-4 z-1 rounded-full border border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-xl shadow-sm p-1"
                    }
                >
                    <Button className={"w-10 h-10"} onClick={handle_close_add_modal}>
                        {<ArrowLeft key="back" />}
                    </Button>
                </div>
            </FullscreenSheet>
        </div>
    )
}
