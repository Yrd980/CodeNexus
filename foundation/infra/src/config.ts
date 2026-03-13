/**
 * foundation/infra — Type-safe config loader
 *
 * Loads configuration from environment variables with schema-based validation,
 * type coercion, defaults, and built-in .env file parsing. Zero dependencies.
 *
 * Design decisions:
 * - Built-in .env parser because dotenv is a trivial parser wrapped in a package.
 * - Schema-first: you declare what you need, the loader validates everything at once
 *   and returns all errors together (not one at a time).
 * - Config is frozen after load — no accidental mutation at runtime.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type {
  ConfigFieldDef,
  ConfigResult,
  ConfigSchema,
  ConfigValidationError,
  ConfigValueType,
} from "./types.js";

// ── .env parser ─────────────────────────────────────────────────────

/**
 * Parse a .env file into a key-value map.
 *
 * Handles:
 * - Comments (lines starting with #)
 * - Empty lines
 * - Quoted values (single and double)
 * - Inline comments (only for unquoted values)
 * - Trimming
 *
 * Does NOT handle:
 * - Variable expansion ($VAR or ${VAR})
 * - Multiline values
 * - Export prefix (`export FOO=bar`)
 *
 * Intentionally minimal — covers 95% of real .env files.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (line === "" || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip inline comments for unquoted values
      const commentIndex = value.indexOf(" #");
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    result[key] = value;
  }

  return result;
}

/**
 * Load a .env file from disk and merge into the given env map.
 * File values do NOT override existing env vars (real env takes precedence).
 */
export function loadEnvFile(
  filePath: string,
  env: Record<string, string | undefined>,
): void {
  const resolved = path.resolve(filePath);
  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch {
    // File doesn't exist — silently skip, like every .env loader
    return;
  }

  const parsed = parseEnvFile(content);
  for (const [key, value] of Object.entries(parsed)) {
    // Real environment takes precedence
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

// ── Type coercion ───────────────────────────────────────────────────

function isConfigFieldDef(value: unknown): value is ConfigFieldDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "env" in value &&
    "type" in value
  );
}

function coerce(
  raw: string,
  type: ConfigValueType,
): { ok: true; value: string | number | boolean } | { ok: false; reason: string } {
  switch (type) {
    case "string":
      return { ok: true, value: raw };

    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        return { ok: false, reason: `"${raw}" is not a valid number` };
      }
      return { ok: true, value: n };
    }

    case "boolean": {
      const lower = raw.toLowerCase();
      if (["true", "1", "yes"].includes(lower)) return { ok: true, value: true };
      if (["false", "0", "no"].includes(lower)) return { ok: true, value: false };
      return { ok: false, reason: `"${raw}" is not a valid boolean (expected true/false/1/0/yes/no)` };
    }

    default:
      return { ok: false, reason: `unknown type "${type as string}"` };
  }
}

// ── Config loader ───────────────────────────────────────────────────

interface LoadConfigOptions {
  /** Environment variables to read from. Defaults to process.env */
  env?: Record<string, string | undefined>;
  /** Path to a .env file to load (values won't override real env vars) */
  envFile?: string;
  /** Prefix for nested path in error messages */
  _prefix?: string;
}

/**
 * Validate a schema against environment variables and collect errors.
 * Returns the built config object and any validation errors.
 */
function validateSchema(
  schema: ConfigSchema,
  env: Record<string, string | undefined>,
  prefix: string,
): { config: ConfigResult; errors: ConfigValidationError[] } {
  const config: ConfigResult = {};
  const errors: ConfigValidationError[] = [];

  for (const [key, def] of Object.entries(schema)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;

    // Nested schema
    if (!isConfigFieldDef(def)) {
      const nested = validateSchema(def as ConfigSchema, env, fieldPath);
      config[key] = nested.config;
      errors.push(...nested.errors);
      continue;
    }

    const raw = env[def.env];

    // Missing value
    if (raw === undefined || raw === "") {
      if (def.default !== undefined) {
        config[key] = def.default;
        continue;
      }
      if (def.required !== false) {
        errors.push({
          field: fieldPath,
          env: def.env,
          message: def.description
            ? `Missing required env var ${def.env} (${def.description})`
            : `Missing required env var ${def.env}`,
        });
      }
      continue;
    }

    // Coerce
    const result = coerce(raw, def.type);
    if (!result.ok) {
      errors.push({
        field: fieldPath,
        env: def.env,
        message: `Invalid value for ${def.env}: ${result.reason}`,
      });
      continue;
    }

    config[key] = result.value;
  }

  return { config, errors };
}

/**
 * Load and validate configuration from environment variables.
 *
 * @param schema - The config schema defining expected variables
 * @param options - Optional: env source, .env file path
 * @returns Frozen config object matching the schema shape
 * @throws Error with all validation errors listed if any field is invalid/missing
 *
 * @example
 * ```ts
 * const config = loadConfig({
 *   port: { env: "PORT", type: "number", default: 3000 },
 *   dbUrl: { env: "DATABASE_URL", type: "string", required: true },
 *   debug: { env: "DEBUG", type: "boolean", default: false },
 * });
 * ```
 */
export function loadConfig(
  schema: ConfigSchema,
  options: LoadConfigOptions = {},
): ConfigResult {
  const env = { ...options.env ?? process.env } as Record<string, string | undefined>;

  // Load .env file if specified (won't override existing env vars)
  if (options.envFile) {
    loadEnvFile(options.envFile, env);
  }

  const { config, errors } = validateSchema(schema, env, options._prefix ?? "");

  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.field} (${e.env}): ${e.message}`)
      .join("\n");
    throw new Error(`Config validation failed:\n${details}`);
  }

  return deepFreeze(config);
}

/** Recursively freeze an object */
function deepFreeze<T extends Record<string, unknown>>(obj: T): T {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
      deepFreeze(value as Record<string, unknown>);
    }
  }
  return obj;
}
