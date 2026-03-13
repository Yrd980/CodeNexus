/**
 * Fixed-Window Rate Limiter
 *
 * The simplest rate limiting algorithm: divide time into fixed windows and
 * count requests in each window. When the count exceeds the limit the request
 * is denied until the next window starts.
 *
 * Pros:
 *   - Very low memory footprint (one counter per key).
 *   - Easy to reason about.
 *
 * Cons:
 *   - Boundary problem: a burst at the end of one window and the start of the
 *     next can allow up to 2× the limit in a short period.
 *
 * Use when simplicity matters more than perfect accuracy.
 */

import type {
  FixedWindowConfig,
  RateLimiter,
  RateLimitResult,
  RateLimiterStore,
} from "../types.js";
import { MemoryStore } from "../store/memory-store.js";

export interface FixedWindowRateLimiterOptions extends FixedWindowConfig {
  /** Optional external store. Falls back to an in-memory Map. */
  store?: RateLimiterStore;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windowSize: number;
  private readonly maxRequests: number;
  private readonly store: RateLimiterStore;

  constructor(options: FixedWindowRateLimiterOptions) {
    this.windowSize = options.windowSize;
    this.maxRequests = options.maxRequests;
    this.store = options.store ?? new MemoryStore({ cleanupIntervalMs: 0 });
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowSize) * this.windowSize;
    const windowEnd = windowStart + this.windowSize;
    const key = `fw:${identifier}:${windowStart}`;

    const count = await this.store.increment(key, 1, this.windowSize);

    const allowed = count <= this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - count);
    const retryAfterMs = allowed ? 0 : windowEnd - now;

    return {
      allowed,
      remaining,
      resetAt: windowEnd,
      limit: this.maxRequests,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    };
  }

  async reset(identifier: string): Promise<void> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowSize) * this.windowSize;
    const key = `fw:${identifier}:${windowStart}`;
    await this.store.delete(key);
  }
}
