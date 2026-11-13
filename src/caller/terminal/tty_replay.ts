const ESC = 0x1b
const BEL = 0x07
const MAX_QUERY_BYTES = 128
const MAX_REPLY_BYTES = 256
const SENTINEL_QUERY = "\x1b[5n"
const SENTINEL_TIMEOUT_MS = 300
const ESC_HOLD_TIMEOUT_MS = 30

export const TTY_MODE_RESET =
    "\x1b[?2026l" +
    "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l" +
    "\x1b[?1004l" +
    "\x1b[?2004l" +
    "\x1b[?1l\x1b>" +
    "\x1b[<u" +
    "\x1b[?1047l\x1b[?47l" +
    "\x1b[?25h" +
    "\x1b[0m"

export const TTY_SCREEN_RESET = `${TTY_MODE_RESET}\x1b[!p\x1b[r\x1b[2J\x1b[H`

type SequenceDecision =
    | { status: "incomplete" }
    | { status: "keep"; length: number }
    | { status: "drop"; length: number }
    | { status: "sentinel"; length: number }

const text_decoder = new TextDecoder()

/**
 * Streaming filter that strips terminal query escape sequences from replay chunks
 * so reattaching to a local terminal does not trigger spurious query responses.
 */
export class ReplayQueryFilter {
    private pending: Uint8Array = new Uint8Array(0)

    public push(chunk: Uint8Array): Uint8Array {
        if (chunk.byteLength === 0) return chunk
        if (this.pending.byteLength === 0 && !chunk.includes(ESC)) {
            return chunk
        }

        const input = concat_bytes(this.pending, chunk)
        this.pending = new Uint8Array(0)

        const out = new Uint8Array(input.byteLength)
        let written = 0

        for (let i = 0; i < input.byteLength; i++) {
            if (input[i] !== ESC) {
                out[written++] = input[i]
                continue
            }

            const decision = inspect_query_sequence(input, i)
            if (decision.status === "incomplete") {
                this.pending = input.slice(i)
                break
            }
            if (decision.status === "drop") {
                i += decision.length - 1
                continue
            }
            out.set(input.subarray(i, i + decision.length), written)
            written += decision.length
            i += decision.length - 1
        }

        return out.subarray(0, written)
    }

    public flush(): Uint8Array {
        if (this.pending.byteLength === 0) return this.pending
        const rest = this.pending
        this.pending = new Uint8Array(0)
        return rest
    }

    public reset(): void {
        this.pending = new Uint8Array(0)
    }
}

/**
 * Guards stdin during replay playback by appending a DSR (\x1b[5n) sentinel
 * and dropping any asynchronous terminal reply sequences until \x1b[0n returns.
 */
export class ReplayReplyFence {
    private in_replay = false
    private awaiting_sentinel = false
    private pending: Uint8Array = new Uint8Array(0)
    private sentinel_timer: ReturnType<typeof setTimeout> | null = null
    private pending_timer: ReturnType<typeof setTimeout> | null = null
    private readonly disabled: boolean

    public constructor(disabled = false) {
        this.disabled = disabled
    }

    public get active(): boolean {
        return this.in_replay || this.awaiting_sentinel || this.pending.byteLength > 0
    }

    public begin_replay(on_forward: (data: Uint8Array) => void): void {
        if (this.disabled) return
        this.clear_sentinel_timer()
        this.flush_pending(on_forward)
        this.in_replay = true
        this.awaiting_sentinel = false
    }

    public end_replay(write_stdout: (seq: string) => void, on_forward: (data: Uint8Array) => void): void {
        if (this.disabled || !this.in_replay) return
        this.in_replay = false
        this.awaiting_sentinel = true
        write_stdout(SENTINEL_QUERY)
        this.clear_sentinel_timer()
        this.sentinel_timer = setTimeout(() => {
            this.sentinel_timer = null
            this.awaiting_sentinel = false
            this.flush_pending(on_forward)
        }, SENTINEL_TIMEOUT_MS)
        this.sentinel_timer.unref?.()
    }

