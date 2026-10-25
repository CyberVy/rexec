import crypto from "node:crypto"
import path from "node:path"
import {
    TRANSFER_ID_BYTES,
    type AgentToHubMessage,
    type FilePullStartMessage,
    type FilePushStartMessage,
    type TransferErrorMessage
} from "@/protocol"
import type { TransferSink, TransferSource } from "@/transfer"
import { create_node_sink, create_node_source } from "@/transfer/adapters/node"

export class TransferManager {
    private active_pulls: Map<string, { source: TransferSource }> = new Map()
    private active_pushes: Map<
        string,
        {
            sink: TransferSink
            writer: WritableStreamDefaultWriter<Uint8Array>
            hash: crypto.Hash
        }
    > = new Map()

    handle_pull_start(
        msg: FilePullStartMessage,
        workspace: string,
        send: (msg: AgentToHubMessage) => void,
        send_binary: (packet: Uint8Array) => void
    ): void {
        const target_path = path.isAbsolute(msg.path) ? path.resolve(msg.path) : path.resolve(workspace, msg.path)

        console.log(`[rexec-agent] [pull:${msg.transfer_id.slice(0, 8)}] Preparing to send: ${target_path}`)

        let source: TransferSource
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

        const id_header = Buffer.from(msg.transfer_id, "utf-8")
        const hash = crypto.createHash("sha256")
        this.active_pulls.set(msg.transfer_id, { source })

        void (async () => {
            try {
                for await (const chunk of source.stream) {
                    hash.update(chunk)
                    const packet = Buffer.concat([id_header, chunk])
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

    handle_push_start(msg: FilePushStartMessage, workspace: string, send: (msg: AgentToHubMessage) => void): void {
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

    async handle_binary_data(data: unknown): Promise<void> {
        let buf: Buffer
        if (Buffer.isBuffer(data)) {
            buf = data
        } else if (data instanceof ArrayBuffer) {
            buf = Buffer.from(data)
        } else if (ArrayBuffer.isView(data)) {
            buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        } else if (data && typeof (data as Blob).arrayBuffer === "function") {
            const ab = await (data as Blob).arrayBuffer()
            buf = Buffer.from(ab)
        } else {
            return
        }

        if (buf.length < TRANSFER_ID_BYTES) return
        const transfer_id = buf.subarray(0, TRANSFER_ID_BYTES).toString("utf-8")
        const chunk = buf.subarray(TRANSFER_ID_BYTES)

        const push = this.active_pushes.get(transfer_id)
        if (push) {
            push.hash.update(chunk)
            await push.writer.write(chunk)
        }
    }

    async handle_push_end(transfer_id: string, send: (msg: AgentToHubMessage) => void): Promise<void> {
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

    handle_transfer_error(msg: TransferErrorMessage): void {
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

    abort_all(): void {
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
