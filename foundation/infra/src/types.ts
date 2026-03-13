/**
 * foundation/infra — Type definitions
 *
 * All types for config loading, environment management, Docker generation,
 * and service discovery.
 */

// ── Config ──────────────────────────────────────────────────────────

/** Supported primitive types for config values */
export type ConfigValueType = "string" | "number" | "boolean";

/** A single config field definition */
export interface ConfigFieldDef {
  /** Environment variable name to read from */
  env: string;
  /** The expected type — value will be coerced */
  type: ConfigValueType;
  /** Whether this field must be present */
  required?: boolean;
  /** Default value if not present in environment */
  default?: string | number | boolean;
  /** Human-readable description for error messages */
  description?: string;
}

/**
 * A config schema maps field names to their definitions.
 * Supports nesting: a field can be another ConfigSchema.
 */
export interface ConfigSchema {
  [key: string]: ConfigFieldDef | ConfigSchema;
}

/** Result of loading a config — a plain object matching the schema shape */
export interface ConfigResult {
  [key: string]: string | number | boolean | ConfigResult | undefined;
}

/** A single validation error */
export interface ConfigValidationError {
  field: string;
  env: string;
  message: string;
}

// ── Environment ─────────────────────────────────────────────────────

/** Known environment names */
export type EnvironmentName = "development" | "staging" | "production" | "test";

/** Per-environment overrides for config values */
export type EnvOverrides = Partial<Record<EnvironmentName, Record<string, string | number | boolean>>>;

/** Feature flag definition — on/off per environment */
export interface FeatureFlags {
  [flagName: string]: Partial<Record<EnvironmentName, boolean>>;
}

// ── Docker ──────────────────────────────────────────────────────────

/** Health check configuration for a container */
export interface HealthCheckConfig {
  /** Command to run inside the container */
  command: string;
  /** Time between checks (e.g. "30s") */
  interval?: string;
  /** Max time for a single check (e.g. "10s") */
  timeout?: string;
  /** How many consecutive failures before unhealthy */
  retries?: number;
  /** Grace period after start before checks begin (e.g. "5s") */
  startPeriod?: string;
}

/** Resource limits for a container */
export interface ResourceLimits {
  /** CPU limit (e.g. "0.5" for half a core) */
  cpus?: string;
  /** Memory limit (e.g. "512m", "1g") */
  memory?: string;
}

/** Configuration for Docker image generation */
export interface DockerConfig {
  /** Base image (e.g. "node:20-slim") */
  baseImage: string;
  /** Working directory inside container */
  workdir?: string;
  /** Ports to expose */
  ports?: number[];
  /** Volume mounts (host:container) */
  volumes?: string[];
  /** Health check */
  healthcheck?: HealthCheckConfig;
  /** Resource limits */
  resources?: ResourceLimits;
  /** Additional labels */
  labels?: Record<string, string>;
  /** The command to run */
  cmd?: string[];
}

/** Supported language targets for Dockerfile generation */
export type DockerLanguage = "node" | "python";

/** Options for Dockerfile generation */
export interface DockerfileOptions {
  language: DockerLanguage;
  /** Node.js version (default: "20") */
  nodeVersion?: string;
  /** Python version (default: "3.12") */
  pythonVersion?: string;
  /** Application port */
  port?: number;
  /** Entry point file (e.g. "dist/index.js" or "app/main.py") */
  entrypoint?: string;
  /** Whether to use multi-stage build (default: true) */
  multiStage?: boolean;
  /** Additional system packages to install */
  systemPackages?: string[];
}

// ── Service Manifest ────────────────────────────────────────────────

/** A service definition in the manifest */
export interface ServiceDefinition {
  /** Unique service name */
  name: string;
  /** Docker image (e.g. "myapp:latest" or "postgres:16") */
  image: string;
  /** Ports to expose (host:container) */
  ports?: Array<{ host: number; container: number }>;
  /** Names of services this service depends on */
  dependencies?: string[];
  /** Health check */
  healthcheck?: HealthCheckConfig;
  /** Environment variables */
  environment?: Record<string, string>;
  /** Volume mounts */
  volumes?: string[];
}

/** A complete service manifest */
export interface ServiceManifest {
  /** Project name */
  project: string;
  /** All services */
  services: ServiceDefinition[];
}
