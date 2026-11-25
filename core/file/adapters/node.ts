import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import type { FileSink, FileSource } from "../types"

/**
 * Creates a readable file/directory source from a local path on Node.js runtime.
 * Returns a standard WHATWG ReadableStream.
 */
export function create_node_source(target_path: string, recursive: boolean): FileSource {
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
 * Creates a writable sink that writes incoming bytes to a local file or extracts a tar directory on Node.js runtime.
 * Returns a standard WHATWG WritableStream.
 */
export function create_node_sink(target_path: string, is_directory: boolean): FileSink {
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
        const exit_waiters: Array<(code: number) => void> = []

        const finish_tar = (code: number) => {
            if (tar_exit_code !== null) return
            tar_exit_code = code
            const waiters = exit_waiters.splice(0)
            for (const waiter of waiters) waiter(code)
        }

        const wait_for_tar_exit = (): Promise<number> => {
            if (tar_exit_code !== null) return Promise.resolve(tar_exit_code)
            return new Promise((resolve) => {
                exit_waiters.push(resolve)
            })
        }

        const tar_failure = (fallback: string) => {
            const detail = tar_stderr.trim()
            return new Error(detail || fallback)
        }

        // tar stops at the archive trailer and closes stdin before the caller
        // necessarily finishes writing. That surfaces as EPIPE while the close
        // event is still queued; the extract itself can still have succeeded.
        const accept_if_tar_succeeded = async (err: Error): Promise<void> => {
            if (tar_exit_code === 0) return
            const code = "code" in err ? (err as NodeJS.ErrnoException).code : undefined
            const pipe_closed =
                code === "EPIPE" ||
                code === "ECONNRESET" ||
                code === "ERR_STREAM_DESTROYED" ||
                !tar_proc.stdin?.writable
            if (!pipe_closed) throw err
            const exit_code = await wait_for_tar_exit()
            if (exit_code !== 0) throw tar_failure(err.message)
        }

        tar_proc.on("close", (code) => {
            finish_tar(code ?? 0)
        })

        tar_proc.on("error", (err) => {
            tar_stderr += `\n${err.message}`
            finish_tar(1)
        })

        const stream = new WritableStream<Uint8Array>({
            write(chunk) {
                if (tar_proc.killed || tar_exit_code !== null) {
                    if (tar_exit_code === 0) return
                    throw tar_failure(`tar exit code ${tar_exit_code}`)
                }
                return new Promise<void>((resolve, reject) => {
                    const done = (err?: Error | null) => {
                        if (!err) {
                            resolve()
                            return
                        }
                        accept_if_tar_succeeded(err).then(resolve, reject)
                    }
                    if (!tar_proc.stdin?.writable) {
                        done(new Error(tar_stderr.trim() || "tar stdin is not writable"))
                        return
                    }
                    tar_proc.stdin.write(chunk, (err) => done(err))
                })
            },
            close() {
                if (!tar_proc.killed && tar_proc.stdin?.writable) {
                    tar_proc.stdin.end()
                }
            },
            abort() {
                if (!tar_proc.killed) {
                    tar_proc.kill("SIGTERM")
                }
            }
        })

        return {
            stream,
            wait_for_finish: async () => {
                if (!tar_proc.killed && tar_proc.stdin?.writable) {
                    tar_proc.stdin.end()
                }
                const code = await wait_for_tar_exit()
                if (code !== 0) throw tar_failure(`tar exit code ${code}`)
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

    const stream = new WritableStream<Uint8Array>({
        write(chunk) {
            if (stream_error) throw stream_error
            return new Promise<void>((resolve, reject) => {
                if (!write_stream.writable) {
                    return reject(stream_error || new Error("File write stream is not writable"))
                }
                write_stream.write(chunk, (err) => {
                    if (err) return reject(err)
                    resolve()
                })
            })
        },
        close() {
            if (!write_stream.destroyed && write_stream.writable) {
                write_stream.end()
            }
        },
        abort(reason) {
            write_stream.destroy(reason instanceof Error ? reason : undefined)
        }
    })

    return {
        stream,
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
