/**
 * Token-Bucket Rate Limiter
 *
 * Classic algorithm: a bucket starts full of tokens. Each request consumes one
 * token. Tokens are refilled at a steady rate up to a maximum capacity. If the
 * bucket is empty the request is denied.
 *
 * Pros:
 *   - Naturally allows short bursts (up to `capacity`) while enforcing an
 *     average rate (`refillRate / refillInterval`).
 *   - Intuitive mental model.
 *
 * Cons:
 *   - Slightly more state per key than a simple counter (tokens + timestamp).
 *
 * State is stored as a JSON blob: `{ tokens: number, lastRefill: number }`.
 */

import type {
  RateLimiter,
  RateLimitResult,
  RateLimiterStore,
  TokenBucketConfig,
} from "../types.js";
import { MemoryStore } from "../store/memory-store.js";

export interface TokenBucketRateLimiterOptions extends TokenBucketConfig {
  store?: RateLimiterStore;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly refillInterval: number;
  private readonly store: RateLimiterStore;

  constructor(options: TokenBucketRateLimiterOptions) {
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.refillInterval = options.refillInterval;
    this.store = options.store ?? new MemoryStore({ cleanupIntervalMs: 0 });
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const key = `tb:${identifier}`;

    // Retrieve or initialise bucket state.
    let state: BucketState;
    const raw = await this.store.get(key);

    if (raw !== null) {
      state = JSON.parse(raw) as BucketState;
    } else {
      state = { tokens: this.capacity, lastRefill: now };
    }

    // Refill tokens based on elapsed time.
    const elapsed = now - state.lastRefill;
    const refillCount = Math.floor(elapsed / this.refillInterval) * this.refillRate;

    if (refillCount > 0) {
      state.tokens = Math.min(this.capacity, state.tokens + refillCount);
      state.lastRefill =
        state.lastRefill +
        Math.floor(elapsed / this.refillInterval) * this.refillInterval;
    }

    // Try to consume a token.
    if (state.tokens >= 1) {
      state.tokens -= 1;

      // Persist. TTL = time to fully refill from 0 (generous upper bound).
      const ttlMs =
        Math.ceil(this.capacity / this.refillRate) * this.refillInterval;
      await this.store.set(key, JSON.stringify(state), ttlMs);

      // Compute next refill timestamp for the reset header.
      const nextRefill = state.lastRefill + this.refillInterval;

      return {
        allowed: true,
        remaining: state.tokens,
        resetAt: nextRefill,
        limit: this.capacity,
        retryAfter: 0,
      };
    }

    // Denied — compute how long until the next token arrives.
    const timeSinceLastRefill = now - state.lastRefill;
    const timeUntilNextToken = this.refillInterval - timeSinceLastRefill;
    const retryAfterMs = Math.max(0, timeUntilNextToken);

    return {
      allowed: false,
      remaining: 0,
      resetAt: now + retryAfterMs,
      limit: this.capacity,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    };
  }

  async reset(identifier: string): Promise<void> {
    await this.store.delete(`tb:${identifier}`);
  }
}
