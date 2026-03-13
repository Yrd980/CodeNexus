/**
 * Metrics collector — counters, gauges, and histograms with
 * Prometheus-compatible text exposition.
 *
 * Design decisions:
 *  - Prometheus format because it's the de-facto standard for pull-based
 *    metrics.  Every modern monitoring stack can scrape it.
 *  - Labels (dimensional metrics) because a flat metric name doesn't
 *    let you slice by HTTP method, status code, endpoint, etc.
 *  - Histogram with configurable buckets because percentiles computed
 *    client-side are more accurate than server-side aggregation.
 */

import type { HistogramBuckets, Metric, MetricType, MetricsConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface CounterState {
  type: "counter";
  help: string;
  values: Map<string, number>; // label-key → value
}

interface GaugeState {
  type: "gauge";
  help: string;
  values: Map<string, number>;
}

interface HistogramState {
  type: "histogram";
  help: string;
  boundaries: number[];
  /** Per-label-key: array of bucket counts (len = boundaries.length + 1 for +Inf) */
  buckets: Map<string, number[]>;
  sums: Map<string, number>;
  counts: Map<string, number>;
}

type MetricState = CounterState | GaugeState | HistogramState;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_HISTOGRAM_BOUNDARIES = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

function labelKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}="${labels[k] ?? ""}"`).join(",");
}

function formatLabels(
  allLabels: Record<string, string>,
  extra?: Record<string, string>,
): string {
  const merged = extra ? { ...allLabels, ...extra } : allLabels;
  const keys = Object.keys(merged).sort();
  if (keys.length === 0) return "";
  return `{${keys.map((k) => `${k}="${merged[k] ?? ""}"`).join(",")}}`;
}

/**
 * Parse a label key string (e.g. `method="GET",status="200"`) back into
 * a Record.  Used by Prometheus formatters and snapshot.
 */
function parseLabelKey(lk: string, target: Record<string, string>): void {
  if (!lk) return;
  for (const pair of lk.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const k = pair.slice(0, eqIdx);
    const v = pair.slice(eqIdx + 1).replace(/"/g, "");
    target[k] = v;
  }
}

function prefixName(prefix: string | undefined, name: string): string {
  return prefix ? `${prefix}_${name}` : name;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MetricsCollector {
  /** Increment a counter by `value` (default 1). */
  counter(name: string, labels?: Record<string, string>, value?: number): void;

  /** Set a gauge to an absolute value. */
  gauge(name: string, value: number, labels?: Record<string, string>): void;

  /** Observe a value in a histogram. */
  histogram(name: string, value: number, labels?: Record<string, string>): void;

  /** Register a histogram with custom buckets (must be called before first observe). */
  registerHistogram(name: string, help: string, buckets?: HistogramBuckets): void;

  /** Register a counter with help text. */
  registerCounter(name: string, help: string): void;

  /** Register a gauge with help text. */
  registerGauge(name: string, help: string): void;

  /** Return all metrics as Prometheus text exposition format. */
  toPrometheus(): string;

  /** Return a snapshot of all raw metrics (useful for testing). */
  snapshot(): Metric[];

  /** Reset all metrics (useful for testing). */
  reset(): void;
}

export function createMetrics(config: MetricsConfig = {}): MetricsCollector {
  const { prefix, defaultLabels = {} } = config;
  const registry = new Map<string, MetricState>();

  function ensureCounter(name: string): CounterState {
    const full = prefixName(prefix, name);
    let state = registry.get(full);
    if (!state) {
      state = { type: "counter", help: name, values: new Map() };
      registry.set(full, state);
    }
    if (state.type !== "counter") {
      throw new Error(`Metric "${full}" is already registered as ${state.type}, not counter`);
    }
    return state;
  }

  function ensureGauge(name: string): GaugeState {
    const full = prefixName(prefix, name);
    let state = registry.get(full);
    if (!state) {
      state = { type: "gauge", help: name, values: new Map() };
      registry.set(full, state);
    }
    if (state.type !== "gauge") {
      throw new Error(`Metric "${full}" is already registered as ${state.type}, not gauge`);
    }
    return state;
  }

  function ensureHistogram(name: string): HistogramState {
    const full = prefixName(prefix, name);
    let state = registry.get(full);
    if (!state) {
      state = {
        type: "histogram",
        help: name,
        boundaries: [...DEFAULT_HISTOGRAM_BOUNDARIES],
        buckets: new Map(),
        sums: new Map(),
        counts: new Map(),
      };
      registry.set(full, state);
    }
    if (state.type !== "histogram") {
      throw new Error(`Metric "${full}" is already registered as ${state.type}, not histogram`);
    }
    return state;
  }

  // -----------------------------------------------------------------------
  // Prometheus text format
  // -----------------------------------------------------------------------

  function prometheusCounter(fullName: string, state: CounterState): string {
    const lines: string[] = [];
    lines.push(`# HELP ${fullName} ${state.help}`);
    lines.push(`# TYPE ${fullName} counter`);
    for (const [lk, val] of state.values) {
      const allLabels: Record<string, string> = { ...defaultLabels };
      parseLabelKey(lk, allLabels);
      lines.push(`${fullName}${formatLabels(allLabels)} ${val}`);
    }
    return lines.join("\n");
  }

  function prometheusGauge(fullName: string, state: GaugeState): string {
    const lines: string[] = [];
    lines.push(`# HELP ${fullName} ${state.help}`);
    lines.push(`# TYPE ${fullName} gauge`);
    for (const [lk, val] of state.values) {
      const allLabels: Record<string, string> = { ...defaultLabels };
      parseLabelKey(lk, allLabels);
      lines.push(`${fullName}${formatLabels(allLabels)} ${val}`);
    }
    return lines.join("\n");
  }

  function prometheusHistogram(fullName: string, state: HistogramState): string {
    const lines: string[] = [];
    lines.push(`# HELP ${fullName} ${state.help}`);
    lines.push(`# TYPE ${fullName} histogram`);
    for (const [lk, bucketCounts] of state.buckets) {
      const parsedLabels: Record<string, string> = { ...defaultLabels };
      parseLabelKey(lk, parsedLabels);

      let cumulative = 0;
      for (let i = 0; i < state.boundaries.length; i++) {
        const bucketVal = bucketCounts[i] ?? 0;
        cumulative += bucketVal;
        const boundary = state.boundaries[i];
        const le = boundary !== undefined ? boundary.toString() : String(i);
        lines.push(
          `${fullName}_bucket${formatLabels(parsedLabels, { le })} ${cumulative}`,
        );
      }
      // +Inf bucket
      cumulative += bucketCounts[state.boundaries.length] ?? 0;
      lines.push(
        `${fullName}_bucket${formatLabels(parsedLabels, { le: "+Inf" })} ${cumulative}`,
      );
      lines.push(
        `${fullName}_sum${formatLabels(parsedLabels)} ${state.sums.get(lk) ?? 0}`,
      );
      lines.push(
        `${fullName}_count${formatLabels(parsedLabels)} ${state.counts.get(lk) ?? 0}`,
      );
    }
    return lines.join("\n");
  }

  // -----------------------------------------------------------------------
  // Collector implementation
  // -----------------------------------------------------------------------

  return {
    counter(name, labels = {}, value = 1) {
      const state = ensureCounter(name);
      const lk = labelKey(labels);
      state.values.set(lk, (state.values.get(lk) ?? 0) + value);
    },

    gauge(name, value, labels = {}) {
      const state = ensureGauge(name);
      const lk = labelKey(labels);
      state.values.set(lk, value);
    },

    histogram(name, value, labels = {}) {
      const state = ensureHistogram(name);
      const lk = labelKey(labels);

      // Initialise bucket array if needed
      if (!state.buckets.has(lk)) {
        state.buckets.set(lk, new Array(state.boundaries.length + 1).fill(0));
        state.sums.set(lk, 0);
        state.counts.set(lk, 0);
      }

      const bucketArr = state.buckets.get(lk)!;
      let placed = false;
      for (let i = 0; i < state.boundaries.length; i++) {
        const boundary = state.boundaries[i];
        if (boundary !== undefined && value <= boundary) {
          bucketArr[i] = (bucketArr[i] ?? 0) + 1;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const infIdx = state.boundaries.length;
        bucketArr[infIdx] = (bucketArr[infIdx] ?? 0) + 1; // +Inf
      }

      state.sums.set(lk, (state.sums.get(lk) ?? 0) + value);
      state.counts.set(lk, (state.counts.get(lk) ?? 0) + 1);
    },

    registerHistogram(name, help, buckets) {
      const full = prefixName(prefix, name);
      if (registry.has(full)) return; // already registered
      const boundaries = buckets
        ? [...buckets.boundaries].sort((a, b) => a - b)
        : [...DEFAULT_HISTOGRAM_BOUNDARIES];
      registry.set(full, {
        type: "histogram",
        help,
        boundaries,
        buckets: new Map(),
        sums: new Map(),
        counts: new Map(),
      });
    },

    registerCounter(name, help) {
      const full = prefixName(prefix, name);
      if (registry.has(full)) return;
      registry.set(full, { type: "counter", help, values: new Map() });
    },

    registerGauge(name, help) {
      const full = prefixName(prefix, name);
      if (registry.has(full)) return;
      registry.set(full, { type: "gauge", help, values: new Map() });
    },

    toPrometheus(): string {
      const sections: string[] = [];
      for (const [fullName, state] of registry) {
        switch (state.type) {
          case "counter":
            sections.push(prometheusCounter(fullName, state));
            break;
          case "gauge":
            sections.push(prometheusGauge(fullName, state));
            break;
          case "histogram":
            sections.push(prometheusHistogram(fullName, state));
            break;
        }
      }
      return sections.join("\n\n") + "\n";
    },

    snapshot(): Metric[] {
      const result: Metric[] = [];
      const now = Date.now();
      for (const [fullName, state] of registry) {
        if (state.type === "counter" || state.type === "gauge") {
          for (const [lk, val] of state.values) {
            const labels: Record<string, string> = {};
            parseLabelKey(lk, labels);
            result.push({
              name: fullName,
              type: state.type as MetricType,
              value: val,
              labels,
              timestamp: now,
            });
          }
        } else {
          // histogram — report count as the metric value
          for (const [lk, count] of state.counts) {
            const labels: Record<string, string> = {};
            parseLabelKey(lk, labels);
            result.push({
              name: fullName,
              type: "histogram",
              value: count,
              labels,
              timestamp: now,
            });
          }
        }
      }
      return result;
    },

    reset(): void {
      registry.clear();
    },
  };
}
