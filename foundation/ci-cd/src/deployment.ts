/**
 * Deployment Strategy Patterns
 *
 * Implements three deployment strategies as executable patterns:
 * - Rolling: gradual replacement with health checks
 * - Blue-Green: instant switch with rollback
 * - Canary: percentage-based traffic shifting
 *
 * These are not tied to a specific platform — they model the *logic*
 * of each strategy so you can adapt them to Fly.io, Vercel, K8s, etc.
 */

import type {
  DeployHook,
  DeploymentConfig,
  DeploymentResult,
  DeployStepResult,
  HealthCheckConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/**
 * Run a health check against a deployment endpoint.
 *
 * Retries up to `config.retries` times with `config.intervalMs` delay.
 * Returns true if the endpoint responds with `config.expectedStatus`.
 *
 * @param config - Health check configuration
 * @param checkFn - Optional custom check function (for testing / DI)
 */
export async function runHealthCheck(
  config: HealthCheckConfig,
  checkFn?: (url: string, timeoutMs: number) => Promise<number>,
): Promise<boolean> {
  const retries = config.retries ?? 3;
  const interval = config.intervalMs ?? 2000;
  const timeout = config.timeoutMs ?? 5000;
  const expected = config.expectedStatus ?? 200;

  const doCheck =
    checkFn ??
    (async (url: string, timeoutMs: number): Promise<number> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        return res.status;
      } finally {
        clearTimeout(timer);
      }
    });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const status = await doCheck(config.endpoint, timeout);
      if (status === expected) {
        return true;
      }
    } catch {
      // Connection refused, timeout, etc. — retry
    }

    if (attempt < retries) {
      await delay(interval);
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Hook Runner
// ---------------------------------------------------------------------------

export type CommandRunner = (command: string) => Promise<{ success: boolean; output: string }>;

/**
 * Execute deployment hooks in order.
 *
 * If a critical hook fails, execution stops and returns the results so far.
 */
export async function runHooks(
  hooks: DeployHook[],
  runner: CommandRunner,
): Promise<{ results: DeployStepResult[]; aborted: boolean }> {
  const results: DeployStepResult[] = [];
  let aborted = false;

  for (const hook of hooks) {
    const start = Date.now();
    const result = await runner(hook.command);
    const duration = Date.now() - start;

    results.push({
      step: `hook:${hook.name}`,
      success: result.success,
      message: result.success ? result.output : `Hook failed: ${result.output}`,
      durationMs: duration,
    });

    if (!result.success && hook.critical) {
      aborted = true;
      break;
    }
  }

  return { results, aborted };
}

// ---------------------------------------------------------------------------
// Rolling Deployment
// ---------------------------------------------------------------------------

/**
 * Rolling deployment: replace instances in batches.
 *
 * Flow:
 * 1. Run pre-deploy hooks
 * 2. For each batch (determined by rollingBatchPercent):
 *    a. Replace batch of instances
 *    b. Run health check
 *    c. If unhealthy, rollback and abort
 * 3. Run post-deploy hooks
 */
export async function rollingDeploy(
  config: DeploymentConfig,
  deps: DeploymentDeps,
): Promise<DeploymentResult> {
  const start = Date.now();
  const steps: DeployStepResult[] = [];
  let rolledBack = false;

  // Pre-deploy hooks
  if (config.preDeployHooks && config.preDeployHooks.length > 0) {
    const hookResult = await runHooks(config.preDeployHooks, deps.runCommand);
    steps.push(...hookResult.results);
    if (hookResult.aborted) {
      return makeResult("rolling", false, steps, false, start);
    }
  }

  const batchPercent = config.rollingBatchPercent ?? 25;
  const batches = Math.ceil(100 / batchPercent);

  for (let i = 0; i < batches; i++) {
    const batchNum = i + 1;
    const percent = Math.min(batchPercent * batchNum, 100);

    // Deploy batch
    const deployStart = Date.now();
    const deployResult = await deps.deployBatch(percent);
    steps.push({
      step: `rolling:batch-${batchNum}`,
      success: deployResult,
      message: deployResult
        ? `Deployed batch ${batchNum}/${batches} (${percent}%)`
        : `Failed to deploy batch ${batchNum}`,
      durationMs: Date.now() - deployStart,
    });

    if (!deployResult) {
      await deps.rollback();
      rolledBack = true;
      steps.push({
        step: "rolling:rollback",
        success: true,
        message: `Rolled back after batch ${batchNum} failure`,
      });
      return makeResult("rolling", false, steps, rolledBack, start);
    }

    // Health check after each batch
    const healthy = await runHealthCheck(config.healthCheck, deps.checkHealth);
    steps.push({
      step: `rolling:health-check-${batchNum}`,
      success: healthy,
      message: healthy
        ? `Health check passed after batch ${batchNum}`
        : `Health check failed after batch ${batchNum}`,
    });

    if (!healthy) {
      await deps.rollback();
      rolledBack = true;
      steps.push({
        step: "rolling:rollback",
        success: true,
        message: `Rolled back after health check failure at batch ${batchNum}`,
      });
      return makeResult("rolling", false, steps, rolledBack, start);
    }
  }

  // Post-deploy hooks
  if (config.postDeployHooks && config.postDeployHooks.length > 0) {
    const hookResult = await runHooks(config.postDeployHooks, deps.runCommand);
    steps.push(...hookResult.results);
  }

  return makeResult("rolling", true, steps, rolledBack, start);
}

// ---------------------------------------------------------------------------
// Blue-Green Deployment
// ---------------------------------------------------------------------------

/**
 * Blue-green deployment: deploy to inactive slot, switch traffic.
 *
 * Flow:
 * 1. Run pre-deploy hooks
 * 2. Deploy to "green" (inactive) environment
 * 3. Health check green
 * 4. Switch traffic from blue to green
 * 5. Optionally tear down old blue
 * 6. Run post-deploy hooks
 *
 * On failure at any stage, switch back to blue.
 */
export async function blueGreenDeploy(
  config: DeploymentConfig,
  deps: DeploymentDeps,
): Promise<DeploymentResult> {
  const start = Date.now();
  const steps: DeployStepResult[] = [];
  let rolledBack = false;

  // Pre-deploy hooks
  if (config.preDeployHooks && config.preDeployHooks.length > 0) {
    const hookResult = await runHooks(config.preDeployHooks, deps.runCommand);
    steps.push(...hookResult.results);
    if (hookResult.aborted) {
      return makeResult("blue-green", false, steps, false, start);
    }
  }

  // Deploy to green
  const greenStart = Date.now();
  const greenDeployed = await deps.deployGreen();
  steps.push({
    step: "blue-green:deploy-green",
    success: greenDeployed,
    message: greenDeployed ? "Deployed to green environment" : "Failed to deploy to green",
    durationMs: Date.now() - greenStart,
  });

  if (!greenDeployed) {
    return makeResult("blue-green", false, steps, false, start);
  }

  // Health check green
  const healthy = await runHealthCheck(config.healthCheck, deps.checkHealth);
  steps.push({
    step: "blue-green:health-check-green",
    success: healthy,
    message: healthy
      ? "Green environment health check passed"
      : "Green environment health check failed",
  });

  if (!healthy) {
    await deps.rollback();
    rolledBack = true;
    steps.push({
      step: "blue-green:rollback",
      success: true,
      message: "Rolled back: tore down unhealthy green",
    });
    return makeResult("blue-green", false, steps, rolledBack, start);
  }

  // Switch traffic
  const switched = await deps.switchTraffic(100);
  steps.push({
    step: "blue-green:switch-traffic",
    success: switched,
    message: switched ? "Traffic switched to green" : "Failed to switch traffic",
  });

  if (!switched) {
    await deps.rollback();
    rolledBack = true;
    steps.push({
      step: "blue-green:rollback",
      success: true,
      message: "Rolled back: reverted traffic to blue",
    });
    return makeResult("blue-green", false, steps, rolledBack, start);
  }

  // Optionally keep old environment
  if (!config.keepOldEnvironment) {
    steps.push({
      step: "blue-green:teardown-old",
      success: true,
      message: "Old blue environment scheduled for teardown",
    });
  }

  // Post-deploy hooks
  if (config.postDeployHooks && config.postDeployHooks.length > 0) {
    const hookResult = await runHooks(config.postDeployHooks, deps.runCommand);
    steps.push(...hookResult.results);
  }

  return makeResult("blue-green", true, steps, rolledBack, start);
}

// ---------------------------------------------------------------------------
// Canary Deployment
// ---------------------------------------------------------------------------

/**
 * Canary deployment: gradually shift traffic with health checks at each step.
 *
 * Flow:
 * 1. Run pre-deploy hooks
 * 2. Deploy canary instance
 * 3. For each step in canarySteps (e.g. [10, 25, 50, 100]):
 *    a. Shift X% of traffic to canary
 *    b. Health check
 *    c. If unhealthy, rollback
 * 4. Run post-deploy hooks
 */
export async function canaryDeploy(
  config: DeploymentConfig,
  deps: DeploymentDeps,
): Promise<DeploymentResult> {
  const start = Date.now();
  const steps: DeployStepResult[] = [];
  let rolledBack = false;

  const canarySteps = config.canarySteps ?? [10, 25, 50, 100];

  // Pre-deploy hooks
  if (config.preDeployHooks && config.preDeployHooks.length > 0) {
    const hookResult = await runHooks(config.preDeployHooks, deps.runCommand);
    steps.push(...hookResult.results);
    if (hookResult.aborted) {
      return makeResult("canary", false, steps, false, start);
    }
  }

  // Deploy canary
  const canaryStart = Date.now();
  const canaryDeployed = await deps.deployCanary();
  steps.push({
    step: "canary:deploy",
    success: canaryDeployed,
    message: canaryDeployed ? "Canary instance deployed" : "Failed to deploy canary",
    durationMs: Date.now() - canaryStart,
  });

  if (!canaryDeployed) {
    return makeResult("canary", false, steps, false, start);
  }

  // Gradually shift traffic
  for (const percent of canarySteps) {
    const shifted = await deps.switchTraffic(percent);
    steps.push({
      step: `canary:traffic-${percent}`,
      success: shifted,
      message: shifted
        ? `Traffic shifted to ${percent}%`
        : `Failed to shift traffic to ${percent}%`,
    });

    if (!shifted) {
      await deps.rollback();
      rolledBack = true;
      steps.push({
        step: "canary:rollback",
        success: true,
        message: `Rolled back after traffic shift failure at ${percent}%`,
      });
      return makeResult("canary", false, steps, rolledBack, start);
    }

    // Health check at each step
    const healthy = await runHealthCheck(config.healthCheck, deps.checkHealth);
    steps.push({
      step: `canary:health-check-${percent}`,
      success: healthy,
      message: healthy
        ? `Health check passed at ${percent}% traffic`
        : `Health check failed at ${percent}% traffic`,
    });

    if (!healthy) {
      await deps.rollback();
      rolledBack = true;
      steps.push({
        step: "canary:rollback",
        success: true,
        message: `Rolled back after health check failure at ${percent}% traffic`,
      });
      return makeResult("canary", false, steps, rolledBack, start);
    }
  }

  // Post-deploy hooks
  if (config.postDeployHooks && config.postDeployHooks.length > 0) {
    const hookResult = await runHooks(config.postDeployHooks, deps.runCommand);
    steps.push(...hookResult.results);
  }

  return makeResult("canary", true, steps, rolledBack, start);
}

// ---------------------------------------------------------------------------
// Dependency Injection Interface
// ---------------------------------------------------------------------------

/**
 * Platform-specific operations injected into deployment strategies.
 *
 * Implement this interface to connect the deployment logic to your
 * actual infrastructure (Fly.io, Vercel, K8s, bare metal, etc.).
 */
export interface DeploymentDeps {
  /** Run a shell command (for hooks) */
  runCommand: CommandRunner;

  /** Check health of a URL — returns HTTP status code */
  checkHealth?: (url: string, timeoutMs: number) => Promise<number>;

  // Rolling deployment
  /** Deploy a batch — percent is cumulative (25, 50, 75, 100) */
  deployBatch: (percent: number) => Promise<boolean>;

  // Blue-green deployment
  /** Deploy to the green (inactive) environment */
  deployGreen: () => Promise<boolean>;

  // Canary deployment
  /** Deploy the canary instance */
  deployCanary: () => Promise<boolean>;

  /** Switch traffic percentage (0-100) to new deployment */
  switchTraffic: (percent: number) => Promise<boolean>;

  /** Rollback to the previous stable state */
  rollback: () => Promise<void>;
}

/**
 * Execute a deployment using the specified strategy.
 *
 * This is the main entry point — it dispatches to the appropriate
 * strategy implementation based on `config.strategy`.
 */
export async function deploy(
  config: DeploymentConfig,
  deps: DeploymentDeps,
): Promise<DeploymentResult> {
  switch (config.strategy) {
    case "rolling":
      return rollingDeploy(config, deps);
    case "blue-green":
      return blueGreenDeploy(config, deps);
    case "canary":
      return canaryDeploy(config, deps);
    default: {
      const _exhaustive: never = config.strategy;
      throw new Error(`Unknown deployment strategy: ${_exhaustive}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

import type { DeploymentStrategy } from "./types.js";

function makeResult(
  strategy: DeploymentStrategy,
  success: boolean,
  steps: DeployStepResult[],
  rolledBack: boolean,
  startTime: number,
): DeploymentResult {
  return {
    strategy,
    success,
    steps,
    rolledBack,
    totalDurationMs: Date.now() - startTime,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
