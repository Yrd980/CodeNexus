import { describe, it, expect, beforeEach } from "vitest";
import {
  createOutputContext,
  success,
  error,
  warning,
  info,
  formatTable,
  printTable,
  type OutputContext,
} from "../src/output.js";

// ---------------------------------------------------------------------------
// In-memory writable stream for capturing output
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

  // Required to satisfy NodeJS.WritableStream
  end(): void {
    /* noop */
  }
}

function createTestCtx(
  overrides: { json?: boolean; quiet?: boolean; color?: boolean } = {},
): { ctx: OutputContext; stdout: MemoryStream; stderr: MemoryStream } {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const ctx = createOutputContext({
    json: overrides.json ?? false,
    quiet: overrides.quiet ?? false,
    color: overrides.color ?? false,
    stdout: stdout as unknown as NodeJS.WritableStream,
    stderr: stderr as unknown as NodeJS.WritableStream,
  });
  return { ctx, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

describe("output — message helpers", () => {
  it("success writes to stdout with checkmark", () => {
    const { ctx, stdout } = createTestCtx();
    success(ctx, "All good");
    expect(stdout.output).toContain("All good");
  });

  it("error writes to stderr", () => {
    const { ctx, stderr } = createTestCtx();
    error(ctx, "Something broke");
    expect(stderr.output).toContain("Something broke");
  });

  it("warning writes to stdout", () => {
    const { ctx, stdout } = createTestCtx();
    warning(ctx, "Watch out");
    expect(stdout.output).toContain("Watch out");
  });

  it("info writes to stdout", () => {
    const { ctx, stdout } = createTestCtx();
    info(ctx, "FYI");
    expect(stdout.output).toContain("FYI");
  });
});

// ---------------------------------------------------------------------------
// JSON mode
// ---------------------------------------------------------------------------

describe("output — JSON mode", () => {
  it("success outputs JSON to stdout", () => {
    const { ctx, stdout } = createTestCtx({ json: true });
    success(ctx, "done");
    const obj = JSON.parse(stdout.output.trim());
    expect(obj).toEqual({ level: "success", message: "done" });
  });

  it("error outputs JSON to stderr", () => {
    const { ctx, stderr } = createTestCtx({ json: true });
    error(ctx, "fail");
    const obj = JSON.parse(stderr.output.trim());
    expect(obj).toEqual({ level: "error", message: "fail" });
  });

  it("warning outputs JSON", () => {
    const { ctx, stdout } = createTestCtx({ json: true });
    warning(ctx, "careful");
    const obj = JSON.parse(stdout.output.trim());
    expect(obj).toEqual({ level: "warning", message: "careful" });
  });

  it("info outputs JSON", () => {
    const { ctx, stdout } = createTestCtx({ json: true });
    info(ctx, "note");
    const obj = JSON.parse(stdout.output.trim());
    expect(obj).toEqual({ level: "info", message: "note" });
  });
});

// ---------------------------------------------------------------------------
// Quiet mode
// ---------------------------------------------------------------------------

describe("output — quiet mode", () => {
  it("suppresses success in quiet mode", () => {
    const { ctx, stdout } = createTestCtx({ quiet: true });
    success(ctx, "nope");
    expect(stdout.output).toBe("");
  });

  it("suppresses warning in quiet mode", () => {
    const { ctx, stdout } = createTestCtx({ quiet: true });
    warning(ctx, "nope");
    expect(stdout.output).toBe("");
  });

  it("suppresses info in quiet mode", () => {
    const { ctx, stdout } = createTestCtx({ quiet: true });
    info(ctx, "nope");
    expect(stdout.output).toBe("");
  });

  it("still shows errors in quiet mode", () => {
    const { ctx, stderr } = createTestCtx({ quiet: true });
    error(ctx, "still visible");
    expect(stderr.output).toContain("still visible");
  });
});

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

describe("output — formatTable", () => {
  it("aligns columns and includes separator", () => {
    const table = formatTable({
      headers: ["Name", "Age"],
      rows: [
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    });
    const lines = table.split("\n");
    expect(lines.length).toBe(4); // header + separator + 2 rows
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Age");
    // Separator line
    expect(lines[1]).toMatch(/─+/);
  });

  it("handles custom padding", () => {
    const table = formatTable({
      headers: ["A", "B"],
      rows: [["1", "2"]],
      padding: 4,
    });
    // 4 spaces between columns
    expect(table).toContain("    ");
  });
});

describe("output — printTable", () => {
  it("outputs JSON array in json mode", () => {
    const { ctx, stdout } = createTestCtx({ json: true });
    printTable(ctx, {
      headers: ["Name", "Score"],
      rows: [["Alice", "100"]],
    });
    const data = JSON.parse(stdout.output.trim());
    expect(data).toEqual([{ Name: "Alice", Score: "100" }]);
  });

  it("suppressed in quiet mode", () => {
    const { ctx, stdout } = createTestCtx({ quiet: true });
    printTable(ctx, {
      headers: ["X"],
      rows: [["1"]],
    });
    expect(stdout.output).toBe("");
  });
});
