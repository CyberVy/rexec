import { read_debug_port, request_eval_raw } from "./bridge_client"

async function main(): Promise<void> {
    const code = process.argv.slice(2).join(" ")
    if (!code) {
        console.error('Usage: npm run debug:eval -- "<javascript code>"')
        process.exit(1)
    }

    const port = read_debug_port()
    const { status_code, payload } = await request_eval_raw(port, code)

    if (status_code !== 200) {
        console.error(`Error: Server responded with status ${status_code}`)
        console.error(payload.error || payload.result || "Unknown error")
        process.exit(1)
    }

    console.log(JSON.stringify(payload, null, 2))
    process.exit(payload.success ? 0 : 1)
}

main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
})
