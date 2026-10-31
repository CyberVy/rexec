export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 4
}

function resolve_default_level(): LogLevel {
    try {
        const stored = globalThis.localStorage?.getItem("LOG_LEVEL")?.toUpperCase()
        const level = stored ? LogLevel[stored as keyof typeof LogLevel] : undefined
        if (typeof level === "number") return level
    } catch {
        // Ignore security or storage quota errors
    }

    let is_dev = false
    try {
        is_dev = process.env?.NODE_ENV === "development"
    } catch {}

    return is_dev ? LogLevel.DEBUG : LogLevel.INFO
}

const global_log_level: LogLevel = resolve_default_level()

export class Logger {
    constructor(
        public readonly tag: string,
        private min_level?: LogLevel
    ) {}

    private is_enabled(level: LogLevel): boolean {
        const threshold = this.min_level ?? global_log_level
        return level >= threshold
    }

    public debug(message: string, ...args: unknown[]): void {
        if (!this.is_enabled(LogLevel.DEBUG)) return
        console.debug(`[${this.tag}] ${message}`, ...args)
    }

    public info(message: string, ...args: unknown[]): void {
        if (!this.is_enabled(LogLevel.INFO)) return
        console.info(`[${this.tag}] ${message}`, ...args)
    }

    public warn(message: string, ...args: unknown[]): void {
        if (!this.is_enabled(LogLevel.WARN)) return
        console.warn(`[${this.tag}] ${message}`, ...args)
    }

    public error(message: string, ...args: unknown[]): void {
        if (!this.is_enabled(LogLevel.ERROR)) return
        console.error(`[${this.tag}] ${message}`, ...args)
    }
}

export function create_logger(tag: string, min_level?: LogLevel): Logger {
    return new Logger(tag, min_level)
}
