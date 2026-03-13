import { describe, it, expect, beforeEach } from "vitest";
import { createCLI, type CLI, type CommandHandler } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Helpers — capture stdout/stderr
// ---------------------------------------------------------------------------

class MemoryStream {
  chunks: string[] = [];
  write(data: string | Uint8Array): boolean {
    this.chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
    return true;
  }
  get output(): string {
    return this.chunks.join("");
  }
  end(): void {}
}

function makeCLI() {
  return createCLI({
    name: "testcli",
    version: "2.5.0",
    description: "A test CLI",
  });
}

// We need to capture output. The CLI writes to process.stdout by default
// when --version / --help is used. We'll monkey-patch for those tests.

function captureProcessStdout(fn: () => Promise<void>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((data: string | Uint8Array) => {
    chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
    return true;
  }) as typeof process.stdout.write;

  return fn().finally(() => {
    process.stdout.write = original;
  }).then(() => chunks.join(""));
}

// ---------------------------------------------------------------------------
// Command registration & dispatch
// ---------------------------------------------------------------------------

describe("CLI — command registration and dispatch", () => {
  it("registers and dispatches a command", async () => {
    let called = false;
    const cli = makeCLI();
    cli.command({
      name: "greet",
      description: "Say hello",
      handler: () => {
        called = true;
      },
    });
    await cli.run(["greet"]);
    expect(called).toBe(true);
  });

  it("passes parsed args to the handler", async () => {
    let receivedName: string | number | boolean | undefined;
    const cli = makeCLI();
    cli.command({
      name: "greet",
      description: "Say hello",
      positionals: [{ name: "target" }],
      options: [{ name: "loud", type: "boolean" }],
      handler: (args) => {
        receivedName = args.positionals["target"];
      },
    });
    await cli.run(["greet", "world", "--loud"]);
    expect(receivedName).toBe("world");
  });

  it("supports chained command registration", () => {
    const cli = makeCLI();
    const result = cli
      .command({ name: "a", handler: () => {} })
      .command({ name: "b", handler: () => {} });
    expect(result).toBe(cli);
  });
});

// ---------------------------------------------------------------------------
// --version flag
// ---------------------------------------------------------------------------

describe("CLI — version flag", () => {
  it("prints version with --version", async () => {
    const cli = makeCLI();
    const output = await captureProcessStdout(() => cli.run(["--version"]));
    expect(output.trim()).toBe("2.5.0");
  });

  it("prints version with -V", async () => {
    const cli = makeCLI();
    const output = await captureProcessStdout(() => cli.run(["-V"]));
    expect(output.trim()).toBe("2.5.0");
  });
});

// ---------------------------------------------------------------------------
// --help flag
// ---------------------------------------------------------------------------

describe("CLI — help flag", () => {
  it("prints help with --help", async () => {
    const cli = makeCLI();
    cli.command({ name: "deploy", description: "Deploy app", handler: () => {} });
    const output = await captureProcessStdout(() => cli.run(["--help"]));
    expect(output).toContain("testcli");
    expect(output).toContain("deploy");
  });

  it("prints help when no command is given", async () => {
    const cli = makeCLI();
    const output = await captureProcessStdout(() => cli.run([]));
    expect(output).toContain("A test CLI");
  });

  it("prints subcommand help with <command> --help", async () => {
    const cli = makeCLI();
    cli.command({
      name: "deploy",
      description: "Deploy the application",
      options: [{ name: "env", type: "string", description: "Target environment" }],
      handler: () => {},
    });
    const output = await captureProcessStdout(() => cli.run(["deploy", "--help"]));
    expect(output).toContain("deploy");
    expect(output).toContain("--env");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("CLI — error handling", () => {
  it("sets exitCode on parse error", async () => {
    const cli = makeCLI();
    const prevExitCode = process.exitCode;
    // Capture stderr to suppress output
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    await cli.run(["--unknown-flag"]);
    process.stderr.write = original;
    expect(process.exitCode).toBe(1);
    process.exitCode = prevExitCode;
  });

  it("sets exitCode on handler error", async () => {
    const cli = makeCLI();
    cli.command({
      name: "fail",
      handler: () => {
        throw new Error("boom");
      },
    });
    const prevExitCode = process.exitCode;
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    await cli.run(["fail"]);
    process.stderr.write = original;
    expect(process.exitCode).toBe(1);
    process.exitCode = prevExitCode;
  });
});
