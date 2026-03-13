/**
 * foundation/ci-cd — GitHub Actions workflows, deployment strategies, release automation
 *
 * @example
 * ```ts
 * import { buildPipeline, createCIWorkflow, prepareRelease, deploy } from "@codenexus/ci-cd";
 * ```
 */

// Types — re-export everything for consumers
export type {
  BranchFilter,
  BumpLevel,
  CacheConfig,
  ChangelogEntry,
  ChangelogSection,
  ConventionalCommitType,
  DeployHook,
  DeploymentConfig,
  DeploymentResult,
  DeploymentStrategy,
  DeployStepResult,
  EnvironmentConfig,
  HealthCheckConfig,
  MatrixConfig,
  PackageManager,
  ParsedCommit,
  PipelineConfig,
  PipelineStage,
  ReleaseConfig,
  ReleaseResult,
  ScheduleTrigger,
  Strategy,
  TriggerConfig,
  TriggerEvent,
  Workflow,
  WorkflowJob,
  WorkflowStep,
} from "./types.js";

// Pipeline Builder
export { buildPipeline, serializeWorkflow } from "./pipeline-builder.js";

// Deployment Strategies
export {
  blueGreenDeploy,
  canaryDeploy,
  deploy,
  rollingDeploy,
  runHealthCheck,
  runHooks,
} from "./deployment.js";

export type { CommandRunner, DeploymentDeps } from "./deployment.js";

// Release Automation
export {
  bumpVersion,
  determineBumpLevel,
  generateChangelog,
  parseCommits,
  parseConventionalCommit,
  parseSemver,
  prepareRelease,
  updatePackageJsonVersion,
  updatePyprojectVersion,
} from "./release.js";

// Templates
export { createCIWorkflow } from "./templates/ci.js";
export { createStagingCDWorkflow } from "./templates/cd-staging.js";
export { createProductionCDWorkflow } from "./templates/cd-production.js";
export { createReleaseWorkflow } from "./templates/release.js";
export type { ReleaseWorkflowConfig } from "./templates/release.js";
