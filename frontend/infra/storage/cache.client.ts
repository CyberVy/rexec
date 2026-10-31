import { create_logger } from "../logger"

const logger = create_logger("CacheStorage")

export class CacheStorageMap {
    private cache_name: string
    private cache_storage: Cache | null = null
    private ready_promise: Promise<void>

    constructor(name: string) {
        this.cache_name = name
        this.ready_promise = this.init_cache()
    }

    private async init_cache(): Promise<void> {
        try {
            this.cache_storage = await caches.open(this.cache_name)
        } catch (e) {
            logger.error("Failed to open CacheStorage", { cache_name: this.cache_name, error: e })
        }
    }

    private async wait_until_ready(): Promise<Cache> {
        await this.ready_promise
        if (!this.cache_storage) {
            throw new Error(`CacheStorage ${this.cache_name} is not initialized.`)
        }
        return this.cache_storage
    }

    public async get(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<Response | undefined> {
        const cache = await this.wait_until_ready()
        return await cache.match(request, options)
    }

    public async set(request: RequestInfo | URL, response: Response): Promise<this> {
        const cache = await this.wait_until_ready()
        await cache.put(request, response)
        return this
    }

    public async has(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<boolean> {
        const cached = await this.get(request, options)
        return cached !== undefined
    }

    public async delete(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<boolean> {
        const cache = await this.wait_until_ready()
        return await cache.delete(request, options)
    }

    public async clear(): Promise<void> {
        await this.ready_promise
        await caches.delete(this.cache_name)
        this.ready_promise = this.init_cache()
        await this.ready_promise
    }

    public async size(): Promise<number> {
        const keys = await this.keys()
        return keys.length
    }

    public async keys(): Promise<readonly Request[]> {
        const cache = await this.wait_until_ready()
        return await cache.keys()
    }
}
