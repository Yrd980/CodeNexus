/**
 * Structured logger — JSON-first, with child loggers, PII redaction,
 * and optional pretty-print for development.
 *
 * Design decisions:
 *  - JSON output by default because `grep` through text logs doesn't
 *    scale past ~10 req/s.  Every field is machine-parseable.
 *  - Child loggers inherit parent context so you can narrow scope
 *    (e.g. per-request, per-module) without losing global context.
 *  - PII redaction is built-in, not bolted-on, because GDPR/compliance
 *    is not optional for any startup that handles user data.
 */

import type { LogEntry, LoggerConfig, LogLevel } from "./types.js";
import { LOG_LEVEL_PRIORITY } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deep-clone a value, redacting keys that appear in `paths`. */
function redact(
  obj: Record<string, unknown>,
  paths: ReadonlySet<string>,
): Record<string, unknown> {
  if (paths.size === 0) return obj;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (paths.has(key)) {
      result[key] = "[REDACTED]";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redact(value as Record<string, unknown>, paths);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Format a log entry as a coloured single-line string (dev mode). */
function formatText(entry: LogEntry): string {
  const colors: Record<LogLevel, string> = {
    debug: "\x1b[36m", // cyan
    info: "\x1b[32m", // green
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
    fatal: "\x1b[35m", // magenta
  };
  const reset = "\x1b[0m";
  const color = colors[entry.level];
  const ctx =
    Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context)}`
      : "";
  const traceInfo =
    entry.traceId ? ` [trace=${entry.traceId}]` : "";
  return `${entry.timestamp} ${color}${entry.level.toUpperCase().padEnd(5)}${reset} ${entry.message}${traceInfo}${ctx}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;

  /** Create a child logger that inherits & extends this logger's context. */
  child(context: Record<string, unknown>): Logger;

  /** Set trace context that will be attached to every subsequent log. */
  setTraceContext(traceId: string, spanId?: string): void;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const {
    level = "info",
    format = "json",
    redactPaths = [],
    defaultContext = {},
    output = (line: string) => {
      process.stdout.write(line + "\n");
    },
  } = config;

  const minPriority = LOG_LEVEL_PRIORITY[level];
  const redactSet = new Set(redactPaths);

  return buildLogger(minPriority, format, redactSet, { ...defaultContext }, output);
}

function buildLogger(
  minPriority: number,
  format: "json" | "text",
  redactSet: ReadonlySet<string>,
  baseContext: Record<string, unknown>,
  output: (line: string) => void,
): Logger {
  let traceId: string | undefined;
  let spanId: string | undefined;

  function emit(logLevel: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[logLevel] < minPriority) return;

    const merged: Record<string, unknown> = { ...baseContext, ...extra };
    const safeContext = redact(merged, redactSet);

    const entry: LogEntry = {
      level: logLevel,
      message,
      timestamp: new Date().toISOString(),
      context: safeContext,
      ...(traceId !== undefined && { traceId }),
      ...(spanId !== undefined && { spanId }),
    };

    if (format === "json") {
      output(JSON.stringify(entry));
    } else {
      output(formatText(entry));
    }
  }

  return {
    debug: (msg, ctx) => emit("debug", msg, ctx),
    info: (msg, ctx) => emit("info", msg, ctx),
    warn: (msg, ctx) => emit("warn", msg, ctx),
    error: (msg, ctx) => emit("error", msg, ctx),
    fatal: (msg, ctx) => emit("fatal", msg, ctx),

    child(extraContext: Record<string, unknown>): Logger {
      const childCtx = { ...baseContext, ...extraContext };
      const child = buildLogger(minPriority, format, redactSet, childCtx, output);
      if (traceId !== undefined) {
        child.setTraceContext(traceId, spanId);
      }
      return child;
    },

    setTraceContext(tid: string, sid?: string): void {
      traceId = tid;
      spanId = sid;
    },
  };
}