    public push_input(chunk: Uint8Array, on_forward: (data: Uint8Array) => void): void {
        if (chunk.byteLength === 0) return
        if (this.disabled || !this.active) {
            on_forward(chunk)
            return
        }

        this.clear_pending_timer()
        const input = concat_bytes(this.pending, chunk)
        this.pending = new Uint8Array(0)

        const out = new Uint8Array(input.byteLength)
        let written = 0

        for (let i = 0; i < input.byteLength; i++) {
            if (!this.in_replay && !this.awaiting_sentinel) {
                const rest = input.subarray(i)
                if (written === 0) {
                    on_forward(rest)
                    return
                }
                out.set(rest, written)
                written += rest.byteLength
                break
            }

            if (input[i] !== ESC) {
                out[written++] = input[i]
                continue
            }

            const decision = inspect_reply_sequence(input, i)
            if (decision.status === "incomplete") {
                this.pending = input.slice(i)
                this.pending_timer = setTimeout(() => {
                    this.pending_timer = null
                    this.flush_pending(on_forward)
                }, ESC_HOLD_TIMEOUT_MS)
                this.pending_timer.unref?.()
                break
            }
            if (decision.status === "sentinel") {
                this.awaiting_sentinel = false
                this.clear_sentinel_timer()
                i += decision.length - 1
                continue
            }
            if (decision.status === "drop") {
                i += decision.length - 1
                continue
            }
            out.set(input.subarray(i, i + decision.length), written)
            written += decision.length
            i += decision.length - 1
        }

        if (written > 0) {
            on_forward(out.subarray(0, written))
        }
    }

    public reset(): void {
        this.in_replay = false
        this.awaiting_sentinel = false
        this.pending = new Uint8Array(0)
        this.clear_sentinel_timer()
        this.clear_pending_timer()
    }

    public dispose(): void {
        this.reset()
    }

    private flush_pending(on_forward: (data: Uint8Array) => void): void {
        this.clear_pending_timer()
        if (this.pending.byteLength === 0) return
        const rest = this.pending
        this.pending = new Uint8Array(0)
        on_forward(rest)
    }

    private clear_sentinel_timer(): void {
        if (!this.sentinel_timer) return
        clearTimeout(this.sentinel_timer)
        this.sentinel_timer = null
    }

    private clear_pending_timer(): void {
        if (!this.pending_timer) return
        clearTimeout(this.pending_timer)
        this.pending_timer = null
    }
}

function concat_bytes(head: Uint8Array, tail: Uint8Array): Uint8Array {
    if (head.byteLength === 0) return tail
    const merged = new Uint8Array(head.byteLength + tail.byteLength)
    merged.set(head, 0)
    merged.set(tail, head.byteLength)
    return merged
}

function inspect_query_sequence(input: Uint8Array, start: number): SequenceDecision {
    if (start + 1 >= input.byteLength) return { status: "incomplete" }
    const kind = input[start + 1]

    if (kind === 0x5a) {
        // ESC Z (DECID)
        return { status: "drop", length: 2 }
    }
    if (kind === 0x5b) {
        return inspect_csi(input, start, MAX_QUERY_BYTES, is_csi_query)
    }
    if (kind === 0x5d) {
        return inspect_osc(input, start, MAX_QUERY_BYTES, could_be_osc_query, is_osc_query)
    }
    if (kind === 0x50) {
        return inspect_dcs(input, start, MAX_QUERY_BYTES, could_be_dcs_query)
    }
    return { status: "keep", length: 2 }
}

