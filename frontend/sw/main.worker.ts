/// <reference lib="webworker" />

import { router } from "@/sw/infra/router"
import { handle_fetch_for_static_resource, update_static_resource_cache } from "@/sw/infra/static_cache"
import { SERVICE_WORKER_API_PATH, type ServiceWorkerApiRequestEnvelope } from "@/infra"

const sw = self as unknown as ServiceWorkerGlobalScope

// 1. Main-thread API requests use the same fetch event as resource requests.
router.intercept(
    (request, url) => url.origin === location.origin && url.pathname === SERVICE_WORKER_API_PATH,
    async (event) => {
        if (event.request.method !== "POST") {
            return new Response(
                JSON.stringify({
                    ok: false,
                    error: { code: "method_not_allowed", message: "Use POST for service worker API requests" }
                }),
                {
                    status: 405,
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store"
                    }
                }
            )
        }

        try {
            const body = (await event.request.json()) as ServiceWorkerApiRequestEnvelope
            if (body?.type === "static_cache_update") {
                await update_static_resource_cache()
                return new Response(JSON.stringify({ ok: true, data: undefined }), {
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store"
                    }
                })
            }
            return new Response(
                JSON.stringify({
                    ok: false,
                    error: { code: "unknown_operation", message: "Unknown service worker API operation" }
                }),
                {
                    status: 404,
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store"
                    }
                }
            )
        } catch (error) {
            return new Response(
                JSON.stringify({
                    ok: false,
                    error: { code: "operation_failed", message: "Service worker API operation failed" }
                }),
                {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store"
                    }
                }
            )
        }
    },
    ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
)

// 2. Local Static Web Assets
router.intercept((_request, url) => {
    if (url.hostname !== location.hostname) return false
    if (url.href === location.href) return false
    return ["/"].some((prefix) => url.pathname.startsWith(prefix))
}, handle_fetch_for_static_resource)

router.listen()

sw.addEventListener("install", () => sw.skipWaiting())
sw.addEventListener("activate", (event) => event.waitUntil(sw.clients.claim()))
