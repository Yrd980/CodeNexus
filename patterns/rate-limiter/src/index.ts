/**
 * @codenexus/rate-limiter
 *
 * Production-ready rate limiting with multiple algorithms and pluggable storage.
 *
 * Algorithms:
 *   - FixedWindowRateLimiter  — simplest, one counter per time window
 *   - SlidingWindowRateLimiter — weighted interpolation, much smoother
 *   - TokenBucketRateLimiter  — classic bucket, great for bursty traffic
 *
 * Storage:
 *   - MemoryStore (built-in) — in-process Map with TTL cleanup
 *   - Implement `RateLimiterStore` for Redis / DynamoDB / etc.
 *
 * Middleware:
 *   - createRateLimitMiddleware — framework-agnostic handler
 *   - Built-in key extractors (IP, header, auth)
 */

// Types
export type {
  FixedWindowConfig,
  SlidingWindowConfig,
  TokenBucketConfig,
  RateLimiterConfig,
  RateLimitResult,
  RateLimiterStore,
  RateLimiter,
} from "./types.js";

// Algorithms
export { FixedWindowRateLimiter } from "./algorithms/fixed-window.js";
export type { FixedWindowRateLimiterOptions } from "./algorithms/fixed-window.js";

export { SlidingWindowRateLimiter } from "./algorithms/sliding-window.js";
export type { SlidingWindowRateLimiterOptions } from "./algorithms/sliding-window.js";

export { TokenBucketRateLimiter } from "./algorithms/token-bucket.js";
export type { TokenBucketRateLimiterOptions } from "./algorithms/token-bucket.js";

// Store
export { MemoryStore } from "./store/memory-store.js";
export type { MemoryStoreOptions } from "./store/memory-store.js";

// Middleware
export {
  createRateLimitMiddleware,
  keyByIp,
  keyByAuthHeader,
  keyByHeader,
} from "./middleware.js";
export type {
  RateLimitRequest,
  KeyExtractor,
  RateLimitMiddlewareResult,
  RateLimitMiddlewareOptions,
} from "./middleware.js";
