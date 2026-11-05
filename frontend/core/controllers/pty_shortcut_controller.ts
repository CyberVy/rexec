import { BaseController } from "@/infra/base_controller"
import { ShortcutCatalog } from "@/core/shortcut_catalog"

export type PtyShortcutKind = "command" | "key"

export interface PtyShortcut {
    id: string
    label: string
    payload: string
    kind: PtyShortcutKind
}

export interface PtyShortcutState {
    items: PtyShortcut[]
}

export interface PtyShortcutDraft {
    label: string
    payload: string
    kind: PtyShortcutKind
}

const PTY_SHORTCUT_SEED: PtyShortcut[] = [
    { id: "pty_ls", label: "ls", payload: "ls", kind: "command" },
    { id: "pty_pwd", label: "pwd", payload: "pwd", kind: "command" },
    { id: "pty_quit", label: "q", payload: "q", kind: "key" }
]

function normalize_pty_draft(draft: PtyShortcutDraft): { label: string; payload: string; kind: PtyShortcutKind } | null {
    const payload = draft.kind === "key" ? draft.payload : draft.payload.trim()
    if (!payload) return null
    const label = draft.label.trim() || payload
    return { label, payload, kind: draft.kind }
}

export class PtyShortcutController extends BaseController<PtyShortcutState> {
    private readonly catalog = new ShortcutCatalog<PtyShortcut>("rexec_pty_shortcuts", PTY_SHORTCUT_SEED)

    constructor() {
        super()
        this._state = { items: this.catalog.load() }
    }

    private commit(items: PtyShortcut[]): void {
        this.catalog.write(items)
        this.update_state({ items })
        this.dispatchEvent(new Event("change"))
    }

    public add(draft: PtyShortcutDraft): void {
        const normalized = normalize_pty_draft(draft)
        if (!normalized) return
        const item: PtyShortcut = {
            id: `pty_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            ...normalized
        }
        this.commit([...this.state.items, item])
    }

    public update(id: string, draft: PtyShortcutDraft): void {
        const normalized = normalize_pty_draft(draft)
        if (!normalized) return
        const items = this.state.items.map((item) => (item.id === id ? { ...item, ...normalized } : item))
        this.commit(items)
    }

    public remove(id: string): void {
        this.commit(this.state.items.filter((item) => item.id !== id))
    }

    public move(id: string, offset: -1 | 1): void {
        const items = [...this.state.items]
        const index = items.findIndex((item) => item.id === id)
        const next_index = index + offset
        if (index < 0 || next_index < 0 || next_index >= items.length) return
        const [item] = items.splice(index, 1)
        if (!item) return
        items.splice(next_index, 0, item)
        this.commit(items)
    }
}

export const pty_shortcut_controller = new PtyShortcutController()
