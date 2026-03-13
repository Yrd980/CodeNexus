/**
 * Retry with exponential backoff — Core implementation
 *
 * Implements the "full jitter" algorithm recommended by the AWS Architecture
 * Blog for minimising contention under high concurrency:
 *
 *   delay = random_between(0, min(cap, base × 2^attempt))
 *
 * The module is zero‑dependency (Node.js built‑ins only) because retry logic
 * is too fundamental to tie to a third‑party package lifecycle.
 */

import type {
  JitterStrategy,
  RetryConfig,
  RetryResult,
} from "./types.js";
import {
  RetryAbortedError,
  RetryExhaustedError,
} from "./types.js";

// ─── Defaults ───────────────────────────────────────────────────────────────
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
  jitter: "full",
  shouldRetry: () => true,
};

// ─── Delay calculation ──────────────────────────────────────────────────────

/**
 * Compute the raw exponential delay for a given attempt (0‑indexed).
 * Capped at `maxDelayMs` to prevent absurdly long waits.
 */
function exponentialDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  // 2^attempt may overflow for very large attempt counts — cap first.
  const raw = baseDelayMs * 2 ** attempt;
  return Math.min(raw, maxDelayMs);
}

/**
 * Apply a jitter strategy to the deterministic exponential delay.
 *
 * - **full**  — uniform random in [0, delay]  (lowest contention)
 * - **equal** — delay/2 + uniform random in [0, delay/2]
 * - **none**  — no randomisation
 */
function applyJitter(delay: number, strategy: JitterStrategy): number {
  switch (strategy) {
    case "full":
      return Math.random() * delay;
    case "equal":
      return delay / 2 + Math.random() * (delay / 2);
    case "none":
      return delay;
  }
}

/**
 * Calculate the delay for a specific retry attempt, incorporating both the
 * exponential curve and the jitter strategy.
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: JitterStrategy,
): number {
  const expDelay = exponentialDelay(attempt, baseDelayMs, maxDelayMs);
  return applyJitter(expDelay, jitter);
}

// ─── Sleep helper (abort‑aware) ─────────────────────────────────────────────

/**
 * Returns a promise that resolves after `ms` milliseconds.
 *
 * Resolves with `true` if the sleep completed normally, or `false` if it was
 * interrupted by an AbortSignal.  We intentionally *never reject* here —
 * rejecting from an event‑listener callback creates a race between the
 * microtask queue and `await`, which surfaces as an "unhandled rejection" in
 * Node.js / test runners with fake timers.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      resolve(false);
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Execute `operation` with automatic retries using exponential backoff.
 *
 * @example
 * ```ts
 * const result = await retry(() => fetch("https://api.example.com/data"), {
 *   maxRetries: 5,
 *   baseDelayMs: 300,
 * });
 * console.log(result.data);       // Response
 * console.log(result.attempts);   // e.g. 2
 * console.log(result.totalTimeMs); // e.g. 450
 * ```
 */
export async function retry<T>(
  operation: () => T | Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<RetryResult<T>> {
  const {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    jitter,
    shouldRetry,
    onRetry,
    signal,
  } = { ...DEFAULT_CONFIG, ...config };

  const start = Date.now();
  let lastError: unknown;

  // attempt 0 is the initial call; attempts 1..maxRetries are retries.
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check abort before each attempt
    if (signal?.aborted) {
      throw new RetryAbortedError(attempt);
    }

    try {
      const data = await operation();
      return {
        data,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - start,
      };
    } catch (error: unknown) {
      lastError = error;

      // If the error is not retryable, fail immediately.
      if (!shouldRetry(error)) {
        throw error;
      }

      // If we've used all retries, break out and throw exhausted error.
      if (attempt === maxRetries) {
        break;
      }

      const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);

      // Notify the caller before waiting.
      onRetry?.(error, attempt + 1, delayMs);

      const completed = await sleep(delayMs, signal);
      if (!completed) {
        // Sleep was interrupted by the AbortSignal.
        throw new RetryAbortedError(attempt + 1);
      }
    }
  }

  throw new RetryExhaustedError(maxRetries + 1, lastError);
}