function inspect_reply_sequence(input: Uint8Array, start: number): SequenceDecision {
    if (start + 1 >= input.byteLength) return { status: "incomplete" }
    const kind = input[start + 1]

    if (kind === 0x5b) {
        return inspect_csi(input, start, MAX_REPLY_BYTES, classify_csi_reply)
    }
    if (kind === 0x5d) {
        return inspect_osc(input, start, MAX_REPLY_BYTES, could_be_osc_reply, is_osc_reply)
    }
    if (kind === 0x50) {
        return inspect_dcs(input, start, MAX_REPLY_BYTES, could_be_dcs_reply)
    }
    return { status: "keep", length: 2 }
}

function inspect_csi(
    input: Uint8Array,
    start: number,
    max_len: number,
    classify: (params: string, inter: string, final_byte: number) => "drop" | "keep" | "sentinel"
): SequenceDecision {
    const limit = Math.min(input.byteLength, start + max_len)
    let cursor = start + 2
    const param_start = cursor

    while (cursor < limit && input[cursor] >= 0x30 && input[cursor] <= 0x3f) {
        cursor++
    }
    const inter_start = cursor
    while (cursor < limit && input[cursor] >= 0x20 && input[cursor] <= 0x2f) {
        cursor++
    }
    if (cursor >= limit) {
        return input.byteLength - start >= max_len ? { status: "keep", length: 1 } : { status: "incomplete" }
    }

    const final_byte = input[cursor]
    if (final_byte < 0x40 || final_byte > 0x7e) {
        return { status: "keep", length: 1 }
    }

    const params = text_decoder.decode(input.subarray(param_start, inter_start))
    const inter = text_decoder.decode(input.subarray(inter_start, cursor))
    const action = classify(params, inter, final_byte)
    return { status: action, length: cursor + 1 - start }
}

function inspect_osc(
    input: Uint8Array,
    start: number,
    max_len: number,
    could_match: (body_prefix: string) => boolean,
    is_match: (body: string) => boolean
): SequenceDecision {
    const limit = Math.min(input.byteLength, start + max_len)
    for (let i = start + 2; i < limit; i++) {
        if (input[i] === BEL) {
            const body = text_decoder.decode(input.subarray(start + 2, i))
            return { status: is_match(body) ? "drop" : "keep", length: i + 1 - start }
        }
        if (input[i] === ESC) {
            if (i + 1 >= input.byteLength) {
                return { status: "incomplete" }
            }
            if (input[i + 1] === 0x5c) {
                const body = text_decoder.decode(input.subarray(start + 2, i))
                return { status: is_match(body) ? "drop" : "keep", length: i + 2 - start }
            }
            return { status: "keep", length: 1 }
        }
    }

    const prefix = text_decoder.decode(input.subarray(start + 2, limit))
    if (!could_match(prefix) || input.byteLength - start >= max_len) {
        return { status: "keep", length: 1 }
    }
    return { status: "incomplete" }
}

function inspect_dcs(
    input: Uint8Array,
    start: number,
    max_len: number,
    could_match: (body_prefix: string) => boolean
): SequenceDecision {
    const limit = Math.min(input.byteLength, start + max_len)
    if (limit - (start + 2) >= 2) {
        const prefix = text_decoder.decode(input.subarray(start + 2, Math.min(limit, start + 6)))
        if (!could_match(prefix)) {
            return { status: "keep", length: 2 }
        }
    }

    for (let i = start + 2; i < limit; i++) {
        if (input[i] === ESC) {
            if (i + 1 >= input.byteLength) {
                return { status: "incomplete" }
            }
            if (input[i + 1] === 0x5c) {
                return { status: "drop", length: i + 2 - start }
            }
            return { status: "keep", length: 1 }
        }
    }

    if (input.byteLength - start >= max_len) {
        return { status: "keep", length: 2 }
    }
    return { status: "incomplete" }
}

