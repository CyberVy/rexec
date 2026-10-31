import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.resolve(__dirname, "../../.debug/frontend/config.json")

if (!fs.existsSync(CONFIG_FILE)) {
    console.error("Error: Configuration file not found. Is the debug server running?")
    process.exit(1)
}

let config = { port: 9999 }
try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
} catch (err) {
    console.error("Error: Failed to parse configuration file:", err.message)
    process.exit(1)
}

const port = config.port
if (isNaN(port)) {
    console.error(`Error: Invalid port "${config.port}" in configuration.`)
    process.exit(1)
}

const host = "127.0.0.1"

// Extract code from remaining arguments
const code = process.argv.slice(2).join(" ")

if (!code) {
    console.error('Usage: node cli/debug/eval.js "<javascript code>"')
    process.exit(1)
}

const post_data = JSON.stringify({ code })

const req = http.request(
    {
        hostname: host,
        port: port,
        path: "/__debug/eval",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(post_data)
        }
    },
    (res) => {
        let response_body = ""
        res.on("data", (chunk) => {
            response_body += chunk
        })
        res.on("end", () => {
            if (res.statusCode !== 200) {
                console.error(`Error: Server responded with status ${res.statusCode}`)
                try {
                    const err_res = JSON.parse(response_body)
                    console.error(err_res.error || response_body)
                } catch {
                    console.error(response_body)
                }
                process.exit(1)
            }

            try {
                const parsed = JSON.parse(response_body)
                console.log(JSON.stringify(parsed, null, 2))
                process.exit(parsed.success ? 0 : 1)
            } catch (err) {
                console.error("Error parsing response:", response_body)
                process.exit(1)
            }
        })
    }
)

req.on("error", (err) => {
    console.error(`Network Error connecting to debug server at ${host}:${port}: ${err.message}`)
    process.exit(1)
})

req.write(post_data)
req.end()
