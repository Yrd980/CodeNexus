/**
 * Type definitions for the monitoring module.
 *
 * Covers structured logging, metrics collection, distributed tracing,
 * and health checks — the four pillars of production observability.
 */

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

/** Numeric priority for filtering. Higher = more severe. */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/** A single structured log entry emitted by the logger. */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string; // ISO-8601
  context: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
}

/** Configuration accepted by `createLogger`. */
export interface LoggerConfig {
  /** Minimum level to emit. Defaults to `"info"`. */
  level?: LogLevel;
  /** Output format. `json` for production, `text` for development. */
  format?: "json" | "text";
  /** Dot-paths whose values will be redacted (e.g. `"password"`, `"headers.authorization"`). */
  redactPaths?: string[];
  /** Static context merged into every log entry. */
  defaultContext?: Record<string, unknown>;
  /** Custom output sink. Defaults to `process.stdout.write`. */
  output?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type MetricType = "counter" | "gauge" | "histogram";

/** A single metric data point. */
export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number; // epoch ms
}

/** Configuration accepted by `createMetrics`. */
export interface MetricsConfig {
  /** Prefix prepended to every metric name (e.g. `"myapp"`). */
  prefix?: string;
  /** Labels automatically attached to every metric. */
  defaultLabels?: Record<string, string>;
}

/** Histogram bucket definition — upper-bound inclusive. */
export interface HistogramBuckets {
  /** Sorted upper-bound values. Defaults to Prometheus-style defaults. */
  boundaries: number[];
}

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

export type SpanStatus = "ok" | "error" | "unset";

/** An event (annotation) attached to a span. */
export interface SpanEvent {
  name: string;
  timestamp: number; // epoch ms
  attributes?: Record<string, unknown>;
}

/** A single span within a distributed trace. */
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number; // epoch ms
  endTime?: number; // epoch ms — undefined while active
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: SpanStatus;
}

/** Configuration accepted by `createTracer`. */
export interface TracerConfig {
  /** Logical service name stamped onto every span. */
  serviceName: string;
  /** Probability 0..1 that a new root span is sampled. Defaults to `1` (sample everything). */
  sampleRate?: number;
  /** Pluggable backend that receives completed spans. */
  exporter?: TraceExporter;
}

/** Interface that trace backends implement. */
export interface TraceExporter {
  export(spans: ReadonlyArray<Span>): void;
}

// ---------------------------------------------------------------------------
// Health Checks
// ---------------------------------------------------------------------------

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** Result of a single dependency check. */
export interface DependencyHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
}

/** Aggregate health response. */
export interface HealthResponse {
  status: HealthStatus;
  timestamp: string; // ISO-8601
  uptime: number; // seconds
  dependencies: DependencyHealth[];
}

/** A function that checks one dependency's health. */
export type DependencyChecker = () => Promise<DependencyHealth>;

/** Configuration accepted by `createHealthCheck`. */
export interface HealthCheckConfig {
  /** Dependency checkers keyed by name. */
  dependencies?: Record<string, () => Promise<Pick<DependencyHealth, "status" | "message">>>;
}
