import { describe, it, expect, vi } from "vitest";
import { createHealthCheck } from "../src/health.js";

describe("Health Checks", () => {
  // -------------------------------------------------------------------------
  // Liveness
  // -------------------------------------------------------------------------

  describe("Liveness", () => {
    it("should return healthy for liveness", async () => {
      const health = createHealthCheck();
      const res = await health.liveness();
      expect(res.status).toBe("healthy");
      expect(res.dependencies).toHaveLength(0);
    });

    it("should include a valid ISO timestamp", async () => {
      const health = createHealthCheck();
      const res = await health.liveness();
      expect(() => new Date(res.timestamp)).not.toThrow();
      expect(new Date(res.timestamp).toISOString()).toBe(res.timestamp);
    });

    it("should report uptime in seconds", async () => {
      const health = createHealthCheck();
      const res = await health.liveness();
      expect(res.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof res.uptime).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // Readiness
  // -------------------------------------------------------------------------

  describe("Readiness", () => {
    it("should return healthy when no dependencies are configured", async () => {
      const health = createHealthCheck();
      const res = await health.readiness();
      expect(res.status).toBe("healthy");
      expect(res.dependencies).toHaveLength(0);
    });

    it("should return healthy when all dependencies are healthy", async () => {
      const health = createHealthCheck({
        dependencies: {
          database: async () => ({ status: "healthy" }),
          cache: async () => ({ status: "healthy" }),
        },
      });
      const res = await health.readiness();
      expect(res.status).toBe("healthy");
      expect(res.dependencies).toHaveLength(2);
      expect(res.dependencies.every((d) => d.status === "healthy")).toBe(true);
    });

    it("should return degraded when any dependency is degraded", async () => {
      const health = createHealthCheck({
        dependencies: {
          database: async () => ({ status: "healthy" }),
          cache: async () => ({ status: "degraded", message: "High latency" }),
        },
      });
      const res = await health.readiness();
      expect(res.status).toBe("degraded");
    });

    it("should return unhealthy when any dependency is unhealthy", async () => {
      const health = createHealthCheck({
        dependencies: {
          database: async () => ({ status: "unhealthy", message: "Connection refused" }),
          cache: async () => ({ status: "healthy" }),
        },
      });
      const res = await health.readiness();
      expect(res.status).toBe("unhealthy");
    });

    it("should prefer unhealthy over degraded", async () => {
      const health = createHealthCheck({
        dependencies: {
          database: async () => ({ status: "unhealthy" }),
          cache: async () => ({ status: "degraded" }),
          search: async () => ({ status: "healthy" }),
        },
      });
      const res = await health.readiness();
      expect(res.status).toBe("unhealthy");
    });

    it("should include dependency name in results", async () => {
      const health = createHealthCheck({
        dependencies: {
          postgres: async () => ({ status: "healthy" }),
        },
      });
      const res = await health.readiness();
      expect(res.dependencies[0]!.name).toBe("postgres");
    });

    it("should report dependency latency", async () => {
      const health = createHealthCheck({
        dependencies: {
          slow_service: async () => {
            await new Promise((r) => setTimeout(r, 50));
            return { status: "healthy" };
          },
        },
      });
      const res = await health.readiness();
      expect(res.dependencies[0]!.latencyMs).toBeGreaterThanOrEqual(40);
    });

    it("should catch and report dependency check errors as unhealthy", async () => {
      const health = createHealthCheck({
        dependencies: {
          broken: async () => {
            throw new Error("Connection timeout");
          },
        },
      });
      const res = await health.readiness();
      expect(res.status).toBe("unhealthy");
      expect(res.dependencies[0]!.status).toBe("unhealthy");
      expect(res.dependencies[0]!.message).toContain("Connection timeout");
    });

    it("should include dependency message when provided", async () => {
      const health = createHealthCheck({
        dependencies: {
          cache: async () => ({ status: "degraded", message: "Replication lag: 2s" }),
        },
      });
      const res = await health.readiness();
      expect(res.dependencies[0]!.message).toBe("Replication lag: 2s");
    });
  });

  // -------------------------------------------------------------------------
  // Dynamic dependency management
  // -------------------------------------------------------------------------

  describe("Dynamic dependencies", () => {
    it("should add a dependency at runtime", async () => {
      const health = createHealthCheck();
      health.addDependency("redis", async () => ({ status: "healthy" }));
      const res = await health.readiness();
      expect(res.dependencies).toHaveLength(1);
      expect(res.dependencies[0]!.name).toBe("redis");
    });

    it("should remove a dependency at runtime", async () => {
      const health = createHealthCheck({
        dependencies: {
          database: async () => ({ status: "healthy" }),
          cache: async () => ({ status: "healthy" }),
        },
      });
      health.removeDependency("cache");
      const res = await health.readiness();
      expect(res.dependencies).toHaveLength(1);
      expect(res.dependencies[0]!.name).toBe("database");
    });

    it("should replace a dependency checker", async () => {
      const health = createHealthCheck({
        dependencies: {
          database: async () => ({ status: "unhealthy" }),
        },
      });
      health.addDependency("database", async () => ({ status: "healthy" }));
      const res = await health.readiness();
      expect(res.status).toBe("healthy");
    });
  });
});
