;(function () {
    if (typeof window === "undefined") return

    // 1. Hook console logs
    const original_console = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
    }

    function send_log(level, args) {
        const message = args
            .map((arg) => {
                if (arg instanceof Error || (arg && typeof arg === "object" && ("message" in arg || "name" in arg))) {
                    return `${arg.name || "Error"}: ${arg.message || ""}${arg.stack ? `\n${arg.stack}` : ""}`
                }
                if (typeof arg === "object" && arg !== null) {
                    try {
                        return JSON.stringify(arg, (_key, value) => {
                            if (value instanceof Error) {
                                return { name: value.name, message: value.message, stack: value.stack }
                            }
                            return value
                        })
                    } catch {
                        return String(arg)
                    }
                }
                return String(arg)
            })
            .join(" ")

        fetch("/__debug/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                timestamp: Date.now(),
                level,
                message
            })
        }).catch(() => {})
    }

    console.debug = (...args) => {
        original_console.debug(...args)
        send_log("debug", args)
    }
    console.log = (...args) => {
        original_console.log(...args)
        send_log("info", args)
    }
    console.info = (...args) => {
        original_console.info(...args)
        send_log("info", args)
    }
    console.warn = (...args) => {
        original_console.warn(...args)
        send_log("warn", args)
    }
    console.error = (...args) => {
        original_console.error(...args)
        send_log("error", args)
    }

    window.addEventListener("error", (event) => {
        send_log("error", [`Uncaught Exception: ${event.message} at ${event.filename}:${event.lineno}`])
    })

    window.addEventListener("unhandledrejection", (event) => {
        send_log("error", [`Unhandled Promise Rejection: ${event.reason}`])
    })

    // 2. Set up SSE for Eval commands
    function init_event_source() {
        const event_source = new EventSource("/__debug/events")

        event_source.onmessage = async (event) => {
            try {
                const req = JSON.parse(event.data)
                let result
                let success = true
                try {
                    // Evaluate code in browser context
                    result = await (async () => {
                        return eval(req.code)
                    })()
                } catch (err) {
                    result = err.toString()
                    success = false
                }

                // Send response back
                fetch("/__debug/respond", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: req.id,
                        success: success,
                        result: result
                    })
                }).catch(() => {})
            } catch (err) {
                original_console.error("Debug bridge failed to process event:", err)
            }
        }

        event_source.onerror = () => {
            event_source.close()
            // Try to reconnect after 3 seconds
            setTimeout(init_event_source, 3000)
        }
    }

    init_event_source()
})()
