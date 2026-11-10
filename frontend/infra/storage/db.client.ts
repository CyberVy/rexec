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
        const val = await this.lf_instance.getItem(key)
        return val !== null
    }

    public async delete(key: string): Promise<boolean> {
        const exists = await this.has(key)
        await this.lf_instance.removeItem(key)
        return exists
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
        if (keys.length === 0) return result

        await this.lf_instance.ready()
        const db_info = (this.lf_instance as unknown as { _dbInfo?: { db: IDBDatabase; storeName: string } })._dbInfo
        if (this.lf_instance.driver() !== localforage.INDEXEDDB || !db_info?.db) {
            await Promise.all(
                keys.map(async (key) => {
                    const val = await this.get(key)
                    if (val !== undefined) result.set(key, val)
                })
            )
            return result
        }

        await new Promise<void>((resolve, reject) => {
            const transaction = db_info.db.transaction(db_info.storeName, "readonly")
            const store = transaction.objectStore(db_info.storeName)
            for (const key of keys) {
                const request = store.get(key)
                request.onsuccess = () => {
                    const value = request.result as V | null | undefined
                    if (value !== undefined && value !== null) result.set(key, value)
                }
            }
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error)
        })
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
