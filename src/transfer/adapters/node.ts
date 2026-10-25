import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import type { TransferSink, TransferSource } from "../types"

/**
 * Creates a readable transfer source from a local file or directory on Node.js runtime.
 * Returns a standard WHATWG ReadableStream.
 */
export function create_node_source(target_path: string, recursive: boolean): TransferSource {
    if (!fs.existsSync(target_path)) {
        throw new Error(`File not found: ${target_path}`)
    }

    const stat = fs.statSync(target_path)
    if (stat.isDirectory()) {
        if (!recursive) {
            throw new Error(`Path '${target_path}' is a directory. Use -r or --recursive to transfer directories.`)
        }

        const tar_env = { ...process.env, COPYFILE_DISABLE: "1" }
        const tar_proc = spawn("tar", ["-cf", "-", "--exclude=.DS_Store", "-C", target_path, "."], {
            env: tar_env,
            stdio: ["ignore", "pipe", "pipe"]
        })

        let tar_stderr = ""
        tar_proc.stderr?.on("data", (chunk: Buffer) => {
            tar_stderr += chunk.toString("utf-8")
        })

        tar_proc.on("error", (err) => {
            tar_proc.stdout.destroy(err)
        })

        tar_proc.on("close", (code) => {
            if (code !== 0) {
                tar_proc.stdout.destroy(new Error(tar_stderr || `tar exit code ${code}`))
            }
        })

        return {
            stream: Readable.toWeb(tar_proc.stdout) as ReadableStream<Uint8Array>,
            size: 0,
            is_directory: true,
            cleanup: () => {
                if (!tar_proc.killed) {
                    tar_proc.kill("SIGTERM")
                }
            }
        }
    }

    const file_stream = fs.createReadStream(target_path, { highWaterMark: 64 * 1024 })
    return {
        stream: Readable.toWeb(file_stream) as ReadableStream<Uint8Array>,
        size: stat.size,
        is_directory: false,
        mtime: stat.mtimeMs,
        mode: stat.mode,
        cleanup: () => {
            file_stream.destroy()
        }
    }
}

/**
 * Creates a writable transfer sink that writes incoming bytes to a local file or extracts a tar directory on Node.js runtime.
 * Returns a standard WHATWG WritableStream.
 */
export function create_node_sink(target_path: string, is_directory: boolean): TransferSink {
    if (is_directory) {
        fs.mkdirSync(target_path, { recursive: true })

        const tar_proc = spawn("tar", ["-xf", "-", "-C", target_path], {
            stdio: ["pipe", "ignore", "pipe"]
        })

        tar_proc.stdin?.on("error", () => {})

        let tar_stderr = ""
        tar_proc.stderr?.on("data", (chunk: Buffer) => {
            tar_stderr += chunk.toString("utf-8")
        })

        let tar_exit_code: number | null = null
        let tar_close_resolver: ((code: number) => void) | null = null

        tar_proc.on("close", (code) => {
            tar_exit_code = code ?? 0
            if (tar_close_resolver) {
                tar_close_resolver(tar_exit_code)
                tar_close_resolver = null
            }
        })

        tar_proc.on("error", (err) => {
            tar_stderr += `\n${err.message}`
            tar_exit_code = 1
            if (tar_close_resolver) {
                tar_close_resolver(1)
                tar_close_resolver = null
            }
        })

        return {
            stream: Writable.toWeb(tar_proc.stdin) as WritableStream<Uint8Array>,
            wait_for_finish: async () => {
                if (!tar_proc.killed && tar_proc.stdin?.writable) {
                    tar_proc.stdin.end()
                }
                const code =
                    tar_exit_code !== null
                        ? tar_exit_code
                        : await new Promise<number>((resolve) => {
                              tar_close_resolver = resolve
                          })
                if (code !== 0) {
                    throw new Error(tar_stderr || `tar exit code ${code}`)
                }
            },
            cleanup: () => {
                if (!tar_proc.killed) {
                    tar_proc.kill("SIGTERM")
                }
            }
        }
    }

    const parent_dir = path.dirname(path.resolve(target_path))
    fs.mkdirSync(parent_dir, { recursive: true })

    const write_stream = fs.createWriteStream(target_path)
    let stream_error: Error | null = null
    let is_finished = false
    let finish_resolver: (() => void) | null = null
    let finish_rejecter: ((err: Error) => void) | null = null

    write_stream.on("error", (err) => {
        stream_error = err
        if (finish_rejecter) {
            finish_rejecter(err)
            finish_rejecter = null
            finish_resolver = null
        }
    })

    write_stream.on("finish", () => {
        is_finished = true
        if (finish_resolver) {
            finish_resolver()
            finish_resolver = null
            finish_rejecter = null
        }
    })

    return {
        stream: Writable.toWeb(write_stream) as WritableStream<Uint8Array>,
        wait_for_finish: async () => {
            if (stream_error) throw stream_error
            if (is_finished) return
            await new Promise<void>((resolve, reject) => {
                finish_resolver = resolve
                finish_rejecter = reject
                if (!write_stream.destroyed && write_stream.writable) {
                    write_stream.end()
                }
            })
        },
        cleanup: () => {
            write_stream.destroy()
            try {
                fs.unlinkSync(target_path)
            } catch {
                // Ignore
            }
        }
    }
}
