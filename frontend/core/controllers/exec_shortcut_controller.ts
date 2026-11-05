import { BaseController } from "@/infra/base_controller"
import { ShortcutCatalog } from "@/core/shortcut_catalog"

export interface ExecShortcut {
    id: string
    label: string
    command: string
}

export interface ExecShortcutState {
    items: ExecShortcut[]
}

export interface ExecShortcutDraft {
    label: string
    command: string
}

const EXEC_SHORTCUT_SEED: ExecShortcut[] = [
    { id: "exec_uname", label: "uname -a", command: "uname -a" },
    { id: "exec_pwd", label: "pwd", command: "pwd" },
    { id: "exec_ls", label: "ls", command: "ls" },
    { id: "exec_nvidia", label: "nvidia-smi", command: "nvidia-smi" },
    { id: "exec_python", label: "python3", command: "python3 --version" },
    { id: "exec_os", label: "os-release", command: "cat /etc/os-release" },
    { id: "exec_df", label: "df -h", command: "df -h" },
    { id: "exec_free", label: "free -m", command: "free -m" },
    { id: "exec_ip", label: "public ip", command: "curl https://4.ident.me -s" },
    { id: "exec_ipinfo", label: "ipinfo", command: "curl https://ipinfo.io -s" }
]

function normalize_exec_draft(draft: ExecShortcutDraft): { label: string; command: string } | null {
    const command = draft.command.trim()
    if (!command) return null
    const label = draft.label.trim() || command
    return { label, command }
}

export class ExecShortcutController extends BaseController<ExecShortcutState> {
    private readonly catalog = new ShortcutCatalog<ExecShortcut>("rexec_exec_shortcuts", EXEC_SHORTCUT_SEED)

    constructor() {
        super()
        this._state = { items: this.catalog.load() }
    }

    private commit(items: ExecShortcut[]): void {
        this.catalog.write(items)
        this.update_state({ items })
        this.dispatchEvent(new Event("change"))
    }

    public add(draft: ExecShortcutDraft): void {
        const normalized = normalize_exec_draft(draft)
        if (!normalized) return
        const item: ExecShortcut = {
            id: `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            ...normalized
        }
        this.commit([...this.state.items, item])
    }

    public update(id: string, draft: ExecShortcutDraft): void {
        const normalized = normalize_exec_draft(draft)
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

export const exec_shortcut_controller = new ExecShortcutController()
