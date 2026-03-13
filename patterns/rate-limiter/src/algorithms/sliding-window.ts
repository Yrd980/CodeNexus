/**
 * Sliding-Window Counter Rate Limiter
 *
 * A weighted interpolation between two fixed windows to approximate a true
 * sliding window. This is the approach popularized by Cloudflare — it provides
 * much better accuracy than a fixed window while using only two counters per
 * key (current window + previous window).
 *
 * How it works:
 *   1. Divide time into fixed windows of `windowSize` ms.
 *   2. Keep counters for the *current* and *previous* windows.
 *   3. Estimate the request count in the sliding window as:
 *        weight = 1 - (elapsed time in current window / windowSize)
 *        estimate = previousCount × weight + currentCount
 *   4. If estimate + 1 > maxRequests → deny.
 *
 * Pros:
 *   - Smooths the boundary spike that plagues fixed windows.
 *   - Only two counters per key — much less memory than a sliding log.
 *
 * Cons:
 *   - The count is an *estimate*, not exact.
 */

import type {
  RateLimiter,
  RateLimitResult,
  RateLimiterStore,
  SlidingWindowConfig,
} from "../types.js";
import { MemoryStore } from "../store/memory-store.js";

export interface SlidingWindowRateLimiterOptions extends SlidingWindowConfig {
  store?: RateLimiterStore;
}

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly windowSize: number;
  private readonly maxRequests: number;
  private readonly store: RateLimiterStore;

  constructor(options: SlidingWindowRateLimiterOptions) {
    this.windowSize = options.windowSize;
    this.maxRequests = options.maxRequests;
    this.store = options.store ?? new MemoryStore({ cleanupIntervalMs: 0 });
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const currentWindowStart =
      Math.floor(now / this.windowSize) * this.windowSize;
    const previousWindowStart = currentWindowStart - this.windowSize;
    const currentWindowEnd = currentWindowStart + this.windowSize;

    const elapsedInCurrentWindow = now - currentWindowStart;
    const previousWeight = 1 - elapsedInCurrentWindow / this.windowSize;

    const prevKey = `sw:${identifier}:${previousWindowStart}`;
    const currKey = `sw:${identifier}:${currentWindowStart}`;

    // Read previous window count (do not mutate it).
    const prevRaw = await this.store.get(prevKey);
    const previousCount = prevRaw !== null ? Number(prevRaw) : 0;

    // Read current window count *before* incrementing to compute the estimate.
    const currRaw = await this.store.get(currKey);
    const currentCount = currRaw !== null ? Number(currRaw) : 0;

    // Weighted estimate *including* the incoming request.
    const estimate = previousCount * previousWeight + currentCount + 1;

    if (estimate > this.maxRequests) {
      const remaining = Math.max(
        0,
        Math.floor(this.maxRequests - (previousCount * previousWeight + currentCount)),
      );
      const retryAfterMs = currentWindowEnd - now;

      return {
        allowed: false,
        remaining,
        resetAt: currentWindowEnd,
        limit: this.maxRequests,
        retryAfter: Math.ceil(retryAfterMs / 1000),
      };
    }

    // Request allowed — increment the current window counter.
    await this.store.increment(currKey, 1, this.windowSize * 2);

    const newEstimate = previousCount * previousWeight + currentCount + 1;
    const remaining = Math.max(
      0,
      Math.floor(this.maxRequests - newEstimate),
    );

    return {
      allowed: true,
      remaining,
      resetAt: currentWindowEnd,
      limit: this.maxRequests,
      retryAfter: 0,
    };
  }

  async reset(identifier: string): Promise<void> {
    const now = Date.now();
    const currentWindowStart =
      Math.floor(now / this.windowSize) * this.windowSize;
    const previousWindowStart = currentWindowStart - this.windowSize;

    await this.store.delete(`sw:${identifier}:${previousWindowStart}`);
    await this.store.delete(`sw:${identifier}:${currentWindowStart}`);
  }
}
