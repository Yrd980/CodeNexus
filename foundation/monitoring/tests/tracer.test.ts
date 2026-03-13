import { describe, it, expect } from "vitest";
import {
  createTracer,
  createInMemoryExporter,
  parseTraceParent,
  toTraceParent,
} from "../src/tracer.js";
import type { TraceContext } from "../src/tracer.js";

describe("Tracer", () => {
  function tracerWithExporter(config?: { sampleRate?: number }) {
    const exporter = createInMemoryExporter();
    const tracer = createTracer({
      serviceName: "test-service",
      sampleRate: config?.sampleRate ?? 1,
      exporter,
    });
    return { tracer, exporter };
  }

  // -------------------------------------------------------------------------
  // Span creation
  // -------------------------------------------------------------------------

  describe("Span creation", () => {
    it("should create a root span with traceId and spanId", () => {
      const { tracer } = tracerWithExporter();
      const active = tracer.startSpan("root-op");
      expect(active.span.traceId).toHaveLength(32);
      expect(active.span.spanId).toHaveLength(16);
      expect(active.span.parentSpanId).toBeUndefined();
      expect(active.span.name).toBe("root-op");
    });

    it("should record startTime on span creation", () => {
      const { tracer } = tracerWithExporter();
      const before = Date.now();
      const active = tracer.startSpan("timed");
      expect(active.span.startTime).toBeGreaterThanOrEqual(before);
      expect(active.span.startTime).toBeLessThanOrEqual(Date.now());
    });

    it("should record endTime when span ends", () => {
      const { tracer } = tracerWithExporter();
      const active = tracer.startSpan("timed");
      expect(active.span.endTime).toBeUndefined();
      active.end();
      expect(active.span.endTime).toBeDefined();
      expect(active.span.endTime!).toBeGreaterThanOrEqual(active.span.startTime);
    });

    it("should default status to unset", () => {
      const { tracer } = tracerWithExporter();
      const active = tracer.startSpan("op");
      expect(active.span.status).toBe("unset");
    });
  });

  // -------------------------------------------------------------------------
  // Parent-child relationships
  // -------------------------------------------------------------------------

  describe("Parent-child relationships", () => {
    it("should create a child span with the same traceId", () => {
      const { tracer } = tracerWithExporter();
      const parent = tracer.startSpan("parent");
      const child = parent.startChild("child");
      expect(child.span.traceId).toBe(parent.span.traceId);
      expect(child.span.parentSpanId).toBe(parent.span.spanId);
      expect(child.span.spanId).not.toBe(parent.span.spanId);
    });

    it("should create deeply nested child spans", () => {
      const { tracer } = tracerWithExporter();
      const root = tracer.startSpan("root");
      const child1 = root.startChild("child1");
      const child2 = child1.startChild("child2");
      expect(child2.span.traceId).toBe(root.span.traceId);
      expect(child2.span.parentSpanId).toBe(child1.span.spanId);
    });

    it("should create a child span from a parent context", () => {
      const { tracer } = tracerWithExporter();
      const parent = tracer.startSpan("parent");
      const ctx = parent.traceContext();
      const child = tracer.startSpan("child-via-ctx", ctx);
      expect(child.span.traceId).toBe(parent.span.traceId);
      expect(child.span.parentSpanId).toBe(parent.span.spanId);
    });
  });

  // -------------------------------------------------------------------------
  // Attributes and events
  // -------------------------------------------------------------------------

  describe("Attributes and events", () => {
    it("should set and read attributes", () => {
      const { tracer } = tracerWithExporter();
      const active = tracer.startSpan("op");
      active.setAttribute("http.method", "GET");
      active.setAttribute("http.status_code", 200);
      expect(active.span.attributes["http.method"]).toBe("GET");
      expect(active.span.attributes["http.status_code"]).toBe(200);
    });

    it("should add events with timestamps", () => {
      const { tracer } = tracerWithExporter();
      const active = tracer.startSpan("op");
      active.addEvent("cache.miss", { key: "user:123" });
      expect(active.span.events).toHaveLength(1);
      expect(active.span.events[0]!.name).toBe("cache.miss");
      expect(active.span.events[0]!.attributes).toEqual({ key: "user:123" });
      expect(active.span.events[0]!.timestamp).toBeGreaterThan(0);
    });

    it("should set span status", () => {
      const { tracer } = tracerWithExporter();
      const active = tracer.startSpan("op");
      active.setStatus("error");
      expect(active.span.status).toBe("error");
    });
  });

  // -------------------------------------------------------------------------
  // Context propagation (W3C Trace Context)
  // -------------------------------------------------------------------------

  describe("W3C Trace Context", () => {
    it("should parse a valid traceparent header", () => {
      const ctx = parseTraceParent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
      expect(ctx).not.toBeNull();
      expect(ctx!.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(ctx!.spanId).toBe("00f067aa0ba902b7");
      expect(ctx!.sampled).toBe(true);
    });

    it("should parse unsampled traceparent", () => {
      const ctx = parseTraceParent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00");
      expect(ctx).not.toBeNull();
      expect(ctx!.sampled).toBe(false);
    });

    it("should return null for invalid traceparent", () => {
      expect(parseTraceParent("invalid")).toBeNull();
      expect(parseTraceParent("01-abc-def-01")).toBeNull(); // wrong version
      expect(parseTraceParent("00-short-short-01")).toBeNull(); // wrong lengths
    });

    it("should serialize trace context to traceparent header", () => {
      const ctx: TraceContext = {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        sampled: true,
      };
      expect(toTraceParent(ctx)).toBe(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      );
    });

    it("should round-trip parse → serialize", () => {
      const original = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
      const ctx = parseTraceParent(original)!;
      expect(toTraceParent(ctx)).toBe(original);
    });

    it("should start a span from a traceparent header", () => {
      const { tracer, exporter } = tracerWithExporter();
      const header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
      const active = tracer.startSpanFromHeader("handle-request", header);
      expect(active).not.toBeNull();
      expect(active!.span.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(active!.span.parentSpanId).toBe("00f067aa0ba902b7");
      active!.end();
      expect(exporter.spans).toHaveLength(1);
    });

    it("should return null for invalid traceparent header", () => {
      const { tracer } = tracerWithExporter();
      const active = tracer.startSpanFromHeader("op", "garbage");
      expect(active).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Sampling
  // -------------------------------------------------------------------------

  describe("Sampling", () => {
    it("should export spans when sampleRate is 1", () => {
      const { tracer, exporter } = tracerWithExporter({ sampleRate: 1 });
      const span = tracer.startSpan("always");
      span.end();
      expect(exporter.spans).toHaveLength(1);
    });

    it("should not export spans when sampleRate is 0", () => {
      const { tracer, exporter } = tracerWithExporter({ sampleRate: 0 });
      for (let i = 0; i < 100; i++) {
        const span = tracer.startSpan(`op-${i}`);
        span.end();
      }
      expect(exporter.spans).toHaveLength(0);
    });

    it("should inherit sampling decision from parent context", () => {
      const { tracer, exporter } = tracerWithExporter({ sampleRate: 1 });
      // Parent says "not sampled"
      const unsampledCtx: TraceContext = {
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        sampled: false,
      };
      const child = tracer.startSpan("child", unsampledCtx);
      child.end();
      expect(exporter.spans).toHaveLength(0); // inherited unsampled
    });
  });

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  describe("Export", () => {
    it("should export completed spans with service.name attribute", () => {
      const { tracer, exporter } = tracerWithExporter();
      const span = tracer.startSpan("op");
      span.setAttribute("custom", "value");
      span.end();
      expect(exporter.spans).toHaveLength(1);
      expect(exporter.spans[0]!.attributes["service.name"]).toBe("test-service");
      expect(exporter.spans[0]!.attributes["custom"]).toBe("value");
    });

    it("should reset the exporter", () => {
      const { tracer, exporter } = tracerWithExporter();
      tracer.startSpan("op").end();
      expect(exporter.spans).toHaveLength(1);
      exporter.reset();
      expect(exporter.spans).toHaveLength(0);
    });

    it("should export a deep copy of the span", () => {
      const { tracer, exporter } = tracerWithExporter();
      const active = tracer.startSpan("op");
      active.setAttribute("key", "before");
      active.end();
      // Mutate the original after export
      active.setAttribute("key", "after");
      expect(exporter.spans[0]!.attributes["key"]).toBe("before");
    });
  });
});
