import { describe, expect, it, vi } from "vitest";
import {
  blueGreenDeploy,
  canaryDeploy,
  deploy,
  rollingDeploy,
  runHealthCheck,
  runHooks,
} from "../src/deployment.js";
import type { DeploymentDeps } from "../src/deployment.js";
import type { DeploymentConfig, DeployHook } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<DeploymentDeps>): DeploymentDeps {
  return {
    runCommand: vi.fn().mockResolvedValue({ success: true, output: "ok" }),
    checkHealth: vi.fn().mockResolvedValue(200),
    deployBatch: vi.fn().mockResolvedValue(true),
    deployGreen: vi.fn().mockResolvedValue(true),
    deployCanary: vi.fn().mockResolvedValue(true),
    switchTraffic: vi.fn().mockResolvedValue(true),
    rollback: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createConfig(
  strategy: "rolling" | "blue-green" | "canary",
  overrides?: Partial<DeploymentConfig>,
): DeploymentConfig {
  return {
    strategy,
    environment: { name: "staging" },
    healthCheck: {
      endpoint: "https://staging.example.com/health",
      retries: 1,
      intervalMs: 0,
      timeoutMs: 1000,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

describe("runHealthCheck", () => {
  it("returns true when endpoint responds with expected status", async () => {
    const checkFn = vi.fn().mockResolvedValue(200);
    const result = await runHealthCheck(
      { endpoint: "http://localhost/health", retries: 0 },
      checkFn,
    );
    expect(result).toBe(true);
    expect(checkFn).toHaveBeenCalledOnce();
  });

  it("returns false when endpoint responds with wrong status", async () => {
    const checkFn = vi.fn().mockResolvedValue(500);
    const result = await runHealthCheck(
      { endpoint: "http://localhost/health", retries: 0 },
      checkFn,
    );
    expect(result).toBe(false);
  });

  it("retries on failure and succeeds when health recovers", async () => {
    const checkFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(200);

    const result = await runHealthCheck(
      { endpoint: "http://localhost/health", retries: 1, intervalMs: 0 },
      checkFn,
    );
    expect(result).toBe(true);
    expect(checkFn).toHaveBeenCalledTimes(2);
  });

  it("returns false after exhausting all retries", async () => {
    const checkFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await runHealthCheck(
      { endpoint: "http://localhost/health", retries: 2, intervalMs: 0 },
      checkFn,
    );
    expect(result).toBe(false);
    expect(checkFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("uses custom expected status", async () => {
    const checkFn = vi.fn().mockResolvedValue(204);
    const result = await runHealthCheck(
      { endpoint: "http://localhost/health", expectedStatus: 204, retries: 0 },
      checkFn,
    );
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

describe("runHooks", () => {
  it("runs all hooks in order", async () => {
    const hooks: DeployHook[] = [
      { name: "migrate", command: "npm run migrate", critical: true },
      { name: "seed", command: "npm run seed", critical: false },
    ];
    const runner = vi.fn().mockResolvedValue({ success: true, output: "done" });

    const result = await runHooks(hooks, runner);
    expect(result.aborted).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(runner).toHaveBeenCalledWith("npm run migrate");
    expect(runner).toHaveBeenCalledWith("npm run seed");
  });

  it("aborts on critical hook failure", async () => {
    const hooks: DeployHook[] = [
      { name: "migrate", command: "npm run migrate", critical: true },
      { name: "seed", command: "npm run seed", critical: false },
    ];
    const runner = vi.fn().mockResolvedValue({ success: false, output: "error" });

    const result = await runHooks(hooks, runner);
    expect(result.aborted).toBe(true);
    expect(result.results).toHaveLength(1); // only first hook ran
  });

  it("continues past non-critical hook failure", async () => {
    const hooks: DeployHook[] = [
      { name: "notify", command: "curl webhook", critical: false },
      { name: "cleanup", command: "rm -rf tmp", critical: false },
    ];
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ success: false, output: "webhook down" })
      .mockResolvedValueOnce({ success: true, output: "cleaned" });

    const result = await runHooks(hooks, runner);
    expect(result.aborted).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].success).toBe(false);
    expect(result.results[1].success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rolling Deployment
// ---------------------------------------------------------------------------

describe("rollingDeploy", () => {
  it("deploys in batches with health checks", async () => {
    const deps = createMockDeps();
    const config = createConfig("rolling", { rollingBatchPercent: 50 });

    const result = await rollingDeploy(config, deps);
    expect(result.success).toBe(true);
    expect(result.strategy).toBe("rolling");
    expect(result.rolledBack).toBe(false);
    expect(deps.deployBatch).toHaveBeenCalledTimes(2);
    expect(deps.checkHealth).toHaveBeenCalledTimes(2);
  });

  it("rolls back when health check fails", async () => {
    const deps = createMockDeps({
      checkHealth: vi
        .fn()
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(500),
    });
    const config = createConfig("rolling", { rollingBatchPercent: 50 });

    const result = await rollingDeploy(config, deps);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(deps.rollback).toHaveBeenCalledOnce();
  });

  it("rolls back when batch deploy fails", async () => {
    const deps = createMockDeps({
      deployBatch: vi.fn().mockResolvedValue(false),
    });
    const config = createConfig("rolling");

    const result = await rollingDeploy(config, deps);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
  });

  it("runs pre-deploy hooks before deployment", async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps({
      runCommand: vi.fn().mockImplementation(async () => {
        callOrder.push("hook");
        return { success: true, output: "ok" };
      }),
      deployBatch: vi.fn().mockImplementation(async () => {
        callOrder.push("deploy");
        return true;
      }),
    });

    const config = createConfig("rolling", {
      preDeployHooks: [{ name: "migrate", command: "migrate", critical: true }],
      rollingBatchPercent: 100,
    });

    await rollingDeploy(config, deps);
    expect(callOrder[0]).toBe("hook");
    expect(callOrder[1]).toBe("deploy");
  });
});

// ---------------------------------------------------------------------------
// Blue-Green Deployment
// ---------------------------------------------------------------------------

describe("blueGreenDeploy", () => {
  it("deploys green, health checks, and switches traffic", async () => {
    const deps = createMockDeps();
    const config = createConfig("blue-green");

    const result = await blueGreenDeploy(config, deps);
    expect(result.success).toBe(true);
    expect(result.strategy).toBe("blue-green");
    expect(deps.deployGreen).toHaveBeenCalledOnce();
    expect(deps.checkHealth).toHaveBeenCalledOnce();
    expect(deps.switchTraffic).toHaveBeenCalledWith(100);
  });

  it("rolls back when green health check fails", async () => {
    const deps = createMockDeps({
      checkHealth: vi.fn().mockResolvedValue(500),
    });
    const config = createConfig("blue-green");

    const result = await blueGreenDeploy(config, deps);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(deps.rollback).toHaveBeenCalledOnce();
  });

  it("rolls back when traffic switch fails", async () => {
    const deps = createMockDeps({
      switchTraffic: vi.fn().mockResolvedValue(false),
    });
    const config = createConfig("blue-green");

    const result = await blueGreenDeploy(config, deps);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
  });

  it("does not deploy if green deployment fails", async () => {
    const deps = createMockDeps({
      deployGreen: vi.fn().mockResolvedValue(false),
    });
    const config = createConfig("blue-green");

    const result = await blueGreenDeploy(config, deps);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(deps.switchTraffic).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Canary Deployment
// ---------------------------------------------------------------------------

describe("canaryDeploy", () => {
  it("deploys canary and shifts traffic through steps", async () => {
    const deps = createMockDeps();
    const config = createConfig("canary", {
      canarySteps: [10, 50, 100],
    });

    const result = await canaryDeploy(config, deps);
    expect(result.success).toBe(true);
    expect(result.strategy).toBe("canary");
    expect(deps.deployCanary).toHaveBeenCalledOnce();
    expect(deps.switchTraffic).toHaveBeenCalledTimes(3);
    expect(deps.checkHealth).toHaveBeenCalledTimes(3);
  });

  it("rolls back at the failing canary step", async () => {
    const deps = createMockDeps({
      checkHealth: vi
        .fn()
        .mockResolvedValueOnce(200) // 10% ok
        .mockResolvedValueOnce(500), // 50% fails
    });
    const config = createConfig("canary", {
      canarySteps: [10, 50, 100],
    });

    const result = await canaryDeploy(config, deps);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(deps.switchTraffic).toHaveBeenCalledTimes(2);
  });

  it("uses default canary steps when none specified", async () => {
    const deps = createMockDeps();
    const config = createConfig("canary");

    const result = await canaryDeploy(config, deps);
    expect(result.success).toBe(true);
    // Default steps: [10, 25, 50, 100]
    expect(deps.switchTraffic).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// Deploy dispatcher
// ---------------------------------------------------------------------------

describe("deploy", () => {
  it("dispatches to rolling strategy", async () => {
    const deps = createMockDeps();
    const config = createConfig("rolling", { rollingBatchPercent: 100 });

    const result = await deploy(config, deps);
    expect(result.strategy).toBe("rolling");
    expect(deps.deployBatch).toHaveBeenCalled();
  });

  it("dispatches to blue-green strategy", async () => {
    const deps = createMockDeps();
    const config = createConfig("blue-green");

    const result = await deploy(config, deps);
    expect(result.strategy).toBe("blue-green");
    expect(deps.deployGreen).toHaveBeenCalled();
  });

  it("dispatches to canary strategy", async () => {
    const deps = createMockDeps();
    const config = createConfig("canary", { canarySteps: [100] });

    const result = await deploy(config, deps);
    expect(result.strategy).toBe("canary");
    expect(deps.deployCanary).toHaveBeenCalled();
  });
});
