import type { FileSink, FileSource, PullOptions, PullResult, PushOptions, PushResult } from "@/file/types"

/**
 * Fetches a remote file or directory from the Hub and pipes the body to a FileSink.
 */
export async function pull_http(
    hub_url: string,
    token: string,
    remote_path: string,
    sink: FileSink,
    options?: PullOptions
): Promise<PullResult> {
    const pull_url = new URL(hub_url)
    pull_url.pathname = "/file/pull"
    pull_url.searchParams.set("path", remote_path)
    pull_url.searchParams.set("token", token)
    if (options?.recursive) {
        pull_url.searchParams.set("recursive", "1")
    }

    const res = await fetch(pull_url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: options?.signal
    })

    if (!res.ok) {
        const err_data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
        throw new Error(err_data.error || res.statusText)
    }

    if (!res.body) {
        throw new Error("Empty response body")
    }

    const is_directory = res.headers.get("X-Is-Directory") === "1" || Boolean(options?.recursive)
    const total_size = Number(res.headers.get("Content-Length") || 0)

    let transferred = 0
    const start_time = Date.now()
    const tracker = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            transferred += chunk.byteLength
            const elapsed_s = (Date.now() - start_time) / 1000
            const speed = elapsed_s > 0 ? transferred / elapsed_s : 0
            options?.on_progress?.({ transferred, total: total_size, speed }, chunk)
            controller.enqueue(chunk)
        }
    })

    try {
        await res.body.pipeThrough(tracker).pipeTo(sink.stream)
        await sink.wait_for_finish()
    } catch (err) {
        sink.cleanup?.()
        throw err
    }

    return { transferred, is_directory }
}

/**
 * Streams a FileSource to the Hub over HTTP POST.
 */
export async function push_http(
    hub_url: string,
    token: string,
    source: FileSource,
    remote_path: string,
    options?: PushOptions
): Promise<PushResult> {
    const push_url = new URL(hub_url)
    push_url.pathname = "/file/push"
    push_url.searchParams.set("path", remote_path)
    push_url.searchParams.set("token", token)
    if (source.is_directory) {
        push_url.searchParams.set("recursive", "1")
    } else {
        push_url.searchParams.set("size", String(source.size))
    }

    let transferred = 0
    const start_time = Date.now()
    const tracker = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            transferred += chunk.byteLength
            const elapsed_s = (Date.now() - start_time) / 1000
            const speed = elapsed_s > 0 ? transferred / elapsed_s : 0
            options?.on_progress?.({ transferred, total: source.size, speed }, chunk)
            controller.enqueue(chunk)
        }
    })

    const stream = source.stream.pipeThrough(tracker)
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream"
    }
    if (!source.is_directory && source.size > 0) {
        headers["Content-Length"] = String(source.size)
    }

    let res: Response
    try {
        res = await fetch(push_url.toString(), {
            method: "POST",
            headers,
            body: stream,
            // @ts-expect-error Node fetch requires duplex: 'half' for streaming request bodies
            duplex: "half",
            signal: options?.signal
        })
    } catch (err) {
        source.cleanup?.()
        throw err
    }

    if (!res.ok) {
        const err_data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
        throw new Error(err_data.error || res.statusText)
    }

    const result = (await res.json().catch(() => ({}))) as { sha256?: string }
    return {
        transferred,
        is_directory: source.is_directory,
        sha256: result.sha256
    }
}
