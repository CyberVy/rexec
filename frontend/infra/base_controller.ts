export abstract class BaseController<State, EventType extends string = string> extends EventTarget {
    protected _state?: State

    public get state(): Readonly<State> {
        return this._state as State
    }

    protected update_state(partial: Partial<State>): void {
        if (this._state === undefined) return
        this._state = {
            ...this._state,
            ...partial
        }
        this.dispatchEvent(new Event("change"))
    }
}

export abstract class BaseKeyedController<
    Key extends string | number = string,
    Value = any,
    EventType extends string = string
> extends EventTarget {
    protected cache = new Map<Key, Value>()
    protected max_cache_size = 40
    protected cache_event_prefix = "item:"
    protected evict_on_limit = true

    public get_key_events(key: Key): (EventType | string)[] {
        return [`${this.cache_event_prefix}${key}`]
    }

    public get_value(key: Key, default_value: Value): Value {
        if (typeof key === "string" && key.length === 0) return default_value
        return this.cache.get(key) ?? default_value
    }

    protected remember(key: Key, value: Value): void {
        if (this.evict_on_limit && !this.cache.has(key) && this.cache.size >= this.max_cache_size) {
            const oldest = this.cache.keys().next().value
            if (oldest !== undefined) this.cache.delete(oldest)
        }
        this.cache.set(key, value)
        this.dispatchEvent(new CustomEvent(`${this.cache_event_prefix}${key}`, { detail: value }))
    }
}
