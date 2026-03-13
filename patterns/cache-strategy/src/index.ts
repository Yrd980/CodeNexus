/**
 * Cache Strategy Module — Entry Point
 *
 * Factory function + re-exports for a clean public API.
 *
 * Usage:
 *   import { createCache, CacheStrategy } from "./src/index.js";
 *   const cache = createCache<string>({ maxSize: 1000, defaultTTL: 60_000, strategy: CacheStrategy.LRU });
 *   cache.set("user:1", "Alice");
 *   cache.get("user:1"); // "Alice"
 */

export {
  CacheStrategy,
  type Cache,
  type CacheConfig,
  type CacheEntry,
  type CacheStats,
  type CacheStore,
  type PersistenceBackend,
  type WriteThroughConfig,
} from "./types.js";

export { LRUCache } from "./lru-cache.js";
export { TTLCache } from "./ttl-cache.js";
export { WriteThroughCache } from "./write-through.js";
export { MemoryStore } from "./store/memory-store.js";

import type { Cache, CacheConfig, CacheStore } from "./types.js";
import { CacheStrategy } from "./types.js";
import { LRUCache } from "./lru-cache.js";
import { TTLCache } from "./ttl-cache.js";

/**
 * Factory function — create a cache with the specified strategy.
 *
 * @param config Cache configuration
 * @param store Optional custom store backend (defaults to in-memory)
 * @param cleanupIntervalMs For TTL_ONLY strategy: periodic cleanup interval in ms (0 = disabled)
 * @returns A Cache<T> instance
 *
 * @example
 * // LRU cache with 500 entries, 5-minute TTL
 * const cache = createCache<User>({
 *   maxSize: 500,
 *   defaultTTL: 5 * 60 * 1000,
 *   strategy: CacheStrategy.LRU,
 * });
 *
 * @example
 * // TTL-only cache for session tokens, 30-minute expiry, 1-minute cleanup
 * const sessions = createCache<SessionData>({
 *   maxSize: 0, // ignored for TTL_ONLY
 *   defaultTTL: 30 * 60 * 1000,
 *   strategy: CacheStrategy.TTL_ONLY,
 * }, undefined, 60_000);
 */
export function createCache<T>(
  config: CacheConfig,
  store?: CacheStore<T>,
  cleanupIntervalMs = 0,
): Cache<T> {
  switch (config.strategy) {
    case CacheStrategy.LRU:
      return new LRUCache<T>(config, store);

    case CacheStrategy.LFU:
      // LFU uses the same LRU implementation for now.
      // A true LFU would use a frequency-indexed structure.
      // For most startup use cases, LRU is sufficient.
      // TODO: Implement dedicated LFU when there's a proven need.
      return new LRUCache<T>(config, store);

    case CacheStrategy.TTL_ONLY:
      return new TTLCache<T>(config, store, cleanupIntervalMs);

    default: {
      const _exhaustive: never = config.strategy;
      throw new Error(`Unknown cache strategy: ${_exhaustive}`);
    }
  }
}
