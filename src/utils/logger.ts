/**
 * Structured logging for Cloudflare Workers.
 *
 * Cloudflare Workers Logs auto-extracts and indexes JSON emitted to `console.*`,
 * so the supported, dependency-free approach is to `console.log/warn/error` a
 * single JSON object per event (no external logging library). Levels map to the
 * matching console method so Workers Observability assigns the right severity.
 *
 * Usage: a request-scoped child logger is created in requestId middleware and
 * stored on the context (`c.get("log")`), so every line auto-correlates by
 * `requestId`. Services without a context accept an optional Logger argument.
 *
 * NEVER pass secrets, raw headers, env, payment signatures, or private keys as
 * fields. Use `mask()` for wallet addresses / identifiers at debug level.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel | "silent", number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 99,
};

export interface Logger {
    debug(event: string, fields?: Record<string, unknown>): void;
    info(event: string, fields?: Record<string, unknown>): void;
    warn(event: string, fields?: Record<string, unknown>): void;
    error(event: string, fields?: Record<string, unknown>): void;
    /** Derive a logger that includes `bound` fields on every line. */
    child(bound: Record<string, unknown>): Logger;
}

function normalizeLevel(level: string | undefined): LogLevel | "silent" {
    switch (level) {
        case "debug":
        case "info":
        case "warn":
        case "error":
        case "silent":
            return level;
        default:
            return "info";
    }
}

/**
 * Create a structured logger. `minLevel` gates output; `base` fields are merged
 * into every line.
 */
export function createLogger(
    minLevel: LogLevel | "silent" = "info",
    base: Record<string, unknown> = {},
): Logger {
    const threshold = ORDER[minLevel];

    const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
        if (ORDER[level] < threshold) { return; }
        const line = JSON.stringify({ level, event, ...base, ...fields, ts: new Date().toISOString() });
        if (level === "error") { console.error(line); }
        else if (level === "warn") { console.warn(line); }
        else { console.log(line); }
    };

    return {
        debug: (event, fields) => { emit("debug", event, fields); },
        info: (event, fields) => { emit("info", event, fields); },
        warn: (event, fields) => { emit("warn", event, fields); },
        error: (event, fields) => { emit("error", event, fields); },
        child: (bound) => createLogger(minLevel, { ...base, ...bound }),
    };
}

/** Build a logger from the Worker env (honors `LOG_LEVEL`). */
export function loggerFromEnv(
    env: { LOG_LEVEL?: string },
    base: Record<string, unknown> = {},
): Logger {
    return createLogger(normalizeLevel(env.LOG_LEVEL), base);
}

/**
 * Mask a sensitive-ish identifier (wallet address, etc.) for logs: keep a short
 * prefix and the length, drop the rest. Returns undefined for empty input.
 */
export function mask(value: string | undefined, keep = 6): string | undefined {
    if (!value) { return undefined; }
    return `${value.slice(0, keep)}…(${String(value.length)})`;
}
