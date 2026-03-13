/**
 * CD Production Template — Deploy to production with approval gate
 *
 * Deploys to production when a release is published on GitHub.
 * Requires manual approval via GitHub Environments protection rules.
 */

import { buildPipeline } from "../pipeline-builder.js";
import type { PipelineConfig, Workflow } from "../types.js";

/** Default production deployment configuration */
const DEFAULT_PRODUCTION_CONFIG: PipelineConfig = {
  name: "Deploy to Production",
  stages: ["test", "build", "deploy"],
  triggers: {
    release: {
      types: ["published"],
    },
  },
  packageManager: "npm",
  nodeVersions: ["20"],
  cache: true,
  environment: {
    name: "production",
    url: "https://example.com",
    secrets: ["DEPLOY_TOKEN", "DATABASE_URL", "SENTRY_DSN"],
    requiresApproval: true,
  },
  concurrencyGroup: "production-deploy",
};

/**
 * Generate a production CD workflow with approval gate.
 *
 * Triggers on GitHub release published event. The deploy job
 * uses a GitHub Environment with protection rules (manual approval).
 *
 * @example
 * ```ts
 * const workflow = createProductionCDWorkflow({
 *   environment: {
 *     name: "production",
 *     url: "https://myapp.com",
 *     requiresApproval: true,
 *     approvers: ["cto", "lead-dev"],
 *   },
 * });
 * ```
 */
export function createProductionCDWorkflow(overrides?: Partial<PipelineConfig>): Workflow {
  const config: PipelineConfig = {
    ...DEFAULT_PRODUCTION_CONFIG,
    ...overrides,
    triggers: {
      ...DEFAULT_PRODUCTION_CONFIG.triggers,
      ...overrides?.triggers,
    },
    environment: {
      ...DEFAULT_PRODUCTION_CONFIG.environment,
      name: DEFAULT_PRODUCTION_CONFIG.environment?.name ?? "production",
      ...overrides?.environment,
    },
  };

  return buildPipeline(config);
}
