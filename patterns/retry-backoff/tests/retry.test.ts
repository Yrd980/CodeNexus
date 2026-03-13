import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  retry,
  calculateDelay,
  RetryExhaustedError,
  RetryAbortedError,
} from "../src/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create an operation that fails `n` times then succeeds with `value`. */
function failNTimes<T>(n: number, value: T): () => Promise<T> {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls <= n) {
      throw new Error(`transient failure #${calls}`);
    }
    return value;
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("retry()", () => {
  // Use fake timers so tests don't actually wait for backoff delays.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: run retry with auto-advancing timers so sleeps resolve instantly.
  async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
    // Keep advancing until the promise settles.
    let settled = false;
    let result: T | undefined;
    let error: unknown;

    promise
      .then((v) => {
        result = v;
        settled = true;
      })
      .catch((e) => {
        error = e;
        settled = true;
      });

    while (!settled) {
      await vi.advanceTimersByTimeAsync(50);
    }

    if (error !== undefined) throw error;
    return result as T;
  }

  // ── Successful on first try ───────────────────────────────────────────
  it("returns immediately when the operation succeeds on the first call", async () => {
    const op = vi.fn().mockResolvedValue("ok");

    const result = await runWithTimers(
      retry(op, { maxRetries: 3, baseDelayMs: 100, jitter: "none" }),
    );

    expect(result.data).toBe("ok");
    expect(result.attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
  });

  // ── Retry on transient failure then succeed ───────────────────────────
  it("retries on transient failures and returns the eventual success", async () => {
    const op = failNTimes(2, "recovered");

    const result = await runWithTimers(
      retry(op, { maxRetries: 5, baseDelayMs: 10, jitter: "none" }),
    );

    expect(result.data).toBe("recovered");
    expect(result.attempts).toBe(3); // 2 failures + 1 success
  });

  // ── Max retries exhausted ─────────────────────────────────────────────
  it("throws RetryExhaustedError after all attempts are used", async () => {
    const op = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(
      runWithTimers(
        retry(op, { maxRetries: 2, baseDelayMs: 10, jitter: "none" }),
      ),
    ).rejects.toThrow(RetryExhaustedError);

    // 1 initial + 2 retries = 3 total calls
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("RetryExhaustedError carries the last error and attempt count", async () => {
    const op = vi.fn().mockRejectedValue(new Error("boom"));

    try {
      await runWithTimers(
        retry(op, { maxRetries: 1, baseDelayMs: 10, jitter: "none" }),
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError);
      const exhausted = err as RetryExhaustedError;
      expect(exhausted.attempts).toBe(2);
      expect(exhausted.lastError).toBeInstanceOf(Error);
      expect((exhausted.lastError as Error).message).toBe("boom");
    }
  });

  // ── Custom shouldRetry ────────────────────────────────────────────────
  it("does not retry when shouldRetry returns false", async () => {
    class NonRetryableError extends Error {
      readonly retryable = false;
    }

    const op = vi.fn().mockRejectedValue(new NonRetryableError("fatal"));

    await expect(
      runWithTimers(
        retry(op, {
          maxRetries: 5,
          baseDelayMs: 10,
          jitter: "none",
          shouldRetry: (err) =>
            err instanceof NonRetryableError ? err.retryable : true,
        }),
      ),
    ).rejects.toThrow(NonRetryableError);

    // Should have called the operation only once (no retries).
    expect(op).toHaveBeenCalledTimes(1);
  });

  // ── Abort signal cancellation ─────────────────────────────────────────
  it("throws RetryAbortedError when the signal is aborted during wait", async () => {
    const controller = new AbortController();
    const op = vi.fn().mockRejectedValue(new Error("fail"));

    // Capture the result/error eagerly so the rejection is handled
    // immediately — prevents the PromiseRejectionHandledWarning that
    // occurs when fake timers cause microtask ordering quirks.
    let caughtError: unknown;
    const promise = retry(op, {
      maxRetries: 10,
      baseDelayMs: 5_000,
      jitter: "none",
      signal: controller.signal,
    }).catch((e: unknown) => {
      caughtError = e;
    });

    // Let the first attempt fail, then abort during the backoff wait.
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);

    await promise;
    expect(caughtError).toBeInstanceOf(RetryAbortedError);
  });

  it("throws RetryAbortedError immediately if already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const op = vi.fn().mockResolvedValue("ok");

    await expect(
      retry(op, {
        maxRetries: 3,
        baseDelayMs: 100,
        jitter: "none",
        signal: controller.signal,
      }),
    ).rejects.toThrow(RetryAbortedError);

    // The operation should never have been called.
    expect(op).toHaveBeenCalledTimes(0);
  });

  // ── onRetry callback ──────────────────────────────────────────────────
  it("calls onRetry before each retry with correct arguments", async () => {
    const onRetry = vi.fn();
    const op = failNTimes(2, "done");

    await runWithTimers(
      retry(op, {
        maxRetries: 3,
        baseDelayMs: 100,
        jitter: "none",
        onRetry,
      }),
    );

    expect(onRetry).toHaveBeenCalledTimes(2);
    // First retry: attempt 1, delay = 100 (base * 2^0)
    expect(onRetry.mock.calls[0][1]).toBe(1);
    expect(onRetry.mock.calls[0][2]).toBe(100);
    // Second retry: attempt 2, delay = 200 (base * 2^1)
    expect(onRetry.mock.calls[1][1]).toBe(2);
    expect(onRetry.mock.calls[1][2]).toBe(200);
  });
});

// ─── Delay calculation ──────────────────────────────────────────────────────

describe("calculateDelay()", () => {
  it("grows exponentially with no jitter", () => {
    const delays = Array.from({ length: 5 }, (_, i) =>
      calculateDelay(i, 100, 30_000, "none"),
    );

    expect(delays).toEqual([100, 200, 400, 800, 1600]);
  });

  it("caps at maxDelayMs", () => {
    const delay = calculateDelay(20, 100, 5_000, "none");
    expect(delay).toBe(5_000);
  });

  it("full jitter produces values in [0, exponential delay]", () => {
    // Run many samples and verify they're within bounds.
    for (let i = 0; i < 200; i++) {
      const base = 100;
      const maxDelay = 50_000;
      const attempt = 3; // exponential = 100 * 2^3 = 800
      const delay = calculateDelay(attempt, base, maxDelay, "full");

      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(800);
    }
  });

  it("equal jitter produces values in [delay/2, delay]", () => {
    for (let i = 0; i < 200; i++) {
      const base = 100;
      const maxDelay = 50_000;
      const attempt = 2; // exponential = 400
      const delay = calculateDelay(attempt, base, maxDelay, "equal");

      expect(delay).toBeGreaterThanOrEqual(200);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });

  it("full jitter is not constant (randomisation check)", () => {
    const samples = new Set(
      Array.from({ length: 50 }, () =>
        calculateDelay(3, 100, 50_000, "full"),
      ),
    );

    // With 50 samples, we should see many distinct values.
    expect(samples.size).toBeGreaterThan(10);
  });
});
