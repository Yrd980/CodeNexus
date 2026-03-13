/**
 * foundation/infra — Environment management
 *
 * Detects the current environment, provides helpers, and supports
 * per-environment config overrides and feature flags.
 *
 * Design decisions:
 * - NODE_ENV is the single source of truth. We don't invent a new env var.
 * - Only four environments: development, staging, production, test.
 *   If you need more, your infrastructure is too complex for a startup.
 * - Feature flags are static per-environment, not a runtime toggle system.
 *   For runtime flags, use a proper feature flag service.
 */

import type { EnvironmentName, EnvOverrides, FeatureFlags } from "./types.js";

const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "development",
  "staging",
  "production",
  "test",
]);

/**
 * Detect the current environment from NODE_ENV.
 * Defaults to "development" if not set or unrecognized.
 */
export function getEnvironment(
  env?: Record<string, string | undefined>,
): EnvironmentName {
  const source = env ?? process.env;
  const raw = source.NODE_ENV?.toLowerCase().trim() ?? "";

  if (VALID_ENVIRONMENTS.has(raw)) {
    return raw as EnvironmentName;
  }

  return "development";
}

/** Check if current environment is development */
export function isDev(env?: Record<string, string | undefined>): boolean {
  return getEnvironment(env) === "development";
}

/** Check if current environment is production */
export function isProd(env?: Record<string, string | undefined>): boolean {
  return getEnvironment(env) === "production";
}

/** Check if current environment is test */
export function isTest(env?: Record<string, string | undefined>): boolean {
  return getEnvironment(env) === "test";
}

/** Check if current environment is staging */
export function isStaging(env?: Record<string, string | undefined>): boolean {
  return getEnvironment(env) === "staging";
}

/**
 * Apply environment-specific overrides to a base config.
 *
 * @param base - The base config values
 * @param overrides - Per-environment override maps
 * @param env - Optional env source for environment detection
 * @returns Merged config with overrides applied (shallow merge)
 *
 * @example
 * ```ts
 * const config = applyEnvOverrides(
 *   { logLevel: "info", debug: false },
 *   {
 *     development: { logLevel: "debug", debug: true },
 *     production: { logLevel: "warn" },
 *   },
 * );
 * ```
 */
export function applyEnvOverrides<T extends Record<string, string | number | boolean>>(
  base: T,
  overrides: EnvOverrides,
  env?: Record<string, string | undefined>,
): T {
  const current = getEnvironment(env);
  const envSpecific = overrides[current];

  if (!envSpecific) {
    return { ...base };
  }

  return { ...base, ...envSpecific } as T;
}

/**
 * Evaluate feature flags for the current environment.
 *
 * @param flags - Feature flag definitions with per-env boolean values
 * @param env - Optional env source for environment detection
 * @returns Map of flag names to their resolved boolean values (false if not defined for current env)
 *
 * @example
 * ```ts
 * const flags = resolveFeatureFlags({
 *   newCheckout: { development: true, staging: true, production: false },
 *   betaApi: { development: true, production: false },
 * });
 * // flags.newCheckout === true (in development)
 * ```
 */
export function resolveFeatureFlags(
  flags: FeatureFlags,
  env?: Record<string, string | undefined>,
): Record<string, boolean> {
  const current = getEnvironment(env);
  const result: Record<string, boolean> = {};

  for (const [name, envMap] of Object.entries(flags)) {
    result[name] = envMap[current] ?? false;
  }

  return result;
}
