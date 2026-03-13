/**
 * CI/CD Pipeline Type Definitions
 *
 * Type-safe definitions for GitHub Actions workflows, deployment strategies,
 * and release automation. These types drive the pipeline builder and ensure
 * generated YAML is always valid.
 */

// ---------------------------------------------------------------------------
// GitHub Actions Workflow Types
// ---------------------------------------------------------------------------

/** Events that can trigger a workflow */
export type TriggerEvent =
  | "push"
  | "pull_request"
  | "workflow_dispatch"
  | "schedule"
  | "release";

/** Branch filter for push/PR triggers */
export interface BranchFilter {
  branches: string[];
  paths?: string[];
  "paths-ignore"?: string[];
}

/** Cron schedule trigger */
export interface ScheduleTrigger {
  cron: string;
}

/** Trigger configuration — maps event names to their filters */
export type TriggerConfig = {
  push?: BranchFilter;
  pull_request?: BranchFilter;
  workflow_dispatch?: Record<string, unknown>;
  schedule?: ScheduleTrigger[];
  release?: { types: string[] };
};

/** A single step in a job */
export interface WorkflowStep {
  name: string;
  uses?: string;
  run?: string;
  with?: Record<string, string | number | boolean>;
  env?: Record<string, string>;
  if?: string;
  id?: string;
}

/** Matrix strategy for a job */
export interface MatrixConfig {
  [key: string]: (string | number)[];
}

export interface Strategy {
  matrix: MatrixConfig;
  "fail-fast"?: boolean;
}

/** Cache configuration */
export interface CacheConfig {
  path: string;
  key: string;
  "restore-keys"?: string;
}

/** A job within a workflow */
export interface WorkflowJob {
  name: string;
  "runs-on": string;
  needs?: string[];
  if?: string;
  strategy?: Strategy;
  environment?: string | { name: string; url?: string };
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress"?: boolean };
  steps: WorkflowStep[];
}

/** Complete GitHub Actions workflow */
export interface Workflow {
  name: string;
  on: TriggerConfig;
  env?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress"?: boolean };
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

// ---------------------------------------------------------------------------
// Pipeline Config (high-level abstraction)
// ---------------------------------------------------------------------------

/** Stages in a CI/CD pipeline */
export type PipelineStage = "lint" | "test" | "build" | "deploy" | "release";

/** Package manager for caching */
export type PackageManager = "npm" | "pnpm" | "yarn" | "pip" | "poetry";

/** Pipeline configuration — the high-level input to the builder */
export interface PipelineConfig {
  /** Human-readable pipeline name */
  name: string;

  /** Which stages to include */
  stages: PipelineStage[];

  /** Trigger configuration */
  triggers: TriggerConfig;

  /** Node version(s) for matrix builds */
  nodeVersions?: string[];

  /** Operating system(s) for matrix builds */
  os?: string[];

  /** Package manager (affects caching and install commands) */
  packageManager?: PackageManager;

  /** Environment variables available to all jobs */
  env?: Record<string, string>;

  /** Deployment target environment */
  environment?: EnvironmentConfig;

  /** Whether to enable caching */
  cache?: boolean;

  /** Custom lint command (default: "npm run lint") */
  lintCommand?: string;

  /** Custom test command (default: "npm run test") */
  testCommand?: string;

  /** Custom build command (default: "npm run build") */
  buildCommand?: string;

  /** Upload coverage report */
  coverage?: boolean;

  /** Concurrency group to prevent duplicate runs */
  concurrencyGroup?: string;
}

// ---------------------------------------------------------------------------
// Deployment Types
// ---------------------------------------------------------------------------

/** Deployment strategy type */
export type DeploymentStrategy = "rolling" | "blue-green" | "canary";

/** Health check configuration */
export interface HealthCheckConfig {
  /** URL or endpoint to check */
  endpoint: string;

  /** Expected HTTP status code */
  expectedStatus?: number;

  /** Timeout per check in milliseconds */
  timeoutMs?: number;

  /** Number of retries before failure */
  retries?: number;

  /** Interval between retries in milliseconds */
  intervalMs?: number;
}

/** Deployment hook — runs before or after deployment */
export interface DeployHook {
  name: string;
  command: string;
  /** Whether failure of this hook should abort the deployment */
  critical: boolean;
}

/** Result of a single deployment step */
export interface DeployStepResult {
  step: string;
  success: boolean;
  message: string;
  durationMs?: number;
}

/** Overall deployment result */
export interface DeploymentResult {
  strategy: DeploymentStrategy;
  success: boolean;
  steps: DeployStepResult[];
  rolledBack: boolean;
  totalDurationMs: number;
}

/** Deployment configuration */
export interface DeploymentConfig {
  /** Strategy to use */
  strategy: DeploymentStrategy;

  /** Target environment */
  environment: EnvironmentConfig;

  /** Health check configuration */
  healthCheck: HealthCheckConfig;

  /** Hooks to run before deployment */
  preDeployHooks?: DeployHook[];

  /** Hooks to run after deployment */
  postDeployHooks?: DeployHook[];

  /** Canary-specific: traffic percentage steps (e.g. [10, 25, 50, 100]) */
  canarySteps?: number[];

  /** Blue-green-specific: whether to keep the old environment alive after switch */
  keepOldEnvironment?: boolean;

  /** Rolling-specific: batch size as percentage (e.g. 25 means 25% at a time) */
  rollingBatchPercent?: number;
}

// ---------------------------------------------------------------------------
// Environment Types
// ---------------------------------------------------------------------------

/** Environment configuration */
export interface EnvironmentConfig {
  /** Environment name (staging, production, etc.) */
  name: string;

  /** Environment URL */
  url?: string;

  /** Required secrets (names only — values come from GitHub Secrets) */
  secrets?: string[];

  /** Whether manual approval is required before deploying */
  requiresApproval?: boolean;

  /** GitHub usernames who can approve */
  approvers?: string[];
}

// ---------------------------------------------------------------------------
// Release Types
// ---------------------------------------------------------------------------

/** Conventional commit type */
export type ConventionalCommitType =
  | "feat"
  | "fix"
  | "docs"
  | "style"
  | "refactor"
  | "perf"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "revert";

/** Parsed conventional commit */
export interface ParsedCommit {
  type: ConventionalCommitType;
  scope?: string;
  description: string;
  body?: string;
  breaking: boolean;
  raw: string;
}

/** Semantic version bump level */
export type BumpLevel = "major" | "minor" | "patch";

/** A single changelog entry */
export interface ChangelogEntry {
  type: ConventionalCommitType;
  scope?: string;
  description: string;
  breaking: boolean;
}

/** Grouped changelog for a version */
export interface ChangelogSection {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}

/** Release configuration */
export interface ReleaseConfig {
  /** Current version (semver string) */
  currentVersion: string;

  /** Whether to generate a changelog */
  changelog?: boolean;

  /** Whether to create a git tag */
  createTag?: boolean;

  /** Tag prefix (default: "v") */
  tagPrefix?: string;

  /** Files to update with new version (e.g. package.json, pyproject.toml) */
  versionFiles?: string[];

  /** Whether breaking changes in feat commits trigger major bumps */
  respectBreakingChanges?: boolean;
}

/** Result of the release process */
export interface ReleaseResult {
  previousVersion: string;
  newVersion: string;
  bumpLevel: BumpLevel;
  changelog: string;
  tag: string;
  commits: ParsedCommit[];
}
