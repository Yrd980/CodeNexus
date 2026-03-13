import { describe, expect, it } from "vitest";

import { loadConfig, parseEnvFile } from "../src/config.js";

describe("parseEnvFile", () => {
  it("parses simple key=value pairs", () => {
    const result = parseEnvFile("FOO=bar\nBAZ=qux");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comments and empty lines", () => {
    const result = parseEnvFile(`
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles double-quoted values", () => {
    const result = parseEnvFile(`MSG="hello world"`);
    expect(result).toEqual({ MSG: "hello world" });
  });

  it("handles single-quoted values", () => {
    const result = parseEnvFile(`MSG='hello world'`);
    expect(result).toEqual({ MSG: "hello world" });
  });

  it("strips inline comments for unquoted values", () => {
    const result = parseEnvFile(`FOO=bar # this is a comment`);
    expect(result).toEqual({ FOO: "bar" });
  });

  it("preserves inline # in quoted values", () => {
    const result = parseEnvFile(`FOO="bar # not a comment"`);
    expect(result).toEqual({ FOO: "bar # not a comment" });
  });

  it("handles values with equals signs", () => {
    const result = parseEnvFile(`URL=postgres://user:pass@host/db?opt=1`);
    expect(result).toEqual({ URL: "postgres://user:pass@host/db?opt=1" });
  });

  it("trims whitespace around keys and values", () => {
    const result = parseEnvFile(`  FOO  =  bar  `);
    expect(result).toEqual({ FOO: "bar" });
  });
});

describe("loadConfig", () => {
  it("loads string values from env", () => {
    const config = loadConfig(
      { name: { env: "APP_NAME", type: "string" } },
      { env: { APP_NAME: "myapp" } },
    );
    expect(config.name).toBe("myapp");
  });

  it("coerces number values", () => {
    const config = loadConfig(
      { port: { env: "PORT", type: "number" } },
      { env: { PORT: "3000" } },
    );
    expect(config.port).toBe(3000);
  });

  it("coerces boolean values", () => {
    const config = loadConfig(
      {
        debug: { env: "DEBUG", type: "boolean" },
        verbose: { env: "VERBOSE", type: "boolean" },
      },
      { env: { DEBUG: "true", VERBOSE: "0" } },
    );
    expect(config.debug).toBe(true);
    expect(config.verbose).toBe(false);
  });

  it("accepts yes/no/1/0 as boolean", () => {
    const config = loadConfig(
      {
        a: { env: "A", type: "boolean" },
        b: { env: "B", type: "boolean" },
      },
      { env: { A: "yes", B: "no" } },
    );
    expect(config.a).toBe(true);
    expect(config.b).toBe(false);
  });

  it("uses default values when env var is missing", () => {
    const config = loadConfig(
      { port: { env: "PORT", type: "number", default: 8080 } },
      { env: {} },
    );
    expect(config.port).toBe(8080);
  });

  it("throws on missing required values", () => {
    expect(() =>
      loadConfig(
        { dbUrl: { env: "DATABASE_URL", type: "string", required: true } },
        { env: {} },
      ),
    ).toThrow("Config validation failed");
  });

  it("lists all errors when multiple fields are invalid", () => {
    try {
      loadConfig(
        {
          a: { env: "A", type: "string" },
          b: { env: "B", type: "string" },
        },
        { env: {} },
      );
      expect.fail("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("A");
      expect(msg).toContain("B");
    }
  });

  it("throws on invalid number coercion", () => {
    expect(() =>
      loadConfig(
        { port: { env: "PORT", type: "number" } },
        { env: { PORT: "not-a-number" } },
      ),
    ).toThrow("not a valid number");
  });

  it("throws on invalid boolean coercion", () => {
    expect(() =>
      loadConfig(
        { flag: { env: "FLAG", type: "boolean" } },
        { env: { FLAG: "maybe" } },
      ),
    ).toThrow("not a valid boolean");
  });

  it("supports nested config schemas", () => {
    const config = loadConfig(
      {
        db: {
          host: { env: "DB_HOST", type: "string" },
          port: { env: "DB_PORT", type: "number", default: 5432 },
        },
      },
      { env: { DB_HOST: "localhost" } },
    );
    expect(config.db).toEqual({ host: "localhost", port: 5432 });
  });

  it("freezes the returned config", () => {
    const config = loadConfig(
      { name: { env: "NAME", type: "string" } },
      { env: { NAME: "test" } },
    );
    expect(() => {
      (config as Record<string, unknown>).name = "changed";
    }).toThrow();
  });

  it("freezes nested config objects", () => {
    const config = loadConfig(
      {
        db: {
          host: { env: "DB_HOST", type: "string" },
        },
      },
      { env: { DB_HOST: "localhost" } },
    );
    const db = config.db as Record<string, unknown>;
    expect(() => {
      db.host = "changed";
    }).toThrow();
  });

  it("skips optional fields without default gracefully", () => {
    const config = loadConfig(
      { name: { env: "NAME", type: "string", required: false } },
      { env: {} },
    );
    expect(config.name).toBeUndefined();
  });

  it("includes description in error message when provided", () => {
    try {
      loadConfig(
        {
          secret: {
            env: "SECRET",
            type: "string",
            description: "API secret key",
          },
        },
        { env: {} },
      );
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("API secret key");
    }
  });
});
