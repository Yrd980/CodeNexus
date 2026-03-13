/**
 * foundation/monitoring — Structured logging, metrics, tracing, and health checks.
 *
 * This is the public API surface. Import from here.
 *
 * @example
 * ```ts
 * import { createLogger, createMetrics, createTracer, createHealthCheck } from "./index.js";
 *
 * const logger  = createLogger({ level: "info", format: "json" });
 * const metrics = createMetrics({ prefix: "myapp" });
 * const tracer  = createTracer({ serviceName: "myapp" });
 * const health  = createHealthCheck();
 * ```
 */

// --- Logger ----------------------------------------------------------------
export { createLogger } from "./logger.js";
export type { Logger } from "./logger.js";

// --- Metrics ---------------------------------------------------------------
export { createMetrics } from "./metrics.js";
export type { MetricsCollector } from "./metrics.js";

// --- Tracer ----------------------------------------------------------------
export {
  createTracer,
  createInMemoryExporter,
  parseTraceParent,
  toTraceParent,
} from "./tracer.js";
export type { Tracer, ActiveSpan, InMemoryTraceExporter, TraceContext } from "./tracer.js";

// --- Health ----------------------------------------------------------------
export { createHealthCheck } from "./health.js";
export type { HealthChecker } from "./health.js";

// --- Shared types ----------------------------------------------------------
export type {
  LogLevel,
  LogEntry,
  LoggerConfig,
  MetricType,
  Metric,
  MetricsConfig,
  HistogramBuckets,
  Span,
  SpanEvent,
  SpanStatus,
  TraceExporter,
  TracerConfig,
  HealthStatus,
  DependencyHealth,
  HealthResponse,
  DependencyChecker,
  HealthCheckConfig,
} from "./types.js";

export { LOG_LEVEL_PRIORITY } from "./types.js";
