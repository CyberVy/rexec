import { BaseController } from "@/infra"
import type {
    ViewSwitcherState,
    ViewSwitcherInitState,
    ViewSwitcherListener,
    SetToolbarVisibleOptions,
    SwitchViewEventDetail,
    ViewSwitcherRegistryState
} from "./types"

export type {
    ViewSwitcherState,
    ViewSwitcherInitState,
    ViewSwitcherListener,
    SetToolbarVisibleOptions,
    SwitchViewEventDetail,
    ViewSwitcherRegistryState
} from "./types"

export const STATIC_EMPTY_VIEW_SWITCHER_STATE: ViewSwitcherState = {
    id: "",
    is_toolbar_visible: true,
    is_transitioning: false,
    has_other_transitioning: false,
    active_view_id: "",
    target_view_id: null
}

export const INITIAL_VIEW_SWITCHER_REGISTRY_STATE: ViewSwitcherRegistryState = {
    instances: {},
    has_any_transitioning: false,
    global_hide_count: 0
}

export const INITIAL_VIEW_SWITCHER_STATE = INITIAL_VIEW_SWITCHER_REGISTRY_STATE

export class ViewSwitcherController extends BaseController<ViewSwitcherRegistryState, "change" | "switch_view"> {
    protected override _state: ViewSwitcherRegistryState = INITIAL_VIEW_SWITCHER_REGISTRY_STATE

    private raw_instances: Record<string, ViewSwitcherInitState> = {}
    private instance_counts: Record<string, number> = {}
    private pending_visibilities: Record<string, boolean> = {}
    private fallback_states: Record<string, ViewSwitcherState> = {}

    public register(id: string, initial_state: ViewSwitcherInitState | ViewSwitcherState): () => void {
        this.instance_counts[id] = (this.instance_counts[id] ?? 0) + 1

        const existing_raw = this.raw_instances[id]
        const raw_state: ViewSwitcherInitState = existing_raw
            ? {
                  id: initial_state.id,
                  is_transitioning: initial_state.is_transitioning,
                  active_view_id: initial_state.active_view_id,
                  target_view_id: initial_state.target_view_id,
                  is_toolbar_visible: existing_raw.is_toolbar_visible
              }
            : {
                  id: initial_state.id,
                  is_toolbar_visible: initial_state.is_toolbar_visible,
                  is_transitioning: initial_state.is_transitioning,
                  active_view_id: initial_state.active_view_id,
                  target_view_id: initial_state.target_view_id
              }

        this.raw_instances[id] = raw_state
        this.recompute_state()

        return () => {
            const count = (this.instance_counts[id] ?? 1) - 1
            if (count <= 0) {
                delete this.instance_counts[id]
                delete this.raw_instances[id]
                delete this.pending_visibilities[id]
                delete this.fallback_states[id]
            } else {
                this.instance_counts[id] = count
            }
            this.recompute_state()
        }
    }

    public update_instance(
        id: string,
        updates: Partial<Omit<ViewSwitcherInitState, "id" | "is_toolbar_visible">>
    ): void {
        const current_raw = this.raw_instances[id]
        if (!current_raw) return

        let changed = false
        const next_raw: ViewSwitcherInitState = { ...current_raw }

        if (updates.is_transitioning !== undefined && updates.is_transitioning !== current_raw.is_transitioning) {
            next_raw.is_transitioning = updates.is_transitioning
            changed = true
        }

        if (updates.active_view_id !== undefined && updates.active_view_id !== current_raw.active_view_id) {
            next_raw.active_view_id = updates.active_view_id
            changed = true
        }

        if (updates.target_view_id !== undefined && updates.target_view_id !== current_raw.target_view_id) {
            next_raw.target_view_id = updates.target_view_id
            changed = true
        }

        if (!changed) return

        if (updates.is_transitioning === false && id in this.pending_visibilities) {
            const pending = this.pending_visibilities[id]
            delete this.pending_visibilities[id]
            if (pending !== undefined && next_raw.is_toolbar_visible !== pending) {
                next_raw.is_toolbar_visible = pending
            }
        }

        this.raw_instances[id] = next_raw
        this.recompute_state()
    }

    public set_toolbar_visible(id: string, visible: boolean, options?: SetToolbarVisibleOptions): void {
        const current_raw = this.raw_instances[id]
        const wait_until_stable = options?.wait_until_stable ?? false

        if (wait_until_stable && current_raw?.is_transitioning) {
            this.pending_visibilities[id] = visible
            return
        }

        delete this.pending_visibilities[id]

        if (current_raw) {
            if (current_raw.is_toolbar_visible !== visible) {
                this.raw_instances[id] = {
                    ...current_raw,
                    is_toolbar_visible: visible
                }
                this.recompute_state()
            }
        } else {
            this.raw_instances[id] = {
                id,
                is_toolbar_visible: visible,
                is_transitioning: false,
                active_view_id: "",
                target_view_id: null
            }
            this.recompute_state()
        }
    }

