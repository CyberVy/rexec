export class LocalStorageMap<V> {
    private namespace: string

    constructor(namespace: string) {
        this.namespace = namespace
    }

    private get_full_key(key: string): string {
        return `${this.namespace}:${key}`
    }

    public get(key: string): V | undefined {
        const val = localStorage.getItem(this.get_full_key(key))
        if (val === null) return undefined
        try {
            return JSON.parse(val) as V
        } catch {
            return val as unknown as V
        }
    }

    public set(key: string, value: V): this {
        const val_str = typeof value === "string" ? value : JSON.stringify(value)
        localStorage.setItem(this.get_full_key(key), val_str as string)
        return this
    }

    public has(key: string): boolean {
        return localStorage.getItem(this.get_full_key(key)) !== null
    }

    public delete(key: string): boolean {
        const full_key = this.get_full_key(key)
        if (localStorage.getItem(full_key) !== null) {
            localStorage.removeItem(full_key)
            return true
        }
        return false
    }

    public clear(): void {
        const prefix = `${this.namespace}:`
        const keys_to_remove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key?.startsWith(prefix)) {
                keys_to_remove.push(key)
            }
        }
        keys_to_remove.forEach((key) => localStorage.removeItem(key))
    }

    public keys(): string[] {
        const prefix = `${this.namespace}:`
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key?.startsWith(prefix)) {
                keys.push(key.slice(prefix.length))
            }
        }
        return keys
    }
}
