import { is_dev } from "@/infra/version"
import { CacheStorageMap } from "@/infra/storage/cache.client"
import { create_logger } from "@/infra/logger"

const STATIC_RESOURCE_CACHE_NAME = "static-resource-cache"
const logger = create_logger("StaticCache")
const static_resource_cache = new CacheStorageMap(STATIC_RESOURCE_CACHE_NAME)
let update_promise: Promise<void> | null = null

async function update_static_resource_cache_content(): Promise<void> {
    const latest_index_html_response = await fetch("/", { cache: "no-store" })
    if (!latest_index_html_response.ok) return

    const latest_index_html_text = await latest_index_html_response.clone().text()
    const keys = await static_resource_cache.keys()
    if (!keys) return

    for (const key of keys) {
        const url = new URL(key.url)
        if (url.pathname !== "/") continue

        const cached_index_html_response = await static_resource_cache.get(key)
        if (!cached_index_html_response) break

        const cached_index_html_text = await cached_index_html_response.text()
        if (latest_index_html_text === cached_index_html_text) break

        const latest_relative_links = get_relative_links_from_html_string(latest_index_html_text)
        const cached_relative_links = keys.map((cached_key) => {
            const cached_url = new URL(cached_key.url)
            return cached_url.pathname + cached_url.search
        })

        // 1. Silent update: fetch and cache all missing new static assets first
        const fetch_promises = latest_relative_links
            .filter((link) => !cached_relative_links.includes(link))
            .map((link) =>
                fetch(link)
                    .then(async (link_response) => {
                        if (link_response.ok || link_response.type === "opaque") {
                            await static_resource_cache.set(new URL(link, location.origin), link_response)
                            logger.info("Updated static asset", { link })
                        } else {
                            logger.warn("Skipped caching failed response for asset", {
                                link,
                                status: link_response.status
                            })
                        }
                    })
                    .catch((error) => {
                        logger.error("Failed to update asset", { link, error })
                    })
            )

        await Promise.all(fetch_promises)

        // 2. Atomically update index.html only after all new assets are cached
        await static_resource_cache.delete(key)
        await static_resource_cache.set(key, latest_index_html_response)
        logger.info("Updated root index.html")

        // 3. Delete legacy assets after delay
        setTimeout(() => {
            cached_relative_links.forEach(async (link, index) => {
                if (latest_relative_links.includes(link)) return
                // Do not check "/" here because it has already been checked.
                if (link === "/" || link.startsWith("/?")) return

                await static_resource_cache
                    .delete(keys[index])
                    .then((deleted) => {
                        if (deleted) return
                        return static_resource_cache.delete(keys[index].url)
                    })
                    .then(() => logger.info("Deleted legacy asset", { link }))
            })
        }, 5000)
        break
    }
}

export function update_static_resource_cache(): Promise<void> {
    if (is_dev) return Promise.resolve()
    if (update_promise) return update_promise

    update_promise = update_static_resource_cache_content().finally(() => {
        update_promise = null
    })
    return update_promise
}

export function handle_fetch_for_static_resource(event: FetchEvent): void {
    if (is_dev) return

    const url = new URL(event.request.url)
    if (url.pathname === "/") {
        event.waitUntil(update_static_resource_cache())
    }

    const fetch_and_cache = async () => {
        const cached =
            (await static_resource_cache.get(event.request)) || (await static_resource_cache.get(event.request.url))
        if (cached) {
            return cached
        }
        const response = await fetch(event.request)
        if (response.status === 200) {
            await static_resource_cache.set(event.request, response.clone())
        }
        return response
    }

    event.respondWith(fetch_and_cache())
}

function get_relative_links_from_html_string(html: string): string[] {
    let matches = [...html.matchAll(/"(\/(?!>).+?)"/g)].map((match) => match[1])
    matches = matches.map((value) => (value.endsWith("\\") ? value.slice(0, -1) : value))
    return [...new Set(matches)]
}
