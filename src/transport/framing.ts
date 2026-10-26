export const enum ChannelDomain {
    TRANSFER = 0x01,
    FORWARD = 0x02
}

export const TRANSFER_ID_BYTES = 16
export const SESSION_ID_BYTES = 16
export const FORWARD_HEADER_BYTES = 1 + SESSION_ID_BYTES + 4 // 21 bytes (1B domain + 16B session_id + 4B uint32 conn_id)
export const TRANSFER_HEADER_BYTES = 1 + TRANSFER_ID_BYTES // 17 bytes (1B domain + 16B transfer_id)

/**
 * Encodes a file transfer binary chunk with domain prefix and 16-byte transfer_id.
 * Frame structure: [0x01] [transfer_id (16B)] [payload]
 */
export function encode_transfer_frame(transfer_id: string, payload: Uint8Array): Uint8Array {
    const frame = new Uint8Array(TRANSFER_HEADER_BYTES + payload.byteLength)
    frame[0] = ChannelDomain.TRANSFER
    const id_bytes = new TextEncoder().encode(transfer_id)
    frame.set(id_bytes.subarray(0, TRANSFER_ID_BYTES), 1)
    frame.set(payload, TRANSFER_HEADER_BYTES)
    return frame
}

/**
 * Decodes a file transfer binary chunk.
 * Supports both new domain-prefixed frames (0x01 + 16B id) and legacy frames (16B id directly).
 */
export function decode_transfer_frame(bytes: Uint8Array): { transfer_id: string; payload: Uint8Array } | null {
    if (bytes.length < TRANSFER_ID_BYTES) return null

    // Check if modern domain-tagged frame
    if (bytes[0] === ChannelDomain.TRANSFER) {
        if (bytes.length < TRANSFER_HEADER_BYTES) return null
        const id_bytes = bytes.subarray(1, TRANSFER_HEADER_BYTES)
        const transfer_id = new TextDecoder().decode(id_bytes)
        const payload = bytes.subarray(TRANSFER_HEADER_BYTES)
        return { transfer_id, payload }
    }

    // Fallback: Legacy untagged frame starting with ASCII hex (0x30..0x39 '0'-'9', 0x61..0x66 'a'-'f')
    const id_bytes = bytes.subarray(0, TRANSFER_ID_BYTES)
    const transfer_id = new TextDecoder().decode(id_bytes)
    const payload = bytes.subarray(TRANSFER_ID_BYTES)
    return { transfer_id, payload }
}

/**
 * Encodes a port forwarding binary chunk.
 * Frame structure: [0x02] [session_id (16B)] [conn_id (4B uint32 BE)] [payload]
 */
export function encode_forward_frame(session_id: string, conn_id: number, payload: Uint8Array): Uint8Array {
    const frame = new Uint8Array(FORWARD_HEADER_BYTES + payload.byteLength)
    frame[0] = ChannelDomain.FORWARD
    const id_bytes = new TextEncoder().encode(session_id)
    frame.set(id_bytes.subarray(0, SESSION_ID_BYTES), 1)
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    view.setUint32(1 + SESSION_ID_BYTES, conn_id, false) // Big-Endian
    frame.set(payload, FORWARD_HEADER_BYTES)
    return frame
}

/**
 * Decodes a port forwarding binary chunk.
 */
export function decode_forward_frame(
    bytes: Uint8Array
): { session_id: string; conn_id: number; payload: Uint8Array } | null {
    if (bytes.length < FORWARD_HEADER_BYTES || bytes[0] !== ChannelDomain.FORWARD) {
        return null
    }
    const session_bytes = bytes.subarray(1, 1 + SESSION_ID_BYTES)
    const session_id = new TextDecoder().decode(session_bytes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const conn_id = view.getUint32(1 + SESSION_ID_BYTES, false) // Big-Endian
    const payload = bytes.subarray(FORWARD_HEADER_BYTES)
    return { session_id, conn_id, payload }
}

/**
 * Extracts session_id from a forward frame without slicing the full payload.
 */
export function extract_forward_session_id(bytes: Uint8Array): string | null {
    if (bytes.length < FORWARD_HEADER_BYTES || bytes[0] !== ChannelDomain.FORWARD) {
        return null
    }
    return new TextDecoder().decode(bytes.subarray(1, 1 + SESSION_ID_BYTES))
}
