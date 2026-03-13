/**
 * Minimal console declarations for Node.js environments.
 * We avoid pulling in the full DOM lib since this is a server-side library.
 */
declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
