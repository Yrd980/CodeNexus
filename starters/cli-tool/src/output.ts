/**
 * Output formatting — colored text, tables, spinners, and structured messages.
 *
 * Respects the NO_COLOR environment variable (https://no-color.org/) and
 * provides JSON and quiet output modes.
 */

import { WriteStream } from "node:tty";

// ---------------------------------------------------------------------------
// Color support detection
// ---------------------------------------------------------------------------

function supportsColor(): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] !== undefined) return true;
  if (process.stdout instanceof WriteStream) {
    return process.stdout.isTTY === true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ANSI codes
// ---------------------------------------------------------------------------

type StyleFn = (text: string) => string;

function ansi(open: number, close: number): StyleFn {
  if (!supportsColor()) return (t) => t;
  return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}

export const bold: StyleFn = (t) => ansi(1, 22)(t);
export const dim: StyleFn = (t) => ansi(2, 22)(t);
export const red: StyleFn = (t) => ansi(31, 39)(t);
export const green: StyleFn = (t) => ansi(32, 39)(t);
export const yellow: StyleFn = (t) => ansi(33, 39)(t);
export const blue: StyleFn = (t) => ansi(34, 39)(t);
export const cyan: StyleFn = (t) => ansi(36, 39)(t);

// ---------------------------------------------------------------------------
// Output context — controls JSON / quiet / color behaviour
// ---------------------------------------------------------------------------

export interface OutputOptions {
  /** When true, helpers output JSON objects instead of formatted text */
  json?: boolean;
  /** When true, only errors are printed */
  quiet?: boolean;
  /** Override color detection */
  color?: boolean;
  /** Writable stream for stdout (default: process.stdout) */
stdout?: NodeJS.WritableStream;
  /** Writable stream for stderr (default: process.stderr) */
  stderr?: NodeJS.WritableStream;
}

export interface OutputContext {
  json: boolean;
  quiet: boolean;
  color: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function createOutputContext(opts: OutputOptions = {}): OutputContext {
  return {
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
    color: opts.color ?? supportsColor(),
    stdout: opts.stdout ?? process.stdout,
    stderr: opts.stderr ?? process.stderr,
  };
}

// ---------------------------------------------------------------------------
// Styled write helpers
// ---------------------------------------------------------------------------

function write(ctx: OutputContext, stream: NodeJS.WritableStream, msg: string): void {
  stream.write(msg + "\n");
}

function colorize(ctx: OutputContext, fn: StyleFn, text: string): string {
  return ctx.color ? fn(text) : text;
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

export function success(ctx: OutputContext, msg: string): void {
  if (ctx.quiet) return;
  if (ctx.json) {
    write(ctx, ctx.stdout, JSON.stringify({ level: "success", message: msg }));
    return;
  }
  write(ctx, ctx.stdout, `${colorize(ctx, green, "✔")} ${msg}`);
}

export function error(ctx: OutputContext, msg: string): void {
  if (ctx.json) {
    write(ctx, ctx.stderr, JSON.stringify({ level: "error", message: msg }));
    return;
  }
  write(ctx, ctx.stderr, `${colorize(ctx, red, "✖")} ${msg}`);
}

export function warning(ctx: OutputContext, msg: string): void {
  if (ctx.quiet) return;
  if (ctx.json) {
    write(ctx, ctx.stdout, JSON.stringify({ level: "warning", message: msg }));
    return;
  }
  write(ctx, ctx.stdout, `${colorize(ctx, yellow, "⚠")} ${msg}`);
}

export function info(ctx: OutputContext, msg: string): void {
  if (ctx.quiet) return;
  if (ctx.json) {
    write(ctx, ctx.stdout, JSON.stringify({ level: "info", message: msg }));
    return;
  }
  write(ctx, ctx.stdout, `${colorize(ctx, blue, "ℹ")} ${msg}`);
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

export interface TableOptions {
  /** Column headers */
  headers: string[];
  /** Row data — each row is an array of cell strings */
  rows: string[][];
  /** Padding between columns (default: 2) */
  padding?: number;
}

export function formatTable(opts: TableOptions): string {
  const padding = opts.padding ?? 2;
  const allRows = [opts.headers, ...opts.rows];

  // Calculate max width for each column
  const colCount = opts.headers.length;
  const widths: number[] = new Array<number>(colCount).fill(0);
  for (const row of allRows) {
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? "";
      widths[c] = Math.max(widths[c] ?? 0, cell.length);
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < allRows.length; r++) {
    const row = allRows[r]!;
    const cells = row.map((cell, c) => {
      const w = widths[c] ?? 0;
      return cell.padEnd(w);
    });
    lines.push(cells.join(" ".repeat(padding)));

    // Separator after header
    if (r === 0) {
      const sep = widths.map((w) => "─".repeat(w));
      lines.push(sep.join(" ".repeat(padding)));
    }
  }
  return lines.join("\n");
}

export function printTable(ctx: OutputContext, opts: TableOptions): void {
  if (ctx.quiet) return;
  if (ctx.json) {
    const data = opts.rows.map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < opts.headers.length; i++) {
        obj[opts.headers[i]!] = row[i] ?? "";
      }
      return obj;
    });
    write(ctx, ctx.stdout, JSON.stringify(data));
    return;
  }
  write(ctx, ctx.stdout, formatTable(opts));
}

// ---------------------------------------------------------------------------
// Spinner / progress indicator
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  /** Update the spinner message */
  update(msg: string): void;
  /** Stop the spinner and show a final message */
  stop(msg?: string): void;
  /** Stop with a success symbol */
  succeed(msg: string): void;
  /** Stop with an error symbol */
  fail(msg: string): void;
}

export function createSpinner(ctx: OutputContext, initialMsg: string): Spinner {
  let frame = 0;
  let message = initialMsg;
  let timer: ReturnType<typeof setInterval> | null = null;

  const isTTY =
    ctx.stdout === process.stdout &&
    process.stdout instanceof WriteStream &&
    process.stdout.isTTY;

  if (!ctx.quiet && !ctx.json && isTTY) {
    const stream = process.stdout as WriteStream;
    timer = setInterval(() => {
      const symbol = ctx.color
        ? cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!)
        : SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
      stream.clearLine(0);
      stream.cursorTo(0);
      stream.write(`${symbol} ${message}`);
      frame++;
    }, 80);
  }

  function stop(finalLine?: string): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (isTTY) {
      const stream = process.stdout as WriteStream;
      stream.clearLine(0);
      stream.cursorTo(0);
    }
    if (finalLine !== undefined) {
      write(ctx, ctx.stdout, finalLine);
    }
  }

  return {
    update(msg: string) {
      message = msg;
    },
    stop(msg?: string) {
      stop(msg);
    },
    succeed(msg: string) {
      stop(`${colorize(ctx, green, "✔")} ${msg}`);
    },
    fail(msg: string) {
      stop(`${colorize(ctx, red, "✖")} ${msg}`);
    },
  };
}
