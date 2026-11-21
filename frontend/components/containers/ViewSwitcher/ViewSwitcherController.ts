import { BaseController } from "@/infra"
import type {
    ResolvedToolbarColor,
    SwitchViewEventDetail,
    ToolbarColor,
    ViewSwitcherControllerState,
    ViewSwitcherInstance
} from "./types"

const GLOBAL_COLOR_SCOPE = "*"

export const INITIAL_VIEW_SWITCHER_STATE: ViewSwitcherControllerState = {
    instances: {},
    is_toolbar_hidden: false,
    active_color_overrides: {},
    view_active_color_overrides: {}
}

export function normalize_toolbar_color(color: ToolbarColor | null | undefined): ResolvedToolbarColor | null {
    if (!color) return null
    if (typeof color === "string") {
        const trimmed = color.trim()
        return trimmed ? { light: trimmed, dark: trimmed } : null
    }
    const light = color.light.trim()
    const dark = color.dark.trim()
    if (!light && !dark) return null
    return { light: light || dark, dark: dark || light }
}

function view_color_key(view_id: string, switcher_id?: string): string {
    return `${switcher_id ?? GLOBAL_COLOR_SCOPE}:${view_id}`
}

function are_colors_equal(a: ResolvedToolbarColor | undefined, b: ResolvedToolbarColor | null): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    return a.light === b.light && a.dark === b.dark
}

export function resolve_toolbar_active_color(
    state: Readonly<ViewSwitcherControllerState>,
    switcher_id: string,
    view_id: string,
    view_default?: ToolbarColor,
    toolbar_default?: ToolbarColor
): ResolvedToolbarColor | null {
    return (
        state.view_active_color_overrides[view_color_key(view_id, switcher_id)] ??
        state.view_active_color_overrides[view_color_key(view_id)] ??
        state.active_color_overrides[switcher_id] ??
        state.active_color_overrides[GLOBAL_COLOR_SCOPE] ??
        normalize_toolbar_color(view_default) ??
        normalize_toolbar_color(toolbar_default) ??
        null
    )
}

class ViewSwitcherController extends BaseController<ViewSwitcherControllerState, "change" | "switch_view"> {
    protected override _state: ViewSwitcherControllerState = INITIAL_VIEW_SWITCHER_STATE

    private registration_tokens = new Map<string, symbol>()

    // ============================================================================
    // Public Imperative API
    // ============================================================================

    public switch_view(view_id: string, switcher_id?: string): boolean {
        const id = switcher_id ?? this.get_root_switcher_id()
        if (!id || !(id in this._state.instances)) return false

        this.dispatchEvent(
            new CustomEvent<SwitchViewEventDetail>("switch_view", {
                detail: { switcher_id: id, view_id }
            })
        )
        return true
    }

    public hide_toolbar(): void {
        if (this._state.is_toolbar_hidden) return
        this.update_state({ is_toolbar_hidden: true })
    }

    public show_toolbar(): void {
        if (!this._state.is_toolbar_hidden) return
        this.update_state({ is_toolbar_hidden: false })
    }

    public set_active_color(color: ToolbarColor | null, switcher_id?: string): void {
        const key = switcher_id ?? GLOBAL_COLOR_SCOPE
        const resolved = normalize_toolbar_color(color)
        if (are_colors_equal(this._state.active_color_overrides[key], resolved)) return

        const next_overrides = { ...this._state.active_color_overrides }
        if (resolved) {
            next_overrides[key] = resolved
        } else {
            delete next_overrides[key]
        }
        this.update_state({ active_color_overrides: next_overrides })
    }

    public set_view_active_color(view_id: string, color: ToolbarColor | null, switcher_id?: string): void {
        const key = view_color_key(view_id, switcher_id)
        const resolved = normalize_toolbar_color(color)
        if (are_colors_equal(this._state.view_active_color_overrides[key], resolved)) return

        const next_overrides = { ...this._state.view_active_color_overrides }
        if (resolved) {
            next_overrides[key] = resolved
        } else {
            delete next_overrides[key]
        }
        this.update_state({ view_active_color_overrides: next_overrides })
    }

    // ============================================================================
    // Internal Registry Coordination
    // ============================================================================

    public register(instance: ViewSwitcherInstance): () => void {
        const token = Symbol(instance.id)
        this.registration_tokens.set(instance.id, token)

        this.update_state({
            instances: {
                ...this._state.instances,
                [instance.id]: instance
            }
        })

        return () => {
            if (this.registration_tokens.get(instance.id) !== token) return
            this.registration_tokens.delete(instance.id)

            const next_instances = { ...this._state.instances }
            delete next_instances[instance.id]
            this.update_state({ instances: next_instances })
        }
    }

    public update_instance(
        id: string,
        updates: Partial<Pick<ViewSwitcherInstance, "parent_id" | "active_view_id" | "is_transitioning">>
    ): void {
        const current = this._state.instances[id]
        if (!current) return

        const next_parent_id = updates.parent_id !== undefined ? updates.parent_id : current.parent_id
        const next_active_view_id =
            updates.active_view_id !== undefined ? updates.active_view_id : current.active_view_id
        const next_is_transitioning =
            updates.is_transitioning !== undefined ? updates.is_transitioning : current.is_transitioning

        if (
            next_parent_id === current.parent_id &&
            next_active_view_id === current.active_view_id &&
            next_is_transitioning === current.is_transitioning
        ) {
            return
        }

        this.update_state({
            instances: {
                ...this._state.instances,
                [id]: {
                    id: current.id,
                    parent_id: next_parent_id,
                    active_view_id: next_active_view_id,
                    is_transitioning: next_is_transitioning
                }
            }
        })
    }

    public has_other_transitioning(exclude_id: string): boolean {
        for (const instance of Object.values(this._state.instances)) {
            if (instance.id !== exclude_id && instance.is_transitioning) {
                return true
            }
        }
        return false
    }

    private get_root_switcher_id(): string | undefined {
        for (const instance of Object.values(this._state.instances)) {
            if (instance.parent_id === null) {
                return instance.id
            }
        }
        return Object.keys(this._state.instances)[0]
    }
}

export const view_switcher_controller = new ViewSwitcherController()
