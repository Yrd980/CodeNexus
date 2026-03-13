/**
 * CI Template — Standard continuous integration pipeline
 *
 * Generates a GitHub Actions workflow with: lint, test, build, coverage.
 * Designed for TypeScript/Node.js projects but configurable for Python.
 */

import { buildPipeline } from "../pipeline-builder.js";
import type { PipelineConfig, Workflow } from "../types.js";

/** Default CI pipeline configuration */
const DEFAULT_CI_CONFIG: PipelineConfig = {
  name: "CI",
  stages: ["lint", "test", "build"],
  triggers: {
    push: {
      branches: ["main"],
    },
    pull_request: {
      branches: ["main"],
    },
  },
  packageManager: "npm",
  nodeVersions: ["20"],
  cache: true,
  coverage: true,
  concurrencyGroup: "ci-${{ github.ref }}",
};

/**
 * Generate a CI workflow with sensible defaults.
 *
 * Override any config option to customize.
 *
 * @example
 * ```ts
 * const workflow = createCIWorkflow({
 *   packageManager: "pnpm",
 *   nodeVersions: ["18", "20", "22"],
 * });
 * ```
 */
export function createCIWorkflow(overrides?: Partial<PipelineConfig>): Workflow {
  const config: PipelineConfig = {
    ...DEFAULT_CI_CONFIG,
    ...overrides,
    triggers: {
      ...DEFAULT_CI_CONFIG.triggers,
      ...overrides?.triggers,
    },
  };

  return buildPipeline(config);
}
