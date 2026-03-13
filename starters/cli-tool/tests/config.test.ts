import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig, type ConfigRecord } from "../src/config.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cli-config-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  // Clean env overrides
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("TESTAPP_")) {
      delete process.env[key];
    }
  }
});

function makeConfig(defaults: ConfigRecord = { theme: "dark", port: 3000 }) {
  return createConfig({
    appName: "testapp",
    schema: { defaults },
    configDir: tempDir,
  });
}

// ---------------------------------------------------------------------------
// Read / defaults
// ---------------------------------------------------------------------------

describe("config — read and defaults", () => {
  it("returns defaults when no config file exists", () => {
    const cfg = makeConfig();
    const data = cfg.read();
    expect(data["theme"]).toBe("dark");
    expect(data["port"]).toBe(3000);
  });

  it("get returns a single default value", () => {
    const cfg = makeConfig();
    expect(cfg.get("theme")).toBe("dark");
  });

  it("get returns undefined for unknown keys", () => {
    const cfg = makeConfig();
    expect(cfg.get("unknown")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Write / merge
// ---------------------------------------------------------------------------

describe("config — write", () => {
  it("persists values to disk", () => {
    const cfg = makeConfig();
    cfg.write({ theme: "light" });
    const data = cfg.read();
    expect(data["theme"]).toBe("light");
    // Default still present
    expect(data["port"]).toBe(3000);
  });

  it("merges with existing values", () => {
    const cfg = makeConfig();
    cfg.write({ theme: "light" });
    cfg.write({ port: 8080 });
    const data = cfg.read();
    expect(data["theme"]).toBe("light");
    expect(data["port"]).toBe(8080);
  });

  it("set persists a single key", () => {
    const cfg = makeConfig();
    cfg.set("theme", "blue");
    expect(cfg.get("theme")).toBe("blue");
  });
});

// ---------------------------------------------------------------------------
// Environment variable overrides
// ---------------------------------------------------------------------------

describe("config — env overrides", () => {
  it("env var overrides file and defaults", () => {
    const cfg = makeConfig();
    cfg.write({ theme: "light" });
    process.env["TESTAPP_THEME"] = "env-theme";
    const data = cfg.read();
    expect(data["theme"]).toBe("env-theme");
  });

  it("coerces env var numbers", () => {
    const cfg = makeConfig();
    process.env["TESTAPP_PORT"] = "9090";
    expect(cfg.get("port")).toBe(9090);
  });

  it("coerces env var booleans", () => {
    const cfg = makeConfig({ debug: false });
    process.env["TESTAPP_DEBUG"] = "true";
    expect(cfg.get("debug")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe("config — reset", () => {
  it("resets to defaults", () => {
    const cfg = makeConfig();
    cfg.write({ theme: "custom" });
    cfg.reset();
    expect(cfg.get("theme")).toBe("dark");
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("config — validation", () => {
  it("throws when validation fails on read", () => {
    // Write invalid data directly to the file to simulate a manually-edited config
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({ port: 99999 }));
    const cfg = createConfig({
      appName: "testapp",
      schema: {
        defaults: { port: 3000 },
        validate: (c) =>
          typeof c["port"] === "number" && c["port"] > 65535
            ? "Port out of range"
            : undefined,
      },
      configDir: tempDir,
    });
    // Remove env override just in case
    delete process.env["TESTAPP_PORT"];
    expect(() => cfg.read()).toThrow("Port out of range");
  });

  it("throws when validation fails on write", () => {
    const cfg = createConfig({
      appName: "testapp",
      schema: {
        defaults: { port: 3000 },
        validate: (c) =>
          typeof c["port"] === "number" && c["port"] > 65535
            ? "Port out of range"
            : undefined,
      },
      configDir: tempDir,
    });
    expect(() => cfg.write({ port: 99999 })).toThrow("Port out of range");
  });
});

// ---------------------------------------------------------------------------
// Config path
// ---------------------------------------------------------------------------

describe("config — path", () => {
  it("reports the correct file path", () => {
    const cfg = makeConfig();
    expect(cfg.path).toBe(join(tempDir, "config.json"));
  });

  it("supports custom file name", () => {
    const cfg = createConfig({
      appName: "testapp",
      schema: { defaults: {} },
      configDir: tempDir,
      fileName: "settings.json",
    });
    expect(cfg.path).toBe(join(tempDir, "settings.json"));
  });
});
