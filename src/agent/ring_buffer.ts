/**
 * Fixed-capacity circular chunk buffer for terminal PTY output.
 * Retains the latest N bytes of stdout while bounding memory consumption.
 */
export class PtyRingBuffer {
    private chunks: Uint8Array[] = []
    private total_bytes = 0

    public constructor(public readonly capacity: number = 512 * 1024) {}

    public write(chunk: Uint8Array): void {
        if (chunk.byteLength === 0) return

        // If a single chunk exceeds capacity, keep only its tail
        if (chunk.byteLength >= this.capacity) {
            this.chunks = [chunk.slice(chunk.byteLength - this.capacity)]
            this.total_bytes = this.capacity
            return
        }

        this.chunks.push(chunk)
        this.total_bytes += chunk.byteLength

        // Trim earlier chunks from the head to respect capacity
        while (this.total_bytes > this.capacity && this.chunks.length > 0) {
            const excess = this.total_bytes - this.capacity
            const first = this.chunks[0]
            if (first.byteLength <= excess) {
                this.chunks.shift()
                this.total_bytes -= first.byteLength
            } else {
                this.chunks[0] = first.slice(excess)
                this.total_bytes -= excess
                break
            }
        }
    }

    public get_chunks(): Uint8Array[] {
        return [...this.chunks]
    }

    public get byte_length(): number {
        return this.total_bytes
    }

    public clear(): void {
        this.chunks = []
        this.total_bytes = 0
    }
}