    public show_toolbar(id: string, options?: SetToolbarVisibleOptions): void {
        this.set_toolbar_visible(id, true, options)
    }

    public hide_toolbar(id: string, options?: SetToolbarVisibleOptions): void {
        this.set_toolbar_visible(id, false, options)
    }

    public hide_all_toolbars(): void {
        const next_hide_count = this.state.global_hide_count + 1
        this.recompute_state(next_hide_count)
    }

    public show_all_toolbars(): void {
        const next_hide_count = Math.max(0, this.state.global_hide_count - 1)
        this.recompute_state(next_hide_count)
    }

    public switch_view(view_id: string, switcher_id?: string): boolean {
        const id = switcher_id ?? this.get_default_switcher_id()
        if (!id || !(id in this.state.instances)) return false

        this.dispatchEvent(
            new CustomEvent<SwitchViewEventDetail>("switch_view", {
                detail: { switcher_id: id, view_id }
            })
        )
        return true
    }

    public get_default_switcher_id(): string | undefined {
        if ("main_switcher" in this.state.instances) {
            return "main_switcher"
        }
        return Object.keys(this.state.instances)[0]
    }

    public get_active_view_id(switcher_id?: string): string | undefined {
        const id = switcher_id ?? this.get_default_switcher_id()
        if (!id) return undefined
        return this.state.instances[id]?.active_view_id
    }

    public get_state(id: string): ViewSwitcherState {
        const found = this.state.instances[id]
        if (found) return found

        const is_toolbar_visible = this.state.global_hide_count === 0
        const has_other_transitioning = this.state.has_any_transitioning
        const cached_fallback = this.fallback_states[id]
        if (
            cached_fallback &&
            cached_fallback.is_toolbar_visible === is_toolbar_visible &&
            cached_fallback.has_other_transitioning === has_other_transitioning
        ) {
            return cached_fallback
        }

        const new_fallback: ViewSwitcherState = {
            id,
            is_toolbar_visible,
            is_transitioning: false,
            has_other_transitioning,
            active_view_id: "",
            target_view_id: null
        }
        this.fallback_states[id] = new_fallback
        return new_fallback
    }

    public has_any_transitioning(exclude_id?: string): boolean {
        if (!exclude_id) {
            return this.state.has_any_transitioning
        }
        const instance = this.state.instances[exclude_id]
        if (instance) {
            return instance.has_other_transitioning
        }
        for (const inst of Object.values(this.state.instances)) {
            if (inst.id !== exclude_id && inst.is_transitioning) {
                return true
            }
        }
        return false
    }

    private recompute_state(next_global_hide_count: number = this.state.global_hide_count): void {
        const is_globally_hidden = next_global_hide_count > 0
        const current_instances = this.state.instances
        let any_instance_changed = false
        const next_instances: Record<string, ViewSwitcherState> = {}

        const raw_keys = Object.keys(this.raw_instances)
        const current_keys = Object.keys(current_instances)
        if (raw_keys.length !== current_keys.length) {
            any_instance_changed = true
        }

        let transitioning_count = 0
        for (const raw of Object.values(this.raw_instances)) {
            if (raw.is_transitioning) {
                transitioning_count++
            }
        }
        const has_any_trans = transitioning_count > 0

        for (const [id, raw] of Object.entries(this.raw_instances)) {
            const effective_toolbar = is_globally_hidden ? false : raw.is_toolbar_visible
            const has_other_trans = raw.is_transitioning ? transitioning_count > 1 : transitioning_count > 0

            const prev = current_instances[id]
            if (
                prev &&
                prev.id === raw.id &&
                prev.is_toolbar_visible === effective_toolbar &&
                prev.is_transitioning === raw.is_transitioning &&
                prev.has_other_transitioning === has_other_trans &&
                prev.active_view_id === raw.active_view_id &&
                prev.target_view_id === raw.target_view_id
            ) {
                next_instances[id] = prev
            } else {
                next_instances[id] = {
                    id: raw.id,
                    is_toolbar_visible: effective_toolbar,
                    is_transitioning: raw.is_transitioning,
                    has_other_transitioning: has_other_trans,
                    active_view_id: raw.active_view_id,
                    target_view_id: raw.target_view_id
                }
                any_instance_changed = true
            }
        }

        const count_changed = next_global_hide_count !== this.state.global_hide_count
        const transitioning_changed = has_any_trans !== this.state.has_any_transitioning

        if (any_instance_changed || count_changed || transitioning_changed) {
            this._state = {
                instances: next_instances,
                has_any_transitioning: has_any_trans,
                global_hide_count: next_global_hide_count
            }
            this.dispatchEvent(new Event("change"))
        }
    }
}

export const view_switcher_controller = new ViewSwitcherController()
