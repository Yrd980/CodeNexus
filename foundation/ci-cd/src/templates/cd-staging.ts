/**
 * CD Staging Template — Deploy to staging on PR merge
 *
 * Automatically deploys to staging when a PR is merged to main.
 * Includes build step and health check verification.
 */

import { buildPipeline } from "../pipeline-builder.js";
import type { PipelineConfig, Workflow } from "../types.js";

/** Default staging deployment configuration */
const DEFAULT_STAGING_CONFIG: PipelineConfig = {
  name: "Deploy to Staging",
  stages: ["test", "build", "deploy"],
  triggers: {
    push: {
      branches: ["main"],
    },
  },
  packageManager: "npm",
  nodeVersions: ["20"],
  cache: true,
  environment: {
    name: "staging",
    url: "https://staging.example.com",
    secrets: ["DEPLOY_TOKEN", "DATABASE_URL"],
  },
  concurrencyGroup: "staging-deploy",
};

/**
 * Generate a staging CD workflow.
 *
 * Triggers on push to main (i.e., when PRs are merged).
 *
 * @example
 * ```ts
 * const workflow = createStagingCDWorkflow({
 *   environment: {
 *     name: "staging",
 *     url: "https://staging.myapp.com",
 *     secrets: ["FLY_API_TOKEN"],
 *   },
 * });
 * ```
 */
export function createStagingCDWorkflow(overrides?: Partial<PipelineConfig>): Workflow {
  const config: PipelineConfig = {
    ...DEFAULT_STAGING_CONFIG,
    ...overrides,
    triggers: {
      ...DEFAULT_STAGING_CONFIG.triggers,
      ...overrides?.triggers,
    },
    environment: {
      ...DEFAULT_STAGING_CONFIG.environment,
      name: DEFAULT_STAGING_CONFIG.environment?.name ?? "staging",
      ...overrides?.environment,
    },
  };

  return buildPipeline(config);
}
