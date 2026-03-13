/**
 * Rate Limiter Type Definitions
 *
 * Core interfaces shared across all rate limiting algorithms and stores.
 * Designed for pluggability: swap algorithms or storage backends independently.
 */

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/** Configuration for the fixed-window rate limiter. */
export interface FixedWindowConfig {
  /** Window duration in milliseconds. */
  windowSize: number;
  /** Maximum number of requests allowed per window. */
  maxRequests: number;
}

/** Configuration for the sliding-window counter rate limiter. */
export interface SlidingWindowConfig {
  /** Window duration in milliseconds. */
  windowSize: number;
  /** Maximum number of requests allowed per window. */
  maxRequests: number;
}

/** Configuration for the token-bucket rate limiter. */
export interface TokenBucketConfig {
  /** Maximum number of tokens the bucket can hold. */
  capacity: number;
  /** Number of tokens added per refill. */
  refillRate: number;
  /** Interval between refills in milliseconds. */
  refillInterval: number;
}

/** Union of all algorithm-specific configs. */
export type RateLimiterConfig =
  | ({ algorithm: "fixed-window" } & FixedWindowConfig)
  | ({ algorithm: "sliding-window" } & SlidingWindowConfig)
  | ({ algorithm: "token-bucket" } & TokenBucketConfig);

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Returned by every rate-limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** How many requests / tokens remain in the current window / bucket. */
  remaining: number;
  /** Unix-epoch millisecond timestamp when the limit resets. */
  resetAt: number;
  /** Maximum requests / capacity for the current configuration. */
  limit: number;
  /**
   * Seconds the caller should wait before retrying.
   * `0` when allowed, positive number when denied.
   */
  retryAfter: number;
}

// ---------------------------------------------------------------------------
// Store interface (pluggable backend)
// ---------------------------------------------------------------------------

/**
 * Pluggable storage backend for rate limiters.
 *
 * Implementations must be safe for concurrent access within a single process.
 * For multi-process / distributed setups, use a Redis-backed implementation.
 */
export interface RateLimiterStore {
  /**
   * Retrieve the stored value for `key`.
   * Returns `null` when the key does not exist or has expired.
   */
  get(key: string): Promise<string | null>;

  /**
   * Store `value` under `key` with an expiry of `ttlMs` milliseconds.
   * If the key already exists its value and TTL are replaced.
   */
  set(key: string, value: string, ttlMs: number): Promise<void>;

  /**
   * Atomically increment the numeric value stored at `key` by `amount`.
   * If the key does not exist it is created with the given value and TTL.
   * Returns the new value after incrementing.
   */
  increment(key: string, amount: number, ttlMs: number): Promise<number>;

  /**
   * Delete the entry for `key`. No-op if it does not exist.
   */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Rate limiter interface
// ---------------------------------------------------------------------------

/** Common interface every algorithm implements. */
export interface RateLimiter {
  /**
   * Check (and consume) a rate-limit token for the given identifier.
   *
   * @param identifier — Unique key (IP, user-id, API-key, etc.)
   * @returns Result indicating whether the request is allowed.
   */
  check(identifier: string): Promise<RateLimitResult>;

  /**
   * Reset the rate-limit state for the given identifier.
   */
  reset(identifier: string): Promise<void>;
}
