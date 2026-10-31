export abstract class BaseController<State, EventType extends string = string> extends EventTarget {
    protected _state?: State

    public get state(): Readonly<State> {
        return this._state as State
    }

    protected update_state(partial: Partial<State>): void {
        if (this._state !== undefined) {
            this._state = {
                ...this._state,
                ...partial
            }
        }
    }
}

export abstract class BaseKeyedController<
    Key extends string | number = string,
    Value = any,
    EventType extends string = string
> extends EventTarget {
    /**
     * Define the event names that trigger changes for a specific key.
     * Handled and determined entirely by the subclass.
     */
    public abstract get_key_events(key: Key): (EventType | string)[]

    public abstract get_value(key: Key, default_value: Value): Value
}
