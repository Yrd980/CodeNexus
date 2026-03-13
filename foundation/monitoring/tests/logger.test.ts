import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("Logger", () => {
  function captureLogger(config: Parameters<typeof createLogger>[0] = {}) {
    const lines: string[] = [];
    const logger = createLogger({
      ...config,
      output: (line) => lines.push(line),
    });
    return { logger, lines };
  }

  // -------------------------------------------------------------------------
  // Level filtering
  // -------------------------------------------------------------------------

  it("should emit logs at or above the configured level", () => {
    const { logger, lines } = captureLogger({ level: "warn" });
    logger.debug("nope");
    logger.info("nope");
    logger.warn("yes");
    logger.error("yes");
    expect(lines).toHaveLength(2);
  });

  it("should emit all levels when level is debug", () => {
    const { logger, lines } = captureLogger({ level: "debug" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");
    expect(lines).toHaveLength(5);
  });

  it("should default to info level", () => {
    const { logger, lines } = captureLogger();
    logger.debug("nope");
    logger.info("yes");
    expect(lines).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // JSON output format
  // -------------------------------------------------------------------------

  it("should output valid JSON by default", () => {
    const { logger, lines } = captureLogger({ format: "json" });
    logger.info("hello world");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("hello world");
    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("should include context in JSON output", () => {
    const { logger, lines } = captureLogger({ format: "json" });
    logger.info("test", { userId: "123", action: "login" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.userId).toBe("123");
    expect(parsed.context.action).toBe("login");
  });

  it("should include the correct log level in output", () => {
    const { logger, lines } = captureLogger({ level: "debug", format: "json" });
    logger.debug("d");
    logger.warn("w");
    logger.fatal("f");
    expect(JSON.parse(lines[0]!).level).toBe("debug");
    expect(JSON.parse(lines[1]!).level).toBe("warn");
    expect(JSON.parse(lines[2]!).level).toBe("fatal");
  });

  // -------------------------------------------------------------------------
  // Text format
  // -------------------------------------------------------------------------

  it("should output human-readable text in text mode", () => {
    const { logger, lines } = captureLogger({ format: "text" });
    logger.info("server started");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("INFO");
    expect(lines[0]).toContain("server started");
  });

  // -------------------------------------------------------------------------
  // Child loggers
  // -------------------------------------------------------------------------

  it("should create child loggers that inherit parent context", () => {
    const { logger, lines } = captureLogger({ format: "json" });
    const child = logger.child({ module: "auth" });
    child.info("login attempt");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.module).toBe("auth");
  });

  it("should allow child loggers to add extra context", () => {
    const { logger, lines } = captureLogger({
      format: "json",
      defaultContext: { service: "api" },
    });
    const child = logger.child({ module: "auth" });
    child.info("test");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.service).toBe("api");
    expect(parsed.context.module).toBe("auth");
  });

  it("should allow nested child loggers", () => {
    const { logger, lines } = captureLogger({ format: "json" });
    const child1 = logger.child({ module: "auth" });
    const child2 = child1.child({ handler: "login" });
    child2.info("attempt");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.module).toBe("auth");
    expect(parsed.context.handler).toBe("login");
  });

  // -------------------------------------------------------------------------
  // PII Redaction
  // -------------------------------------------------------------------------

  it("should redact configured paths in context", () => {
    const { logger, lines } = captureLogger({
      format: "json",
      redactPaths: ["password", "token"],
    });
    logger.info("login", { username: "alice", password: "s3cret", token: "abc123" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.username).toBe("alice");
    expect(parsed.context.password).toBe("[REDACTED]");
    expect(parsed.context.token).toBe("[REDACTED]");
  });

  it("should redact nested paths", () => {
    const { logger, lines } = captureLogger({
      format: "json",
      redactPaths: ["ssn"],
    });
    logger.info("user data", { user: { name: "Bob", ssn: "123-45-6789" } });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.user.name).toBe("Bob");
    expect(parsed.context.user.ssn).toBe("[REDACTED]");
  });

  it("should not fail when redact paths don't exist in context", () => {
    const { logger, lines } = captureLogger({
      format: "json",
      redactPaths: ["password"],
    });
    logger.info("safe", { key: "value" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.key).toBe("value");
  });

  // -------------------------------------------------------------------------
  // Trace context
  // -------------------------------------------------------------------------

  it("should attach traceId and spanId when set", () => {
    const { logger, lines } = captureLogger({ format: "json" });
    logger.setTraceContext("trace-123", "span-456");
    logger.info("traced");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.traceId).toBe("trace-123");
    expect(parsed.spanId).toBe("span-456");
  });

  it("should not include traceId when not set", () => {
    const { logger, lines } = captureLogger({ format: "json" });
    logger.info("no trace");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.traceId).toBeUndefined();
    expect(parsed.spanId).toBeUndefined();
  });

  it("should propagate trace context to child loggers", () => {
    const { logger, lines } = captureLogger({ format: "json" });
    logger.setTraceContext("trace-abc");
    const child = logger.child({ module: "db" });
    child.info("query");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.traceId).toBe("trace-abc");
  });

  // -------------------------------------------------------------------------
  // Default context
  // -------------------------------------------------------------------------

  it("should include default context in every log", () => {
    const { logger, lines } = captureLogger({
      format: "json",
      defaultContext: { env: "production", version: "1.2.3" },
    });
    logger.info("boot");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.env).toBe("production");
    expect(parsed.context.version).toBe("1.2.3");
  });

  it("should merge per-call context with default context", () => {
    const { logger, lines } = captureLogger({
      format: "json",
      defaultContext: { env: "production" },
    });
    logger.info("req", { requestId: "r-1" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.context.env).toBe("production");
    expect(parsed.context.requestId).toBe("r-1");
  });
});
