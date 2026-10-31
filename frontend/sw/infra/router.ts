export type RouteMatcher = string | ((request: Request, url: URL) => boolean)

export type RouteHandler = (event: FetchEvent, url: URL) => Promise<Response | null | void> | Response | null | void

type Route = {
    matcher: RouteMatcher
    handler: RouteHandler
    methods: readonly string[]
}

export class ServiceWorkerRouter {
    private routes: Route[] = []
    private is_listening = false

    public intercept(matcher: RouteMatcher, handler: RouteHandler, methods: readonly string[] = ["GET"]): void {
        this.routes.push({ matcher, handler, methods })
    }

    private matches(matcher: RouteMatcher, request: Request, url: URL): boolean {
        if (typeof matcher === "string") {
            if (matcher.endsWith("/*")) {
                const prefix = matcher.slice(0, -2)
                return url.pathname.startsWith(prefix)
            }
            return url.pathname === matcher
        }
        return matcher(request, url)
    }

    public handle = (event: FetchEvent): void => {
        const url = new URL(event.request.url)
        let responded = false
        const original_respond_with = event.respondWith.bind(event)

        event.respondWith = (response_promise) => {
            responded = true
            return original_respond_with(response_promise)
        }

        for (const route of this.routes) {
            if (!route.methods.includes(event.request.method)) continue
            if (this.matches(route.matcher, event.request, url)) {
                const result = route.handler(event, url)

                if (responded) {
                    return
                }

                if (result instanceof Promise) {
                    event.respondWith(result.then((res) => res || fetch(event.request)))
                    return
                }

                if (result instanceof Response) {
                    event.respondWith(result)
                    return
                }
            }
        }
    }

    public listen(scope = self as unknown as ServiceWorkerGlobalScope): void {
        if (this.is_listening) return
        this.is_listening = true
        scope.addEventListener("fetch", this.handle)
    }
}

export const router = new ServiceWorkerRouter()
