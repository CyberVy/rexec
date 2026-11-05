import { LocalStorageMap } from "@/infra/storage/kv.client"

export interface ShortcutRecord {
    id: string
}

export class ShortcutCatalog<T extends ShortcutRecord> {
    private readonly order_store: LocalStorageMap<string[]>
    private readonly entity_store: LocalStorageMap<T>

    constructor(
        name: string,
        private readonly seed: T[]
    ) {
        this.order_store = new LocalStorageMap<string[]>(`${name}_orders`)
        this.entity_store = new LocalStorageMap<T>(`${name}_items`)
    }

    public load(): T[] {
        const ids = this.order_store.get("order")
        if (!ids) {
            const seeded = this.seed.map((item) => ({ ...item }))
            this.write(seeded)
            return seeded
        }

        const items: T[] = []
        const valid_ids: string[] = []
        for (const id of ids) {
            const entity = this.entity_store.get(id)
            if (!entity) continue
            items.push(entity)
            valid_ids.push(id)
        }
        if (valid_ids.length !== ids.length) {
            this.order_store.set("order", valid_ids)
        }
        return items
    }

    public write(items: T[]): void {
        const previous = new Set(this.order_store.get("order") ?? [])
        const next_ids = items.map((item) => item.id)
        for (const id of previous) {
            if (!next_ids.includes(id)) {
                this.entity_store.delete(id)
            }
        }
        for (const item of items) {
            this.entity_store.set(item.id, item)
        }
        this.order_store.set("order", next_ids)
    }
}
