import crypto from "node:crypto"
import path from "node:path"
import type { FileSink, FileSource } from "@/file"
import { create_node_sink, create_node_source } from "@/file/adapters/node"
import type { AgentToHubMessage, FilePullStartMessage, FilePushStartMessage, TransferErrorMessage } from "@/protocol"
import { decode_transfer_frame, encode_transfer_frame } from "@/transport"

export class TransferManager {
    private active_pulls: Map<string, { source: FileSource }> = new Map()
    private active_pushes: Map<
        string,
        {
            sink: FileSink
            writer: WritableStreamDefaultWriter<Uint8Array>
            hash: crypto.Hash
        }
    > = new Map()

    public handle_pull_start(
        msg: FilePullStartMessage,
        workspace: string,
        send: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void
    ): void {
        const target_path = path.isAbsolute(msg.path) ? path.resolve(msg.path) : path.resolve(workspace, msg.path)

        console.log(`[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Preparing to send: ${target_path}`)

        let source: FileSource
        try {
            source = create_node_source(target_path, Boolean(msg.recursive))
        } catch (err) {
            send({
                type: "transfer:error",
                transfer_id: msg.transfer_id,
                error: (err as Error).message
            })
            return
        }

        send({
            type: "file:pull_meta",
            transfer_id: msg.transfer_id,
            meta: {
                path: target_path,
                size: source.size,
                is_directory: source.is_directory,
                mtime: source.mtime,
                mode: source.mode
            }
        })

        const hash = crypto.createHash("sha256")
        this.active_pulls.set(msg.transfer_id, { source })

        void (async () => {
            try {
                for await (const chunk of source.stream) {
                    hash.update(chunk)
                    const packet = encode_transfer_frame(msg.transfer_id, chunk)
                    send_binary(packet)
                }
                const sha256 = hash.digest("hex")
                console.log(
                    `[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Completed (${source.size || "stream"} bytes, sha256: ${sha256.slice(0, 8)})`
                )
                send({
                    type: "file:pull_end",
                    transfer_id: msg.transfer_id,
                    sha256
                })
            } catch (err) {
                console.error(`[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Stream error:`, err)
                send({
                    type: "transfer:error",
                    transfer_id: msg.transfer_id,
                    error: `Transfer failed: ${(err as Error).message}`
                })
                source.cleanup?.()
            } finally {
                this.active_pulls.delete(msg.transfer_id)
            }
        })()
    }

    public handle_push_start(msg: FilePushStartMessage, workspace: string, send: (msg: AgentToHubMessage) => void): void {
        const target_path = path.isAbsolute(msg.path) ? path.resolve(msg.path) : path.resolve(workspace, msg.path)

        console.log(
            `[rexec-agent] [push:${msg.transfer_id.slice(0, 8)}] Preparing to receive: ${target_path} (${msg.recursive ? "directory" : `${msg.size} bytes`})`
        )

        try {
            const sink = create_node_sink(target_path, Boolean(msg.recursive))
            const writer = sink.stream.getWriter()
            const hash = crypto.createHash("sha256")
            this.active_pushes.set(msg.transfer_id, { sink, writer, hash })
        } catch (err) {
            send({
                type: "transfer:error",
                transfer_id: msg.transfer_id,
                error: `Failed to initialize destination: ${(err as Error).message}`
            })
        }
    }

    public async handle_binary_data(data: Uint8Array): Promise<void> {
        const decoded = decode_transfer_frame(data)
        if (!decoded) return

        const push = this.active_pushes.get(decoded.transfer_id)
        if (push) {
            push.hash.update(decoded.payload)
            await push.writer.write(decoded.payload)
        }
    }

    public async handle_push_end(transfer_id: string, send: (msg: AgentToHubMessage) => void): Promise<void> {
        const push = this.active_pushes.get(transfer_id)
        if (!push) return

        try {
            await push.writer.close()
            await push.sink.wait_for_finish()
            const sha256 = push.hash.digest("hex")
            console.log(`[rexec-agent] [push:${transfer_id.slice(0, 8)}] Completed (sha256: ${sha256.slice(0, 8)})`)
            send({
                type: "file:push_end",
                transfer_id,
                sha256
            })
        } catch (err) {
            push.sink.cleanup?.()
            console.error(`[rexec-agent] [push:${transfer_id.slice(0, 8)}] Finish error:`, err)
            send({
                type: "transfer:error",
                transfer_id,
                error: `Failed to finalize destination: ${(err as Error).message}`
            })
        } finally {
            this.active_pushes.delete(transfer_id)
        }
    }

    public handle_transfer_error(msg: TransferErrorMessage): void {
        const pull = this.active_pulls.get(msg.transfer_id)
        if (pull) {
            pull.source.cleanup?.()
            this.active_pulls.delete(msg.transfer_id)
        }
        const push = this.active_pushes.get(msg.transfer_id)
        if (push) {
            push.sink.cleanup?.()
            this.active_pushes.delete(msg.transfer_id)
        }
    }

    public abort_all(): void {
        for (const [, pull] of this.active_pulls) {
            pull.source.cleanup?.()
        }
        this.active_pulls.clear()

        for (const [, push] of this.active_pushes) {
            push.sink.cleanup?.()
        }
        this.active_pushes.clear()
    }
}
