/**
 * Health check API route pattern for a SaaS application.
 *
 * Why a health check endpoint?
 * - Load balancers need to know if your app is alive
 * - Monitoring tools (Datadog, Better Uptime) poll this endpoint
 * - Kubernetes readiness/liveness probes use it
 * - It's the simplest way to verify your deploy worked
 *
 * What to check:
 * - Basic: app is responding (always include this)
 * - Database: can you connect and query?
 * - Cache: is Redis available?
 * - External services: are your dependencies up?
 *
 * What NOT to do:
 * - Don't make it slow — health checks run frequently
 * - Don't include sensitive info in the response
 * - Don't require authentication (monitoring tools need access)
 */

// ─── Types ──────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface DependencyCheck {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  error?: string;
}

export interface HealthCheckResponse {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  dependencies: DependencyCheck[];
}

// ─── Health Check Logic ─────────────────────────────────────

const startTime = Date.now();

/**
 * Run a dependency health check with a timeout.
 *
 * Pattern: Wrap each check in a timeout so a slow dependency
 * doesn't make the health endpoint hang.
 */
export async function checkDependency(
  name: string,
  checker: () => Promise<void>,
  timeoutMs: number = 3000
): Promise<DependencyCheck> {
  const start = Date.now();

  try {
    await Promise.race([
      checker(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), timeoutMs)
      ),
    ]);

    return {
      name,
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Aggregate dependency results into an overall status.
 *
 * Logic:
 * - All healthy → healthy
 * - Any unhealthy → degraded (not unhealthy, because the app itself is up)
 * - Override to unhealthy only if a critical dependency is down
 */
export function aggregateStatus(
  dependencies: DependencyCheck[],
  criticalDependencies: string[] = []
): HealthStatus {
  const unhealthy = dependencies.filter((d) => d.status === "unhealthy");

  if (unhealthy.length === 0) return "healthy";

  // Check if any critical dependency is down
  const criticalDown = unhealthy.some((d) =>
    criticalDependencies.includes(d.name)
  );

  return criticalDown ? "unhealthy" : "degraded";
}

/**
 * Build the full health check response.
 */
export function buildHealthResponse(
  dependencies: DependencyCheck[],
  version: string = "1.0.0",
  criticalDependencies: string[] = ["database"]
): HealthCheckResponse {
  return {
    status: aggregateStatus(dependencies, criticalDependencies),
    version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    dependencies,
  };
}

/**
 * Route handler pattern:
 *
 * ```ts
 * import { NextResponse } from "next/server";
 *
 * export async function GET() {
 *   const dependencies = await Promise.all([
 *     checkDependency("database", async () => {
 *       await db.query("SELECT 1");
 *     }),
 *     checkDependency("cache", async () => {
 *       await redis.ping();
 *     }),
 *   ]);
 *
 *   const health = buildHealthResponse(dependencies);
 *   const status = health.status === "unhealthy" ? 503 : 200;
 *
 *   return NextResponse.json(health, { status });
 * }
 * ```
 */
export const _routeHandlerDocumentation = "See pattern in JSDoc above";
