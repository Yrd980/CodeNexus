/**
 * Retry with exponential backoff — Type definitions
 *
 * All configuration is passed via parameters. No hardcoded defaults live here;
 * defaults are applied at the call site in retry.ts so consumers always see
 * the full shape.
 */

// ─── Jitter Strategies ──────────────────────────────────────────────────────
/**
 * - `full`  — delay ∈ [0, min(cap, base × 2^attempt)]  (recommended by AWS)
 * - `equal` — delay = half deterministic + half random
 * - `none`  — pure exponential, no randomisation
 */
export type JitterStrategy = "full" | "equal" | "none";

// ─── Configuration ──────────────────────────────────────────────────────────
export interface RetryConfig {
  /** Maximum number of retry attempts (does not count the initial call). */
  maxRetries: number;

  /** Base delay in milliseconds for the first retry. */
  baseDelayMs: number;

  /** Upper bound on any single delay in milliseconds. */
  maxDelayMs: number;

  /** Jitter strategy applied to the computed delay. Default: "full". */
  jitter: JitterStrategy;

  /**
   * Predicate that decides whether a thrown error is retryable.
   * Return `true` to retry, `false` to fail immediately.
   * Defaults to retrying every error.
   */
  shouldRetry: (error: unknown) => boolean;

  /**
   * Optional callback fired before each retry attempt.
   * Useful for logging, metrics, or side‑effects.
   */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;

  /**
   * An AbortSignal that lets the caller cancel an in‑flight retry chain.
   * When aborted the current wait is interrupted and a RetryAbortedError is
   * thrown.
   */
  signal?: AbortSignal;
}

// ─── Result ─────────────────────────────────────────────────────────────────
export interface RetryResult<T> {
  /** The value returned by the operation on its successful attempt. */
  data: T;

  /** Total number of attempts made (1 = succeeded on first try). */
  attempts: number;

  /** Wall‑clock time from first call to resolution, in milliseconds. */
  totalTimeMs: number;
}

// ─── Error Types ────────────────────────────────────────────────────────────
/**
 * Thrown when every retry attempt has been exhausted.
 * Wraps the last error so callers can inspect the root cause.
 */
export class RetryExhaustedError extends Error {
  public readonly lastError: unknown;
  public readonly attempts: number;

  constructor(attempts: number, lastError: unknown) {
    const inner =
      lastError instanceof Error ? lastError.message : String(lastError);
    super(
      `All ${attempts} retry attempt(s) exhausted. Last error: ${inner}`,
    );
    this.name = "RetryExhaustedError";
    this.lastError = lastError;
    this.attempts = attempts;
  }
}

/**
 * Thrown when the retry chain is cancelled via an AbortSignal.
 */
export class RetryAbortedError extends Error {
  public readonly attempts: number;

  constructor(attempts: number) {
    super(`Retry aborted after ${attempts} attempt(s)`);
    this.name = "RetryAbortedError";
    this.attempts = attempts;
  }
}
