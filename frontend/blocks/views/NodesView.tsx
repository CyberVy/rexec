"use client"

import { X, ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useState, useCallback } from "react"
import { useController } from "@/components/hooks"
import { Badge, Button, EmptyState, FullscreenSheet, Text, view_switcher_controller } from "@/components"
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
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-ui-border bg-ui-fill-subtle shrink-0">
                <div className="flex items-center gap-2.5">
                    <Text variant="body" weight="semibold" className="tracking-tight">
                        Node Agents
                    </Text>
                    <Badge tone="subtle" shape="pill" mono className="border border-ui-border px-2 text-[11px]">
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
                        className="size-7 rounded-lg bg-background!"
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
                            <Text variant="caption" weight="medium" tone="inherit" mono>
                                Add
                            </Text>
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
                        className="min-h-48 rounded-xl border border-dashed border-ui-border font-mono"
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
                                    <Text variant="caption" weight="medium" tone="inherit" mono>
                                        Add Node
                                    </Text>
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
                                            ? "border-ui-border-hover bg-ui-fill-subtle shadow-sm"
                                            : "border-ui-border bg-ui-fill-subtle hover:border-ui-border-hover"
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
                                            <Text variant="body" weight="semibold" truncate>
                                                {agent.name}
                                            </Text>
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
                                                    className="hidden max-w-32 truncate border border-ui-border sm:inline-flex"
                                                >
                                                    {agent.node_id}
                                                </Badge>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {agent.is_online && agent.latency_ms !== null && (
                                                <Text variant="footnote" tone="secondary" mono>
                                                    {agent.latency_ms}ms
                                                </Text>
                                            )}
                                            <Text variant="caption" tone="secondary" mono>
                                                {agent.is_online
                                                    ? "Online"
                                                    : agent.channels &&
                                                        (agent.channels.pty ||
                                                            agent.channels.exec ||
                                                            agent.channels.file ||
                                                            agent.channels.forward)
                                                      ? "Partial"
                                                      : "Offline"}
                                            </Text>
                                        </div>
                                    </div>

                                    {/* Card Details: Hub URL & Token */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-background/50 p-2.5 rounded-lg border border-ui-separator">
                                        <div className="min-w-0 flex items-center gap-1.5">
                                            <Text variant="caption" tone="secondary" mono className="shrink-0">
                                                Hub:
                                            </Text>
                                            <Text variant="caption" mono truncate title={agent.hub_url}>
                                                {agent.hub_url || "(none)"}
                                            </Text>
                                        </div>

                                        <div className="min-w-0 flex items-center justify-between gap-1">
                                            <div className="min-w-0 flex items-center gap-1.5">
                                                <Text variant="caption" tone="secondary" mono className="shrink-0">
                                                    Token:
                                                </Text>
                                                <Text variant="caption" mono truncate>
                                                    {is_revealed
                                                        ? agent.token
                                                        : agent.token
                                                          ? `${agent.token.slice(0, 4)}••••••••`
                                                          : "(none)"}
                                                </Text>
                                            </div>
                                            {agent.token && (
                                                <Button
                                                    variant="unstyled"
                                                    onClick={() => toggle_show_token(agent_id)}
                                                    className="text-[10px] text-ui-label-secondary hover:text-ui-label-strong underline shrink-0"
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
                                                                ? "gap-1 border border-ui-border text-ui-label-strong"
                                                                : "gap-1 border border-ui-border text-ui-label-secondary opacity-50"
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
                                                    className="rounded-lg bg-background! font-mono"
                                                >
                                                    Activate
                                                </Button>
                                            ) : (
                                                <Text variant="caption" tone="secondary" mono className="italic pl-1">
                                                    Current active target
                                                </Text>
                                            )}

                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                shape="none"
                                                onClick={() => {
                                                    if (agent.is_checking) return
                                                    session_controller.refresh_agent_status(agent_id)
                                                }}
                                                className="rounded-lg border border-ui-border font-mono"
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
                                            className="size-7 rounded-lg border-transparent! hover:border-ui-destructive/20!"
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
                className="pt-[max(env(safe-area-inset-top),10px)] pb-[max(env(safe-area-inset-bottom),10px)] pl-[max(env(safe-area-inset-left),10px)] pr-[max(env(safe-area-inset-right),10px)]"
            >
                <div className="flex flex-col w-full h-full">
                    <div className="w-full max-w-xl mx-auto px-2 sm:px-4 pt-2 pb-3 flex items-center justify-between border-b border-ui-border shrink-0">
                        <Text variant="headline" mono>
                            Add Node Agent
                        </Text>
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

                    <div className="flex-1 min-h-0 w-full overflow-y-auto overscroll-none no-scrollbar">
                        <form
                            onSubmit={handle_add_node}
                            className="w-full max-w-xl mx-auto px-2 sm:px-4 py-4 flex flex-col gap-4"
                        >
                            <div className="flex flex-col gap-1.5">
                                <Text as="label" variant="caption" tone="secondary" mono>
                                    Name (optional)
                                </Text>
                                <input
                                    type="text"
                                    value={new_name}
                                    onChange={(e) => set_new_name(e.target.value)}
                                    placeholder="e.g. Colab GPU, AWS Node"
                                    className="px-3.5 py-2 rounded-xl bg-background border border-ui-border text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <Text as="label" variant="caption" tone="secondary" mono>
                                    Hub URL
                                </Text>
                                <input
                                    type="text"
                                    required
                                    value={new_hub}
                                    onChange={(e) => set_new_hub(e.target.value)}
                                    placeholder="e.g. https://hub.example.com"
                                    className="px-3.5 py-2 rounded-xl bg-background border border-ui-border text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <Text as="label" variant="caption" tone="secondary" mono>
                                    Session Token
                                </Text>
                                <input
                                    type="text"
                                    value={new_token}
                                    onChange={(e) => set_new_token(e.target.value)}
                                    placeholder="Session token (optional)"
                                    className="px-3.5 py-2 rounded-xl bg-background border border-ui-border text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-ui-border">
                                <Button
                                    variant="outline"
                                    size="md"
                                    onClick={handle_close_add_modal}
                                    className="font-mono"
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" variant="primary" size="md" className="px-5 font-mono">
                                    Save & Connect
                                </Button>
                            </div>
                        </form>
                    </div>

                    <div className="flex justify-end px-2 my-2 shrink-0 select-none">
                        <div className="inline-flex items-center select-none rounded-full border border-ui-border p-1">
                            <Button className="w-14 h-8" onClick={handle_close_add_modal}>
                                <ArrowLeft key="back" />
                            </Button>
                        </div>
                    </div>
                </div>
            </FullscreenSheet>
        </div>
    )
}