function is_csi_query(params: string, inter: string, final_byte: number): "drop" | "keep" {
    if (
        final_byte === 0x63 &&
        inter === "" &&
        (params === "" || params === "0" || params === ">" || params === ">0" || params === "=" || params === "=0")
    ) {
        return "drop"
    }
    if (final_byte === 0x6e && inter === "" && /^\??\d+$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x70 && inter === "$" && /^\??\d*$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x74 && inter === "" && /^(?:11|13|14|15|16|18|19|20|21)(?:;\d+)*$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x71 && inter === "" && (params === ">" || params === ">0")) {
        return "drop"
    }
    if (final_byte === 0x75 && inter === "" && params === "?") {
        return "drop"
    }
    if (final_byte === 0x6d && inter === "" && /^\?\d*$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x78 && inter === "" && (params === "" || params === "0" || params === "1")) {
        return "drop"
    }
    if (final_byte === 0x79 && inter === "*") {
        return "drop"
    }
    return "keep"
}

const OSC_COLOR_COMMANDS = new Set([10, 11, 12, 17, 19, 21])

function could_be_osc_query(prefix: string): boolean {
    const semi = prefix.indexOf(";")
    if (semi === -1) return /^\d{0,2}$/.test(prefix)
    const cmd = Number(prefix.slice(0, semi))
    return cmd === 4 || cmd === 52 || OSC_COLOR_COMMANDS.has(cmd)
}

function is_osc_query(body: string): boolean {
    const parts = body.split(";")
    if (parts.length < 2) return false
    const first = Number(parts[0])
    if (OSC_COLOR_COMMANDS.has(first)) {
        if (parts.length % 2 !== 0) return false
        for (let i = 0; i < parts.length; i += 2) {
            if (!OSC_COLOR_COMMANDS.has(Number(parts[i])) || parts[i + 1] !== "?") return false
        }
        return true
    }
    if (first === 4) {
        if (parts.length < 3 || parts.length % 2 === 0) return false
        for (let i = 1; i < parts.length; i += 2) {
            if (!/^\d+$/.test(parts[i]) || parts[i + 1] !== "?") return false
        }
        return true
    }
    if (first === 52 && parts.length === 3) {
        return parts[2] === "?"
    }
    return false
}

function could_be_dcs_query(prefix: string): boolean {
    return prefix.startsWith("$q") || prefix.startsWith("+q")
}

function classify_csi_reply(params: string, inter: string, final_byte: number): "drop" | "keep" | "sentinel" {
    if (final_byte === 0x6e && inter === "") {
        if (params === "0") return "sentinel"
        if (params === "3" || /^\?\d+(?:;\d+)*$/.test(params)) return "drop"
    }
    if (final_byte === 0x63 && inter === "" && /^[?>=][\d;]*$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x79 && inter === "$" && /^\??[\d;]+$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x52 && inter === "" && /^\??\d+;\d+$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x75 && inter === "" && /^\?[\d;]*$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x6d && inter === "" && /^\?\d+(?:;\d+)*$/.test(params)) {
        return "drop"
    }
    if (final_byte === 0x74 && inter === "" && /^(?:[1-9]|1[0-9]|2[0-9])(?:;\d+)+$/.test(params)) {
        return "drop"
    }
    return "keep"
}

function could_be_osc_reply(prefix: string): boolean {
    if (prefix.startsWith("l") || prefix.startsWith("L")) return true
    const semi = prefix.indexOf(";")
    if (semi === -1) return /^\d{0,2}$/.test(prefix)
    const cmd = Number(prefix.slice(0, semi))
    return cmd === 4 || cmd === 52 || OSC_COLOR_COMMANDS.has(cmd)
}

function is_osc_reply(body: string): boolean {
    if (/^[Ll]/.test(body)) return true
    if (/^(?:4;\d+|10|11|12|17|19|21);(?:rgb:|rgba:|#)/i.test(body)) return true
    if (/^52;[cps]+;[A-Za-z0-9+/=]*$/.test(body)) return true
    return false
}

function could_be_dcs_reply(prefix: string): boolean {
    return (
        prefix.startsWith(">|") ||
        prefix.startsWith("0$") ||
        prefix.startsWith("1$") ||
        prefix.startsWith("0+") ||
        prefix.startsWith("1+")
    )
}
