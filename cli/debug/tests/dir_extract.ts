import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { create_node_sink } from "@/file/adapters/node"
import { print_verdict, record_history } from "./helpers"

// tar closes stdin as soon as it sees the archive trailer. A later chunk then
// fails with EPIPE before the process close event is observed. Repeating that
// write is what makes the race show up.
const TRAILING_BYTE_ITERATIONS = 300

function pack_directory(dir: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const tar_proc = spawn("tar", ["-cf", "-", "--exclude=.DS_Store", "-C", dir, "."], {
            env: { ...process.env, COPYFILE_DISABLE: "1" }
        })
        const chunks: Buffer[] = []
        let stderr = ""
        tar_proc.stdout.on("data", (chunk: Buffer) => {
            chunks.push(chunk)
        })
        tar_proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf-8")
        })
        tar_proc.on("error", reject)
        tar_proc.on("close", (code) => {
            if (code !== 0) reject(new Error(stderr.trim() || `tar exit code ${code}`))
            else resolve(Buffer.concat(chunks))
        })
    })
}

async function extract_chunks(chunks: Uint8Array[], dest: string): Promise<void> {
    const sink = create_node_sink(dest, true)
    const writer = sink.stream.getWriter()
    try {
        for (const chunk of chunks) {
            await writer.write(chunk)
        }
        await writer.close()
        await sink.wait_for_finish()
    } catch (err) {
        sink.cleanup?.()
        throw err
    }
}

async function run_dir_extract_tests(): Promise<boolean> {
    const started_at = Date.now()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rexec-dir-extract-"))
    const source_dir = path.join(root, "src")
    fs.mkdirSync(path.join(source_dir, "nested"), { recursive: true })
    fs.writeFileSync(path.join(source_dir, "f1.txt"), "hello f1", "utf-8")
    fs.writeFileSync(path.join(source_dir, "nested", "f2.txt"), "hello f2", "utf-8")

    const test_name = "test:dir_extract_trailing_chunk"
    try {
        const archive = await pack_directory(source_dir)
        const half = Math.max(1, Math.floor(archive.length / 2))
        for (let i = 0; i < TRAILING_BYTE_ITERATIONS; i++) {
            const dest = path.join(root, `out-${i}`)
            const chunks =
                i % 2 === 0
                    ? [archive.subarray(0, half), archive.subarray(half), Uint8Array.from([0])]
                    : [archive, Uint8Array.from([0])]
            await extract_chunks(chunks, dest)
            const f1 = fs.readFileSync(path.join(dest, "f1.txt"), "utf-8")
            const f2 = fs.readFileSync(path.join(dest, "nested", "f2.txt"), "utf-8")
            if (f1 !== "hello f1" || f2 !== "hello f2") {
                throw new Error(`iteration ${i} extracted f1=${JSON.stringify(f1)} f2=${JSON.stringify(f2)}`)
            }
        }

        const truncated_dest = path.join(root, "truncated")
        let truncated_rejected = false
        try {
            await extract_chunks([archive.subarray(0, 64)], truncated_dest)
        } catch {
            truncated_rejected = true
        }
        if (!truncated_rejected) {
            throw new Error("truncated archive was accepted")
        }

        print_verdict(test_name, true)
        record_history({
            test_name,
            command: "dir extract trailing chunk",
            verdict: "PASS",
            exit_code: 0,
            duration_ms: Date.now() - started_at
        })
        return true
    } catch (err) {
        print_verdict(test_name, false, (err as Error).message)
        record_history({
            test_name,
            command: "dir extract trailing chunk",
            verdict: "FAIL",
            exit_code: 1,
            duration_ms: Date.now() - started_at,
            error_message: (err as Error).message
        })
        return false
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
}

run_dir_extract_tests().then((passed) => {
    process.exit(passed ? 0 : 1)
})
