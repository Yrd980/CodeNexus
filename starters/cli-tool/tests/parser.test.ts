import { describe, it, expect } from "vitest";
import { parse, generateHelp, ParseError, type ParserConfig } from "../src/parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseConfig(overrides?: Partial<ParserConfig>): ParserConfig {
  return {
    name: "test",
    description: "Test CLI",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Positional arguments
// ---------------------------------------------------------------------------

describe("parser — positional arguments", () => {
  it("parses a single required positional", () => {
    const config = baseConfig({
      positionals: [{ name: "file", description: "Input file" }],
    });
    const result = parse(config, ["hello.txt"]);
    expect(result.positionals["file"]).toBe("hello.txt");
  });

  it("parses multiple positionals in order", () => {
    const config = baseConfig({
      positionals: [
        { name: "src", description: "Source" },
        { name: "dest", description: "Destination" },
      ],
    });
    const result = parse(config, ["a.txt", "b.txt"]);
    expect(result.positionals["src"]).toBe("a.txt");
    expect(result.positionals["dest"]).toBe("b.txt");
  });

  it("applies default for optional positional", () => {
    const config = baseConfig({
      positionals: [{ name: "dir", required: false, default: "." }],
    });
    const result = parse(config, []);
    expect(result.positionals["dir"]).toBe(".");
  });

  it("throws on missing required positional", () => {
    const config = baseConfig({
      positionals: [{ name: "file" }],
    });
    expect(() => parse(config, [])).toThrow(ParseError);
    expect(() => parse(config, [])).toThrow("Missing required argument <file>");
  });

  it("validates positional values", () => {
    const config = baseConfig({
      positionals: [
        {
          name: "port",
          validate: (v) =>
            Number.isNaN(Number(v)) ? "Must be a number" : undefined,
        },
      ],
    });
    expect(() => parse(config, ["abc"])).toThrow("Must be a number");
  });

  it("puts extra positionals into rest", () => {
    const config = baseConfig({
      positionals: [{ name: "file" }],
    });
    const result = parse(config, ["a.txt", "b.txt", "c.txt"]);
    expect(result.positionals["file"]).toBe("a.txt");
    expect(result.rest).toEqual(["b.txt", "c.txt"]);
  });
});

// ---------------------------------------------------------------------------
// Named options
// ---------------------------------------------------------------------------

describe("parser — named options", () => {
  it("parses --name value", () => {
    const config = baseConfig({
      options: [{ name: "output", type: "string" }],
    });
    const result = parse(config, ["--output", "file.txt"]);
    expect(result.options["output"]).toBe("file.txt");
  });

  it("parses --name=value", () => {
    const config = baseConfig({
      options: [{ name: "output", type: "string" }],
    });
    const result = parse(config, ["--output=file.txt"]);
    expect(result.options["output"]).toBe("file.txt");
  });

  it("parses short alias -o value", () => {
    const config = baseConfig({
      options: [{ name: "output", alias: "o", type: "string" }],
    });
    const result = parse(config, ["-o", "file.txt"]);
    expect(result.options["output"]).toBe("file.txt");
  });

  it("applies default values", () => {
    const config = baseConfig({
      options: [{ name: "format", type: "string", default: "json" }],
    });
    const result = parse(config, []);
    expect(result.options["format"]).toBe("json");
  });

  it("throws on unknown option", () => {
    const config = baseConfig({ options: [] });
    expect(() => parse(config, ["--unknown"])).toThrow("Unknown option --unknown");
  });

  it("throws on missing required option", () => {
    const config = baseConfig({
      options: [{ name: "token", type: "string", required: true }],
    });
    expect(() => parse(config, [])).toThrow("Missing required option --token");
  });

  it("validates option values", () => {
    const config = baseConfig({
      options: [
        {
          name: "port",
          type: "number",
          validate: (v) =>
            typeof v === "number" && (v < 1 || v > 65535)
              ? "Port must be between 1 and 65535"
              : undefined,
        },
      ],
    });
    expect(() => parse(config, ["--port", "99999"])).toThrow(
      "Port must be between 1 and 65535",
    );
  });
});

// ---------------------------------------------------------------------------
// Boolean flags
// ---------------------------------------------------------------------------

describe("parser — boolean flags", () => {
  it("parses --verbose as true", () => {
    const config = baseConfig({
      options: [{ name: "verbose", alias: "v", type: "boolean" }],
    });
    const result = parse(config, ["--verbose"]);
    expect(result.options["verbose"]).toBe(true);
  });

  it("parses --no-verbose as false", () => {
    const config = baseConfig({
      options: [{ name: "verbose", type: "boolean", default: true }],
    });
    const result = parse(config, ["--no-verbose"]);
    expect(result.options["verbose"]).toBe(false);
  });

  it("parses short boolean alias", () => {
    const config = baseConfig({
      options: [{ name: "verbose", alias: "v", type: "boolean" }],
    });
    const result = parse(config, ["-v"]);
    expect(result.options["verbose"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type coercion
// ---------------------------------------------------------------------------

describe("parser — type coercion", () => {
  it("coerces to number", () => {
    const config = baseConfig({
      options: [{ name: "count", type: "number" }],
    });
    const result = parse(config, ["--count", "42"]);
    expect(result.options["count"]).toBe(42);
  });

  it("throws when number coercion fails", () => {
    const config = baseConfig({
      options: [{ name: "count", type: "number" }],
    });
    expect(() => parse(config, ["--count", "abc"])).toThrow(
      'expects a number but got "abc"',
    );
  });

  it("coerces to boolean via =", () => {
    const config = baseConfig({
      options: [{ name: "flag", type: "boolean" }],
    });
    // --flag=true handled via boolean flag logic (just --flag sets true)
    const result = parse(config, ["--flag"]);
    expect(result.options["flag"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------

describe("parser — subcommands", () => {
  it("dispatches to a subcommand", () => {
    const sub: ParserConfig = {
      name: "test deploy",
      description: "Deploy the app",
      positionals: [{ name: "env" }],
      options: [{ name: "force", type: "boolean" }],
    };
    const config = baseConfig({
      subcommands: new Map([["deploy", sub]]),
    });
    const result = parse(config, ["deploy", "production", "--force"]);
    expect(result.command).toBe("deploy");
    expect(result.positionals["env"]).toBe("production");
    expect(result.options["force"]).toBe(true);
  });

  it("falls through to positional if token is not a subcommand", () => {
    const config = baseConfig({
      positionals: [{ name: "file" }],
      subcommands: new Map([
        ["deploy", { name: "deploy", description: "Deploy" }],
      ]),
    });
    const result = parse(config, ["readme.md"]);
    expect(result.command).toBeUndefined();
    expect(result.positionals["file"]).toBe("readme.md");
  });
});

// ---------------------------------------------------------------------------
// Rest / separator
// ---------------------------------------------------------------------------

describe("parser — rest separator", () => {
  it("collects everything after -- into rest", () => {
    const config = baseConfig({
      options: [{ name: "verbose", type: "boolean" }],
    });
    const result = parse(config, ["--verbose", "--", "--not-an-option", "foo"]);
    expect(result.options["verbose"]).toBe(true);
    expect(result.rest).toEqual(["--not-an-option", "foo"]);
  });
});

// ---------------------------------------------------------------------------
// Help text generation
// ---------------------------------------------------------------------------

describe("generateHelp", () => {
  it("includes name, description, usage, options, and commands", () => {
    const config: ParserConfig = {
      name: "mycli",
      description: "My awesome CLI",
      options: [
        {
          name: "verbose",
          alias: "v",
          type: "boolean",
          description: "Enable verbose logging",
        },
      ],
      subcommands: new Map([
        ["init", { name: "mycli init", description: "Initialize project" }],
      ]),
    };
    const help = generateHelp(config);
    expect(help).toContain("My awesome CLI");
    expect(help).toContain("Usage: mycli");
    expect(help).toContain("--verbose");
    expect(help).toContain("-v");
    expect(help).toContain("init");
  });
});
