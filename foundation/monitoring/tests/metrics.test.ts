import { describe, it, expect } from "vitest";
import { createMetrics } from "../src/metrics.js";

describe("Metrics", () => {
  // -------------------------------------------------------------------------
  // Counter
  // -------------------------------------------------------------------------

  describe("Counter", () => {
    it("should increment by 1 by default", () => {
      const m = createMetrics();
      m.counter("requests_total");
      m.counter("requests_total");
      m.counter("requests_total");
      const snap = m.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]!.value).toBe(3);
    });

    it("should increment by custom value", () => {
      const m = createMetrics();
      m.counter("bytes_sent", {}, 1024);
      m.counter("bytes_sent", {}, 2048);
      const snap = m.snapshot();
      expect(snap[0]!.value).toBe(3072);
    });

    it("should separate counters by labels", () => {
      const m = createMetrics();
      m.counter("requests_total", { method: "GET" });
      m.counter("requests_total", { method: "POST" });
      m.counter("requests_total", { method: "GET" });
      const snap = m.snapshot().filter((s) => s.name === "requests_total");
      expect(snap).toHaveLength(2);
      const get = snap.find((s) => s.labels.method === "GET");
      const post = snap.find((s) => s.labels.method === "POST");
      expect(get!.value).toBe(2);
      expect(post!.value).toBe(1);
    });

    it("should apply prefix to counter names", () => {
      const m = createMetrics({ prefix: "myapp" });
      m.counter("requests_total");
      const snap = m.snapshot();
      expect(snap[0]!.name).toBe("myapp_requests_total");
    });
  });

  // -------------------------------------------------------------------------
  // Gauge
  // -------------------------------------------------------------------------

  describe("Gauge", () => {
    it("should set gauge to absolute value", () => {
      const m = createMetrics();
      m.gauge("active_connections", 42);
      const snap = m.snapshot();
      expect(snap[0]!.value).toBe(42);
    });

    it("should overwrite previous gauge value", () => {
      const m = createMetrics();
      m.gauge("memory_usage", 100);
      m.gauge("memory_usage", 200);
      const snap = m.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]!.value).toBe(200);
    });

    it("should separate gauges by labels", () => {
      const m = createMetrics();
      m.gauge("pool_size", 5, { pool: "read" });
      m.gauge("pool_size", 10, { pool: "write" });
      const snap = m.snapshot().filter((s) => s.name === "pool_size");
      expect(snap).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Histogram
  // -------------------------------------------------------------------------

  describe("Histogram", () => {
    it("should observe values", () => {
      const m = createMetrics();
      m.histogram("request_duration", 0.1);
      m.histogram("request_duration", 0.5);
      m.histogram("request_duration", 1.2);
      const snap = m.snapshot().filter((s) => s.name === "request_duration");
      expect(snap).toHaveLength(1);
      expect(snap[0]!.type).toBe("histogram");
      expect(snap[0]!.value).toBe(3); // count
    });

    it("should register histogram with custom buckets", () => {
      const m = createMetrics();
      m.registerHistogram("custom_duration", "Custom duration", {
        boundaries: [0.1, 0.5, 1.0],
      });
      m.histogram("custom_duration", 0.05);
      m.histogram("custom_duration", 0.3);
      m.histogram("custom_duration", 0.8);
      m.histogram("custom_duration", 5.0);
      const snap = m.snapshot().filter((s) => s.name === "custom_duration");
      expect(snap[0]!.value).toBe(4);
    });

    it("should separate histogram observations by labels", () => {
      const m = createMetrics();
      m.histogram("request_duration", 0.1, { endpoint: "/api" });
      m.histogram("request_duration", 0.2, { endpoint: "/health" });
      m.histogram("request_duration", 0.3, { endpoint: "/api" });
      const snap = m.snapshot().filter((s) => s.name === "request_duration");
      expect(snap).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Prometheus format
  // -------------------------------------------------------------------------

  describe("Prometheus text exposition", () => {
    it("should format counter in prometheus format", () => {
      const m = createMetrics();
      m.registerCounter("http_requests_total", "Total HTTP requests");
      m.counter("http_requests_total", { method: "GET", status: "200" }, 5);
      const prom = m.toPrometheus();
      expect(prom).toContain("# HELP http_requests_total");
      expect(prom).toContain("# TYPE http_requests_total counter");
      expect(prom).toContain("http_requests_total{");
      expect(prom).toContain("5");
    });

    it("should format gauge in prometheus format", () => {
      const m = createMetrics();
      m.registerGauge("temperature", "Current temperature");
      m.gauge("temperature", 23.5);
      const prom = m.toPrometheus();
      expect(prom).toContain("# TYPE temperature gauge");
      expect(prom).toContain("23.5");
    });

    it("should format histogram with bucket lines", () => {
      const m = createMetrics();
      m.registerHistogram("latency", "Request latency", {
        boundaries: [0.1, 0.5, 1.0],
      });
      m.histogram("latency", 0.05);
      m.histogram("latency", 0.3);
      m.histogram("latency", 2.0);
      const prom = m.toPrometheus();
      expect(prom).toContain("# TYPE latency histogram");
      expect(prom).toContain('latency_bucket{le="0.1"}');
      expect(prom).toContain('latency_bucket{le="0.5"}');
      expect(prom).toContain('latency_bucket{le="1"}');
      expect(prom).toContain('latency_bucket{le="+Inf"}');
      expect(prom).toContain("latency_sum");
      expect(prom).toContain("latency_count");
    });

    it("should include default labels in prometheus output", () => {
      const m = createMetrics({ defaultLabels: { instance: "web-1" } });
      m.counter("requests_total");
      const prom = m.toPrometheus();
      expect(prom).toContain('instance="web-1"');
    });
  });

  // -------------------------------------------------------------------------
  // Reset & snapshot
  // -------------------------------------------------------------------------

  describe("Reset & snapshot", () => {
    it("should reset all metrics", () => {
      const m = createMetrics();
      m.counter("a");
      m.gauge("b", 1);
      m.histogram("c", 0.5);
      expect(m.snapshot().length).toBeGreaterThan(0);
      m.reset();
      expect(m.snapshot()).toHaveLength(0);
    });

    it("should return correct metric types in snapshot", () => {
      const m = createMetrics();
      m.counter("cnt");
      m.gauge("gg", 1);
      m.histogram("hist", 0.1);
      const snap = m.snapshot();
      expect(snap.find((s) => s.name === "cnt")!.type).toBe("counter");
      expect(snap.find((s) => s.name === "gg")!.type).toBe("gauge");
      expect(snap.find((s) => s.name === "hist")!.type).toBe("histogram");
    });
  });

  // -------------------------------------------------------------------------
  // Type conflicts
  // -------------------------------------------------------------------------

  describe("Type conflicts", () => {
    it("should throw when using a counter name as a gauge", () => {
      const m = createMetrics();
      m.counter("metric_x");
      expect(() => m.gauge("metric_x", 1)).toThrow(/already registered/);
    });
  });
});
