/**
 * foundation/infra — Public API
 *
 * Infrastructure-as-code patterns: config loading, environment management,
 * Docker generation, and service discovery.
 */

// Types
export type {
  ConfigFieldDef,
  ConfigResult,
  ConfigSchema,
  ConfigValidationError,
  ConfigValueType,
  DockerConfig,
  DockerfileOptions,
  DockerLanguage,
  EnvironmentName,
  EnvOverrides,
  FeatureFlags,
  HealthCheckConfig,
  ResourceLimits,
  ServiceDefinition,
  ServiceManifest,
} from "./types.js";

// Config
export { loadConfig, loadEnvFile, parseEnvFile } from "./config.js";

// Environment
export {
  applyEnvOverrides,
  getEnvironment,
  isDev,
  isProd,
  isStaging,
  isTest,
  resolveFeatureFlags,
} from "./env.js";

// Docker
export { generateCompose, generateDockerfile } from "./docker.js";

// Service Manifest
export {
  createManifest,
  getDependencyGraph,
  getStartOrder,
  getTransitiveDependencies,
} from "./service-manifest.js";
