import { exec_command } from "./exec"
import { ForwardMuxClient, open_forward_tunnel, type ForwardTunnelClient } from "./forward"
import { pull_http, push_http } from "./file"
import {
    PtyMuxClient,
    connect_pty_session,
    open_pty_session,
    type PtyClient,
    type PtyClientOptions,
    type PtyConnection
} from "./pty"
import {
    HUB_ROUTES,
    type CallerOptions,
    type ExecOptions,
    type HubStatus,
    type PullOptions,
    type PullResult,
    type PushOptions,
    type PushResult,
    type PtyOptions,
    type PtySessionInfo,
    type TransferSink,
    type TransferSource
} from "./types"

export * from "./types"
export * from "./forward"
export * from "./pty"

export function format_http_url(url_str: string): string {
    let http_url = url_str.trim()
    if (http_url.startsWith("wss://")) {
        http_url = "https://" + http_url.slice(6)
    } else if (http_url.startsWith("ws://")) {
        http_url = "http://" + http_url.slice(5)
    } else if (!http_url.startsWith("https://") && !http_url.startsWith("http://")) {
        http_url = "https://" + http_url
    }
    return http_url
}

/**
 * Universal, runtime-agnostic Rexec Caller using 100% Web Standard APIs.
 * Runs in Browsers, Node.js, Cloudflare Workers, Deno, and Bun.
 */
export class RexecCaller {
    public readonly hub_url: string
    public readonly token: string
    private readonly keep_alive: boolean
    private pty_mux: PtyMuxClient | null = null
    private forward_mux: ForwardMuxClient | null = null

    public constructor(options: CallerOptions) {
        this.hub_url = format_http_url(options.hub_url)
        this.token = options.token.trim()
        this.keep_alive = Boolean(options.keep_alive)
    }

    /**
     * Query Hub health and check whether an agent is connected.
     */
    public async get_status(signal?: AbortSignal): Promise<HubStatus> {
        const url = new URL(this.hub_url)
        url.pathname = HUB_ROUTES.HEALTH.path
        if (this.token) {
            url.searchParams.set("token", this.token)
        }

        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${this.token}` },
            signal
        })
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`)
        }
        return (await res.json()) as HubStatus
    }

    /**
     * Execute a remote command via SSE stream.
     * Returns the remote process exit code.
     */
    public async exec(
        options: ExecOptions,
        on_chunk?: (stream: "stdout" | "stderr", data: string) => void
    ): Promise<number> {
        return exec_command(this.hub_url, this.token, options, on_chunk)
    }

    /**
     * Pull (download) a remote file or directory into a TransferSink.
     */
    public async pull(remote_path: string, sink: TransferSink, options?: PullOptions): Promise<PullResult> {
        return pull_http(this.hub_url, this.token, remote_path, sink, options)
    }

    /**
     * Push (upload) a TransferSource to the remote agent.
     */
    public async push(source: TransferSource, remote_path: string, options?: PushOptions): Promise<PushResult> {
        return push_http(this.hub_url, this.token, source, remote_path, options)
    }

    /**
     * Open a multiplexed port forwarding tunnel to a remote agent port.
     */
    public async forward(
        remote_port: number,
        options?: { signal?: AbortSignal; timeout_ms?: number }
    ): Promise<ForwardTunnelClient> {
        return open_forward_tunnel({
            hub_url: this.hub_url,
            token: this.token,
            remote_port,
            signal: options?.signal,
            timeout_ms: options?.timeout_ms,
            transport: this.get_forward_mux()
        })
    }

    /**
     * Open an interactive PTY session on the remote agent.
     * The returned client carries raw terminal bytes until the process exits.
     */
    public async open_pty(options: PtyOptions): Promise<PtyClient> {
        return open_pty_session(this.pty_client_options(options))
    }

    /**
     * Open a resilient PTY connection with automatic byte-offset reconnect after initial connect.
     */
    public connect_pty(options: PtyOptions): PtyConnection {
        return connect_pty_session(this.pty_client_options(options))
    }

    private pty_client_options(options: PtyOptions): PtyClientOptions {
        return {
            hub_url: this.hub_url,
            token: this.token,
            session_id: options.session_id,
            offset: options.offset,
            file: options.file,
            args: options.args,
            cwd: options.cwd,
            cols: options.cols,
            rows: options.rows,
            term: options.term,
            orphan_ttl_ms: options.orphan_ttl_ms,
            persistent: options.persistent,
            signal: options.signal,
            transport: this.get_pty_mux()
        }
    }

    /**
     * List all active and detached PTY sessions on the remote agent.
     */
    public async list_ptys(): Promise<PtySessionInfo[]> {
        return this.get_pty_mux().list_ptys()
    }

    /**
     * Terminate and clean up a remote PTY session by session_id.
     */
    public async kill_pty(session_id: string): Promise<void> {
        return this.get_pty_mux().kill_pty(session_id)
    }

    /**
     * Update configuration for a remote PTY session (e.g. toggle persistence).
     */
    public async update_pty(session_id: string, updates: { persistent: boolean }): Promise<void> {
        return this.get_pty_mux().update_pty(session_id, updates)
    }

    /**
     * Set persistence for a remote PTY session.
     */
    public async set_pty_persistent(session_id: string, persistent: boolean): Promise<void> {
        await this.update_pty(session_id, { persistent })
    }

    /**
     * Close shared WebSocket transports maintained by this caller instance.
     */
    public close(): void {
        this.pty_mux?.close()
        this.pty_mux = null
        this.forward_mux?.close()
        this.forward_mux = null
    }

    private get_pty_mux(): PtyMuxClient {
        this.pty_mux ??= new PtyMuxClient({
            hub_url: this.hub_url,
            token: this.token,
            keep_alive: this.keep_alive
        })
        return this.pty_mux
    }

    private get_forward_mux(): ForwardMuxClient {
        this.forward_mux ??= new ForwardMuxClient({
            hub_url: this.hub_url,
            token: this.token,
            keep_alive: this.keep_alive
        })
        return this.forward_mux
    }
}
