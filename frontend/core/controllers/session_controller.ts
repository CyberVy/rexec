import { BaseController } from "@/infra/base_controller"
import { LocalStorageMap } from "@/infra/storage/kv.client"
import { create_logger } from "@/infra/logger"
import { RexecCaller, type HubStatus } from "@rexec/caller/core"

const logger = create_logger("SessionController")

export interface AgentRecord {
    id: string
    name: string
    hub_url: string
    token: string
    node_id?: string
    is_online: boolean
    latency_ms: number | null
    is_checking: boolean
    last_checked_at: number | null
    error: string | null
}

export type StoredAgentEntity = Pick<AgentRecord, "id" | "name" | "hub_url" | "token" | "node_id">

export interface SessionState {
    active_agent_id: string
    agent_ids: string[]
    agents: Record<string, AgentRecord>
    // Active agent snapshot properties for backwards compatibility
    hub_url: string
    token: string
    is_checking: boolean
    agent_online: boolean
    latency_ms: number | null
    error: string | null
    last_checked_at: number | null
    current_agent_id?: string
}

const order_store = new LocalStorageMap<string[]>("rexec_orders")
const agent_store = new LocalStorageMap<StoredAgentEntity>("rexec_agents")
const active_store = new LocalStorageMap<string>("rexec_active_agent")
const legacy_store = new LocalStorageMap<string>("rexec_session")

export class SessionController extends BaseController<SessionState> {
    private check_timer: ReturnType<typeof setTimeout> | null = null

    constructor() {
        super()

        let initial_hub = "http://localhost:8787"
        let initial_token = "default-token"

        if (typeof window !== "undefined") {
            try {
                const params = new URLSearchParams(window.location.search)
                const query_hub = params.get("hub") || params.get("hub_url")
                const query_token = params.get("token")

                if (query_hub) initial_hub = query_hub
                else initial_hub = legacy_store.get("hub_url") || initial_hub

                if (query_token) initial_token = query_token
                else initial_token = legacy_store.get("token") || initial_token
            } catch {
                // Ignore URL parsing errors
            }
        }

        let agent_ids = order_store.get("agents") ?? []
        const agents: Record<string, AgentRecord> = {}

        for (const id of agent_ids) {
            const stored = agent_store.get(id)
            if (stored) {
                agents[id] = {
                    ...stored,
                    is_online: false,
                    latency_ms: null,
                    is_checking: false,
                    last_checked_at: null,
                    error: null
                }
            }
        }

        // Migration or seed default agent if none exists
        if (agent_ids.length === 0 || Object.keys(agents).length === 0) {
            const default_id = "agent_default"
            const default_agent: StoredAgentEntity = {
                id: default_id,
                name: "Default Node",
                hub_url: initial_hub,
                token: initial_token
            }
            agent_store.set(default_id, default_agent)
            agent_ids = [default_id]
            order_store.set("agents", agent_ids)
            active_store.set("current", default_id)

            agents[default_id] = {
                ...default_agent,
                is_online: false,
                latency_ms: null,
                is_checking: false,
                last_checked_at: null,
                error: null
            }
        }

        let active_id = active_store.get("current") || agent_ids[0]
        if (!agents[active_id]) {
            active_id = agent_ids[0]
            active_store.set("current", active_id)
        }

        const active_agent = agents[active_id]
        this._state = {
            active_agent_id: active_id,
            agent_ids,
            agents,
            hub_url: active_agent.hub_url,
            token: active_agent.token,
            is_checking: false,
            agent_online: false,
            latency_ms: null,
            error: null,
            last_checked_at: null,
            current_agent_id: active_agent.node_id || active_agent.id
        }
    }

    private sync_active_snapshot(active_agent: AgentRecord): Partial<SessionState> {
        return {
            hub_url: active_agent.hub_url,
            token: active_agent.token,
            is_checking: active_agent.is_checking,
            agent_online: active_agent.is_online,
            latency_ms: active_agent.latency_ms,
            error: active_agent.error,
            last_checked_at: active_agent.last_checked_at,
            current_agent_id: active_agent.node_id || active_agent.id
        }
    }

    public select_agent(id: string): void {
        const target = this.state.agents[id]
        if (!target || this.state.active_agent_id === id) return

        active_store.set("current", id)
        legacy_store.set("hub_url", target.hub_url)
        legacy_store.set("token", target.token)

        this.update_state({
            active_agent_id: id,
            ...this.sync_active_snapshot(target)
        })
        this.dispatchEvent(new Event("change"))
        this.dispatchEvent(new Event("status_change"))
        this.refresh_agent_status(id)
    }

    public add_agent(params: { name?: string; hub_url: string; token: string }): string {
        const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const name = params.name?.trim() || `Node ${this.state.agent_ids.length + 1}`
        const hub_url = params.hub_url.trim()
        const token = params.token.trim()

        const stored: StoredAgentEntity = { id, name, hub_url, token }
        agent_store.set(id, stored)

        const next_ids = [...this.state.agent_ids, id]
        order_store.set("agents", next_ids)

        const new_record: AgentRecord = {
            ...stored,
            is_online: false,
            latency_ms: null,
            is_checking: false,
            last_checked_at: null,
            error: null
        }

        const next_agents = {
            ...this.state.agents,
            [id]: new_record
        }

        this.update_state({
            agent_ids: next_ids,
            agents: next_agents
        })
        this.dispatchEvent(new Event("change"))
        this.refresh_agent_status(id)
        return id
    }

