/**
 * @codenexus/retry-backoff
 *
 * Exponential backoff with jitter for resilient async operations.
 * Zero dependencies. Full TypeScript. Abort‑signal aware.
 *
 * @example
 * ```ts
 * import { retry } from "@codenexus/retry-backoff";
 *
 * const result = await retry(() => fetch("https://api.example.com"), {
 *   maxRetries: 4,
 *   baseDelayMs: 250,
 * });
 * ```
 */

// Re‑export everything consumers need from a single entry point.
export { retry, calculateDelay } from "./retry.js";
export {
  RetryExhaustedError,
  RetryAbortedError,
} from "./types.js";
export type {
  RetryConfig,
  RetryResult,
  JitterStrategy,
} from "./types.js";
