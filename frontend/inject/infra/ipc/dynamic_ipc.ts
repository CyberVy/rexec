import { handle_web_ipc, web_ipc_call } from "@/infra/web_ipc.client"

export type RemoteProxy<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => RemoteProxy<R> : RemoteProxy<T[K]>
} & {
    $execute(): Promise<any>
    $set(value: any): Promise<any>
}

export function remote(targetWindow: Window): any
export function remote<T>(targetWindow: Window): RemoteProxy<T>
export function remote(targetWindow: Window): any {
    const steps: any[] = []

    const create_proxy = (path: string[]): any => {
        return new Proxy(() => {}, {
            get(target, prop: string) {
                if (prop === "$execute") {
                    return () =>
                        web_ipc_call({
                            target: targetWindow,
                            type: "ipc_chain",
                            payload: { steps }
                        })
                }
                if (prop === "$set") {
                    return (value: any) => {
                        steps.push({ op: "set", value })
                        return web_ipc_call({
                            target: targetWindow,
                            type: "ipc_chain",
                            payload: { steps }
                        })
                    }
                }

                steps.push({ op: "get", name: prop })
                return create_proxy([...path, prop])
            },
            apply(target, thisArg, argList) {
                steps.push({ op: "call", args: argList })
                return create_proxy(path)
            }
        })
    }

    return create_proxy([])
}

export function register_dynamic_ipc() {
    handle_web_ipc({
        type: "ipc_chain",
        handler: async (payload) => {
            const { steps } = payload as { steps: any[] }
            let current: any = window
            let parent: any = undefined
            let last_prop_name = ""

            for (const step of steps) {
                if (step.op === "get") {
                    parent = current
                    last_prop_name = step.name
                    current = current[step.name]
                } else if (step.op === "call") {
                    if (typeof current !== "function") {
                        throw new Error(`Property "${last_prop_name}" is not a function`)
                    }
                    current = current.apply(parent, step.args)
                } else if (step.op === "set") {
                    if (parent === undefined || parent === null) {
                        throw new Error("No parent context to set value")
                    }
                    parent[last_prop_name] = step.value
                    current = step.value
                }
            }
            return current
        }
    })
}
