import { describe, expect, it } from "vitest";

import {
  applyEnvOverrides,
  getEnvironment,
  isDev,
  isProd,
  isStaging,
  isTest,
  resolveFeatureFlags,
} from "../src/env.js";

describe("getEnvironment", () => {
  it("returns development when NODE_ENV is not set", () => {
    expect(getEnvironment({})).toBe("development");
  });

  it("returns production when NODE_ENV is production", () => {
    expect(getEnvironment({ NODE_ENV: "production" })).toBe("production");
  });

  it("returns test when NODE_ENV is test", () => {
    expect(getEnvironment({ NODE_ENV: "test" })).toBe("test");
  });

  it("returns staging when NODE_ENV is staging", () => {
    expect(getEnvironment({ NODE_ENV: "staging" })).toBe("staging");
  });

  it("is case-insensitive", () => {
    expect(getEnvironment({ NODE_ENV: "Production" })).toBe("production");
  });

  it("defaults to development for unknown values", () => {
    expect(getEnvironment({ NODE_ENV: "banana" })).toBe("development");
  });
});

describe("isDev / isProd / isTest / isStaging", () => {
  it("isDev returns true in development", () => {
    expect(isDev({ NODE_ENV: "development" })).toBe(true);
    expect(isDev({ NODE_ENV: "production" })).toBe(false);
  });

  it("isProd returns true in production", () => {
    expect(isProd({ NODE_ENV: "production" })).toBe(true);
    expect(isProd({ NODE_ENV: "development" })).toBe(false);
  });

  it("isTest returns true in test", () => {
    expect(isTest({ NODE_ENV: "test" })).toBe(true);
    expect(isTest({ NODE_ENV: "development" })).toBe(false);
  });

  it("isStaging returns true in staging", () => {
    expect(isStaging({ NODE_ENV: "staging" })).toBe(true);
    expect(isStaging({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("applyEnvOverrides", () => {
  it("returns base config when no override matches", () => {
    const result = applyEnvOverrides(
      { logLevel: "info", debug: false },
      { production: { logLevel: "warn" } },
      { NODE_ENV: "development" },
    );
    expect(result).toEqual({ logLevel: "info", debug: false });
  });

  it("merges matching environment overrides", () => {
    const result = applyEnvOverrides(
      { logLevel: "info", debug: false },
      { development: { debug: true } },
      { NODE_ENV: "development" },
    );
    expect(result).toEqual({ logLevel: "info", debug: true });
  });

  it("does not mutate the base config", () => {
    const base = { logLevel: "info" as string };
    applyEnvOverrides(
      base,
      { development: { logLevel: "debug" } },
      { NODE_ENV: "development" },
    );
    expect(base.logLevel).toBe("info");
  });
});

describe("resolveFeatureFlags", () => {
  it("resolves flags for current environment", () => {
    const flags = resolveFeatureFlags(
      {
        newCheckout: { development: true, production: false },
        betaApi: { development: true, staging: true, production: false },
      },
      { NODE_ENV: "development" },
    );
    expect(flags.newCheckout).toBe(true);
    expect(flags.betaApi).toBe(true);
  });

  it("defaults to false when flag is not defined for current env", () => {
    const flags = resolveFeatureFlags(
      { newFeature: { production: true } },
      { NODE_ENV: "development" },
    );
    expect(flags.newFeature).toBe(false);
  });

  it("respects production environment", () => {
    const flags = resolveFeatureFlags(
      {
        newCheckout: { development: true, production: false },
      },
      { NODE_ENV: "production" },
    );
    expect(flags.newCheckout).toBe(false);
  });
});
