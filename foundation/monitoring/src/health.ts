/**
 * Health checks — readiness, liveness, and dependency checks.
 *
 * Design decisions:
 *  - Separate readiness vs liveness because Kubernetes needs both:
 *    readiness gates traffic, liveness triggers restarts.
 *  - Standard response format so every service exposes the same shape
 *    and dashboards/alerting rules are portable.
 *  - Dependency checks are async and time-limited because a hanging DB
 *    connection shouldn't make the health endpoint itself hang.
 */

import type {
  DependencyHealth,
  HealthCheckConfig,
  HealthResponse,
  HealthStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default timeout for individual dependency checks (ms). */
const DEFAULT_CHECK_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HealthChecker {
  /** Readiness: can the app serve requests? Runs all dependency checks. */
  readiness(): Promise<HealthResponse>;

  /** Liveness: is the process alive and not deadlocked? Lightweight check. */
  liveness(): Promise<HealthResponse>;

  /** Add or replace a dependency checker at runtime. */
  addDependency(
    name: string,
    checker: () => Promise<Pick<DependencyHealth, "status" | "message">>,
  ): void;

  /** Remove a dependency checker. */
  removeDependency(name: string): void;
}

export function createHealthCheck(config: HealthCheckConfig = {}): HealthChecker {
  const startTime = Date.now();
  const dependencies = new Map(Object.entries(config.dependencies ?? {}));

  function uptimeSeconds(): number {
    return Math.floor((Date.now() - startTime) / 1_000);
  }

  function worstStatus(statuses: HealthStatus[]): HealthStatus {
    if (statuses.includes("unhealthy")) return "unhealthy";
    if (statuses.includes("degraded")) return "degraded";
    return "healthy";
  }

  async function checkDependency(
    name: string,
    checker: () => Promise<Pick<DependencyHealth, "status" | "message">>,
  ): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      const result = await Promise.race([
        checker(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timed out")), DEFAULT_CHECK_TIMEOUT_MS),
        ),
      ]);
      return {
        name,
        status: result.status,
        latencyMs: Date.now() - start,
        message: result.message,
      };
    } catch (err) {
      return {
        name,
        status: "unhealthy",
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    async readiness(): Promise<HealthResponse> {
      const checks: Promise<DependencyHealth>[] = [];
      for (const [name, checker] of dependencies) {
        checks.push(checkDependency(name, checker));
      }

      const results = await Promise.all(checks);
      const status = results.length === 0
        ? "healthy"
        : worstStatus(results.map((r) => r.status));

      return {
        status,
        timestamp: new Date().toISOString(),
        uptime: uptimeSeconds(),
        dependencies: results,
      };
    },

    async liveness(): Promise<HealthResponse> {
      // Liveness is intentionally lightweight — if we can execute JS, we're alive.
      return {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: uptimeSeconds(),
        dependencies: [],
      };
    },

    addDependency(name, checker) {
      dependencies.set(name, checker);
    },

    removeDependency(name) {
      dependencies.delete(name);
    },
  };
}
