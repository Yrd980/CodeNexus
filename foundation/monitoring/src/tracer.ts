/**
 * Distributed tracing — span creation, context propagation (W3C Trace
 * Context), sampling, and pluggable export.
 *
 * Design decisions:
 *  - W3C Trace Context (traceparent header) because every major vendor
 *    supports it and cross-service tracing needs a standard format.
 *  - Sampling at the root span because child spans should inherit the
 *    parent's sampling decision — you never want half a trace.
 *  - Pluggable exporter interface so you can start with in-memory (tests)
 *    and swap to OTLP/Jaeger/Zipkin without touching application code.
 */

import { randomBytes } from "node:crypto";
import type { Span, SpanEvent, SpanStatus, TraceExporter, TracerConfig } from "./types.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function generateTraceId(): string {
  return randomHex(16); // 32 hex chars
}

function generateSpanId(): string {
  return randomHex(8); // 16 hex chars
}

// ---------------------------------------------------------------------------
// W3C Trace Context
// ---------------------------------------------------------------------------

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

/**
 * Parse a W3C `traceparent` header.
 * Format: `{version}-{traceId}-{parentId}-{flags}`
 * Example: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
 */
export function parseTraceParent(header: string): TraceContext | null {
  const parts = header.split("-");
  if (parts.length !== 4) return null;
  const version = parts[0];
  const traceId = parts[1];
  const spanId = parts[2];
  const flags = parts[3];
  if (version !== "00" || !traceId || !spanId || !flags) return null;
  if (traceId.length !== 32 || spanId.length !== 16) return null;
  return {
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & 0x01) === 1,
  };
}

/**
 * Serialize a trace context into a W3C `traceparent` header value.
 */
export function toTraceParent(ctx: TraceContext): string {
  const flags = ctx.sampled ? "01" : "00";
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

// ---------------------------------------------------------------------------
// In-memory exporter (testing)
// ---------------------------------------------------------------------------

export interface InMemoryTraceExporter extends TraceExporter {
  readonly spans: ReadonlyArray<Span>;
  reset(): void;
}

export function createInMemoryExporter(): InMemoryTraceExporter {
  const spans: Span[] = [];
  return {
    get spans() {
      return spans;
    },
    export(batch: ReadonlyArray<Span>): void {
      spans.push(...batch);
    },
    reset(): void {
      spans.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Active span handle
// ---------------------------------------------------------------------------

export interface ActiveSpan {
  readonly span: Readonly<Span>;
  /** Set an attribute on this span. */
  setAttribute(key: string, value: unknown): void;
  /** Add a timestamped event (annotation). */
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  /** Mark span status. */
  setStatus(status: SpanStatus): void;
  /** End the span (records endTime and triggers export). */
  end(): void;
  /** Create a child span. */
  startChild(name: string): ActiveSpan;
  /** Get the trace context for propagation. */
  traceContext(): TraceContext;
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

export interface Tracer {
  /**
   * Start a new root span or a child span if `parentContext` is provided.
   * Sampling is decided at the root and inherited by children.
   */
  startSpan(name: string, parentContext?: TraceContext): ActiveSpan;

  /**
   * Start a span from an incoming W3C traceparent header.
   * Returns null if the header is malformed.
   */
  startSpanFromHeader(name: string, traceparentHeader: string): ActiveSpan | null;
}

export function createTracer(config: TracerConfig): Tracer {
  const { serviceName, sampleRate = 1, exporter } = config;

  function shouldSample(): boolean {
    if (sampleRate >= 1) return true;
    if (sampleRate <= 0) return false;
    return Math.random() < sampleRate;
  }

  function buildActiveSpan(span: Span, sampled: boolean): ActiveSpan {
    // The span object is mutated in-place for simplicity.
    // It is only exported (frozen) on `.end()`.
    return {
      get span() {
        return span;
      },

      setAttribute(key, value) {
        span.attributes[key] = value;
      },

      addEvent(name, attributes) {
        const event: SpanEvent = { name, timestamp: Date.now() };
        if (attributes) event.attributes = attributes;
        span.events.push(event);
      },

      setStatus(status) {
        span.status = status;
      },

      end() {
        span.endTime = Date.now();
        span.attributes["service.name"] = serviceName;
        if (sampled && exporter) {
          exporter.export([{ ...span, attributes: { ...span.attributes }, events: [...span.events] }]);
        }
      },

      startChild(childName) {
        const childSpan: Span = {
          traceId: span.traceId,
          spanId: generateSpanId(),
          parentSpanId: span.spanId,
          name: childName,
          startTime: Date.now(),
          attributes: {},
          events: [],
          status: "unset",
        };
        return buildActiveSpan(childSpan, sampled);
      },

      traceContext(): TraceContext {
        return {
          traceId: span.traceId,
          spanId: span.spanId,
          sampled,
        };
      },
    };
  }

  return {
    startSpan(name, parentContext?) {
      const sampled = parentContext ? parentContext.sampled : shouldSample();
      const traceId = parentContext ? parentContext.traceId : generateTraceId();

      const span: Span = {
        traceId,
        spanId: generateSpanId(),
        parentSpanId: parentContext?.spanId,
        name,
        startTime: Date.now(),
        attributes: {},
        events: [],
        status: "unset",
      };

      return buildActiveSpan(span, sampled);
    },

    startSpanFromHeader(name, traceparentHeader) {
      const parsed = parseTraceParent(traceparentHeader);
      if (!parsed) return null;
      return this.startSpan(name, parsed);
    },
  };
}
