/**
 * Configuration management — file discovery, read/write, env-var overrides.
 *
 * Config files live at `~/.config/<appName>/config.json` following the XDG
 * Base Directory Specification. Environment variables override file values
 * using the pattern `<APP_NAME>_<KEY>` (uppercased, dots become underscores).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A flat-ish config record. Nested objects are allowed but env-var overrides
 *  only target top-level keys. */
export type ConfigValue = string | number | boolean | null | ConfigRecord;
export type ConfigRecord = { [key: string]: ConfigValue };

export interface ConfigSchema {
  /** Default values for every key */
  defaults: ConfigRecord;
  /** Optional validation — return an error string or undefined */
  validate?: (config: ConfigRecord) => string | undefined;
}

export interface ConfigOptions {
  /** Application name — used to derive the config directory */
  appName: string;
  /** Schema with defaults and optional validation */
  schema: ConfigSchema;
  /** Override the config directory (useful for testing) */
  configDir?: string;
  /** Config file name (default: "config.json") */
  fileName?: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getConfigDir(appName: string): string {
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  const base = xdgConfig ?? join(homedir(), ".config");
  return join(base, appName);
}

export function getConfigPath(appName: string, fileName: string): string {
  return join(getConfigDir(appName), fileName);
}

// ---------------------------------------------------------------------------
// Config manager
// ---------------------------------------------------------------------------

export interface ConfigManager {
  /** Full path to the config file */
  readonly path: string;
  /** Read the current merged config (defaults < file < env) */
  read(): ConfigRecord;
  /** Write a partial config to the file (merges with existing) */
  write(partial: ConfigRecord): void;
  /** Get a single value */
  get<T extends ConfigValue = ConfigValue>(key: string): T | undefined;
  /** Set a single value and persist */
  set(key: string, value: ConfigValue): void;
  /** Reset to defaults (deletes config file content, keeps file) */
  reset(): void;
}

export function createConfig(opts: ConfigOptions): ConfigManager {
  const dir = opts.configDir ?? getConfigDir(opts.appName);
  const fileName = opts.fileName ?? "config.json";
  const filePath = join(dir, fileName);

  function readFile(): ConfigRecord {
    if (!existsSync(filePath)) return {};
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as ConfigRecord;
    } catch {
      return {};
    }
  }

  function writeFile(data: ConfigRecord): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  /** Read env-var overrides: APP_NAME_KEY → key */
  function readEnvOverrides(): ConfigRecord {
    const prefix = opts.appName.toUpperCase().replace(/-/g, "_") + "_";
    const overrides: ConfigRecord = {};
    for (const [envKey, envVal] of Object.entries(process.env)) {
      if (envKey.startsWith(prefix) && envVal !== undefined) {
        const configKey = envKey.slice(prefix.length).toLowerCase();
        // Attempt to coerce to number/boolean
        if (envVal === "true") {
          overrides[configKey] = true;
        } else if (envVal === "false") {
          overrides[configKey] = false;
        } else if (envVal !== "" && !Number.isNaN(Number(envVal))) {
          overrides[configKey] = Number(envVal);
        } else {
          overrides[configKey] = envVal;
        }
      }
    }
    return overrides;
  }

  function merge(...sources: ConfigRecord[]): ConfigRecord {
    const result: ConfigRecord = {};
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) {
        result[k] = v;
      }
    }
    return result;
  }

  function readMerged(): ConfigRecord {
    return merge(opts.schema.defaults, readFile(), readEnvOverrides());
  }

  function validateOrThrow(config: ConfigRecord): void {
    if (opts.schema.validate) {
      const err = opts.schema.validate(config);
      if (err) throw new Error(`Config validation failed: ${err}`);
    }
  }

  return {
    get path() {
      return filePath;
    },

    read(): ConfigRecord {
      const config = readMerged();
      validateOrThrow(config);
      return config;
    },

    write(partial: ConfigRecord): void {
      const existing = readFile();
      const updated = merge(existing, partial);
      validateOrThrow(merge(opts.schema.defaults, updated, readEnvOverrides()));
      writeFile(updated);
    },

    get<T extends ConfigValue = ConfigValue>(key: string): T | undefined {
      const config = readMerged();
      return config[key] as T | undefined;
    },

    set(key: string, value: ConfigValue): void {
      const existing = readFile();
      existing[key] = value;
      validateOrThrow(merge(opts.schema.defaults, existing, readEnvOverrides()));
      writeFile(existing);
    },

    reset(): void {
      writeFile({});
    },
  };
}