    public remove_agent(id: string): boolean {
        if (this.state.agent_ids.length <= 1) return false
        if (!this.state.agents[id]) return false

        agent_store.delete(id)
        const next_ids = this.state.agent_ids.filter((item_id) => item_id !== id)
        order_store.set("agents", next_ids)

        const next_agents = { ...this.state.agents }
        delete next_agents[id]

        let next_active_id = this.state.active_agent_id
        if (next_active_id === id) {
            next_active_id = next_ids[0]
            active_store.set("current", next_active_id)
        }

        const active_agent = next_agents[next_active_id]
        this.update_state({
            active_agent_id: next_active_id,
            agent_ids: next_ids,
            agents: next_agents,
            ...this.sync_active_snapshot(active_agent)
        })
        this.dispatchEvent(new Event("change"))
        this.dispatchEvent(new Event("status_change"))
        return true
    }

    public update_agent(id: string, updates: Partial<Pick<AgentRecord, "name" | "hub_url" | "token">>): void {
        const existing = this.state.agents[id]
        if (!existing) return

        const updated_stored: StoredAgentEntity = {
            id,
            name: updates.name !== undefined ? updates.name.trim() : existing.name,
            hub_url: updates.hub_url !== undefined ? updates.hub_url.trim() : existing.hub_url,
            token: updates.token !== undefined ? updates.token.trim() : existing.token,
            node_id: existing.node_id
        }
        agent_store.set(id, updated_stored)

        const updated_record: AgentRecord = {
            ...existing,
            ...updated_stored,
            error: null
        }

        const next_agents = {
            ...this.state.agents,
            [id]: updated_record
        }

        const is_active = id === this.state.active_agent_id
        if (is_active) {
            legacy_store.set("hub_url", updated_stored.hub_url)
            legacy_store.set("token", updated_stored.token)
        }

        this.update_state({
            agents: next_agents,
            ...(is_active ? this.sync_active_snapshot(updated_record) : {})
        })
        this.dispatchEvent(new Event("change"))
        this.refresh_agent_status(id)
    }

    public set_hub_url(url: string): void {
        this.update_agent(this.state.active_agent_id, { hub_url: url })
    }

    public set_token(token: string): void {
        this.update_agent(this.state.active_agent_id, { token })
    }

    public get_caller(agent_id?: string): RexecCaller {
        const target_id = agent_id ?? this.state.active_agent_id
        const agent = this.state.agents[target_id]
        return new RexecCaller({
            hub_url: agent?.hub_url ?? this.state.hub_url,
            token: agent?.token ?? this.state.token
        })
    }

    public async refresh_agent_status(agent_id: string): Promise<HubStatus | null> {
        const agent = this.state.agents[agent_id]
        if (!agent) return null

        if (!agent.hub_url) {
            const error_record: AgentRecord = {
                ...agent,
                is_online: false,
                is_checking: false,
                error: "Hub URL is empty"
            }
            const next_agents = { ...this.state.agents, [agent_id]: error_record }
            const is_active = agent_id === this.state.active_agent_id
            this.update_state({
                agents: next_agents,
                ...(is_active ? this.sync_active_snapshot(error_record) : {})
            })
            this.dispatchEvent(new Event("change"))
            return null
        }

        // Set checking state
        const checking_record: AgentRecord = { ...agent, is_checking: true, error: null }
        const intermediate_agents = { ...this.state.agents, [agent_id]: checking_record }
        const is_active = agent_id === this.state.active_agent_id
        this.update_state({
            agents: intermediate_agents,
            ...(is_active ? this.sync_active_snapshot(checking_record) : {})
        })
        this.dispatchEvent(new Event("change"))

        const caller = new RexecCaller({
            hub_url: agent.hub_url,
            token: agent.token
        })
        const start_time = performance.now()

        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 6000)
            const status = await caller.get_status(controller.signal)
            clearTimeout(timer)

            const latency = Math.round(performance.now() - start_time)
            const resolved_node_id = status.node_id || agent.node_id

            // Update stored node_id if discovered
            if (status.node_id && status.node_id !== agent.node_id) {
                const stored = agent_store.get(agent_id)
                if (stored) {
                    agent_store.set(agent_id, { ...stored, node_id: status.node_id })
                }
            }

            const updated_record: AgentRecord = {
                ...agent,
                node_id: resolved_node_id,
                is_checking: false,
                is_online: status.agent_connected,
                latency_ms: latency,
                error: null,
                last_checked_at: Date.now()
            }

            const next_agents = { ...this.state.agents, [agent_id]: updated_record }
            this.update_state({
                agents: next_agents,
                ...(is_active ? this.sync_active_snapshot(updated_record) : {})
            })
            this.dispatchEvent(new Event("change"))
            this.dispatchEvent(new Event("status_change"))
            return status
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`Health check failed for agent [${agent.name}]`, message)

            const failed_record: AgentRecord = {
                ...agent,
                is_checking: false,
                is_online: false,
                latency_ms: null,
                error: message,
                last_checked_at: Date.now()
            }

            const next_agents = { ...this.state.agents, [agent_id]: failed_record }
            this.update_state({
                agents: next_agents,
                ...(is_active ? this.sync_active_snapshot(failed_record) : {})
            })
            this.dispatchEvent(new Event("change"))
            this.dispatchEvent(new Event("status_change"))
            return null
        }
    }

    public async refresh_status(): Promise<HubStatus | null> {
        return this.refresh_agent_status(this.state.active_agent_id)
    }

    public async refresh_all_agents(): Promise<void> {
        await Promise.allSettled(this.state.agent_ids.map((id) => this.refresh_agent_status(id)))
    }

    public start_auto_refresh(interval_ms = 10000): () => void {
        this.refresh_all_agents()
        if (this.check_timer) clearInterval(this.check_timer)
        this.check_timer = setInterval(() => {
            this.refresh_all_agents()
        }, interval_ms)

        return () => {
            if (this.check_timer) {
                clearInterval(this.check_timer)
                this.check_timer = null
            }
        }
    }
}

export const session_controller = new SessionController()
