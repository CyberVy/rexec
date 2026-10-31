import localforage from "localforage"

export class LocalForageMap<V> {
    private lf_instance: LocalForage

    constructor(
        private readonly store_name = "keyval",
        private readonly db_name = "localforage"
    ) {
        this.lf_instance = localforage.createInstance({
            name: db_name,
            storeName: store_name
        })
    }

    public async get(key: string): Promise<V | undefined> {
        const val = await this.lf_instance.getItem<V>(key)
        return val === null ? undefined : val
    }

    public async set(key: string, value: V): Promise<this> {
        await this.lf_instance.setItem(key, value)
        return this
    }

    public async has(key: string): Promise<boolean> {
        const keys = await this.lf_instance.keys()
        return keys.includes(key)
    }

    public async delete(key: string): Promise<boolean> {
        const exists = await this.has(key)
        if (exists) {
            await this.lf_instance.removeItem(key)
            return true
        }
        return false
    }

    public async clear(): Promise<void> {
        await this.lf_instance.clear()
    }

    public async size(): Promise<number> {
        return await this.lf_instance.length()
    }

    public async keys(): Promise<string[]> {
        return await this.lf_instance.keys()
    }

    public async get_batch(keys: string[]): Promise<Map<string, V>> {
        const result = new Map<string, V>()
        await Promise.all(
            keys.map(async (key) => {
                const val = await this.get(key)
                if (val !== undefined) {
                    result.set(key, val)
                }
            })
        )
        return result
    }

    public async values(): Promise<V[]> {
        const list: V[] = []
        await this.lf_instance.iterate((val: V) => {
            list.push(val)
        })
        return list
    }
}
