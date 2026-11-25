export interface PtyReplaySlice {
    chunks: Uint8Array[]
    bytes: number
    offset: number
    reset: boolean
}

/**
 * Fixed-capacity circular chunk buffer for terminal PTY output.
 * Retains the latest N bytes of stdout while bounding memory consumption.
 */
export class PtyRingBuffer {
    private chunks: Uint8Array[] = []
    private buffered_bytes = 0
    private written_bytes = 0

    public constructor(public readonly capacity: number = 512 * 1024) {}

    public write(chunk: Uint8Array): void {
        if (chunk.byteLength === 0) return
        this.written_bytes += chunk.byteLength

        // If a single chunk exceeds capacity, keep only its tail
        if (chunk.byteLength >= this.capacity) {
            this.chunks = [chunk.slice(chunk.byteLength - this.capacity)]
            this.buffered_bytes = this.capacity
            return
        }

        this.chunks.push(chunk)
        this.buffered_bytes += chunk.byteLength

        // Trim earlier chunks from the head to respect capacity
        while (this.buffered_bytes > this.capacity && this.chunks.length > 0) {
            const excess = this.buffered_bytes - this.capacity
            const first = this.chunks[0]
            if (first.byteLength <= excess) {
                this.chunks.shift()
                this.buffered_bytes -= first.byteLength
            } else {
                this.chunks[0] = first.slice(excess)
                this.buffered_bytes -= excess
                break
            }
        }
    }

    public get_chunks(): Uint8Array[] {
        return [...this.chunks]
    }

    public read_from(since_offset?: number): PtyReplaySlice {
        const head_offset = this.written_bytes - this.buffered_bytes
        if (
            since_offset === undefined ||
            !Number.isSafeInteger(since_offset) ||
            since_offset < head_offset ||
            since_offset > this.written_bytes
        ) {
            return {
                chunks: [...this.chunks],
                bytes: this.buffered_bytes,
                offset: head_offset,
                reset: true
            }
        }

        if (since_offset === this.written_bytes) {
            return {
                chunks: [],
                bytes: 0,
                offset: this.written_bytes,
                reset: false
            }
        }

        const result: Uint8Array[] = []
        let remaining_skip = since_offset - head_offset
        for (const chunk of this.chunks) {
            if (remaining_skip >= chunk.byteLength) {
                remaining_skip -= chunk.byteLength
                continue
            }
            if (remaining_skip > 0) {
                result.push(chunk.subarray(remaining_skip))
                remaining_skip = 0
            } else {
                result.push(chunk)
            }
        }

        return {
            chunks: result,
            bytes: this.written_bytes - since_offset,
            offset: since_offset,
            reset: false
        }
    }

    public get byte_length(): number {
        return this.buffered_bytes
    }

    public get total_bytes(): number {
        return this.written_bytes
    }

    public clear(): void {
        this.chunks = []
        this.buffered_bytes = 0
        this.written_bytes = 0
    }
}
