/**
 * TTL (Time-To-Live) Cache
 *
 * Time-based expiry without size limit enforcement.
 * Every entry must have a TTL — no eternal entries.
 *
 * Expiry model:
 * - **Lazy**: Expired entries are removed on access (get/has)
 * - **Periodic**: Optional cleanup timer removes expired entries in bulk
 *
 * Use for: session tokens, API response caching, rate limit windows,
 * anything where "stale after X seconds" is the primary concern.
 */

import type { Cache, CacheConfig, CacheEntry, CacheStats, CacheStore } from "./types.js";
import { MemoryStore } from "./store/memory-store.js";

export class TTLCache<T> implements Cache<T> {
  private store: CacheStore<T>;
  private config: CacheConfig;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param config Cache config. defaultTTL must be > 0 for TTL_ONLY strategy.
   * @param store Optional custom store backend.
   * @param cleanupIntervalMs If > 0, run periodic cleanup at this interval.
   */
  constructor(
    config: CacheConfig,
    store?: CacheStore<T>,
    cleanupIntervalMs = 0,
  ) {
    if (config.defaultTTL <= 0) {
      throw new Error("TTL cache requires defaultTTL > 0");
    }
    this.config = config;
    this.store = store ?? new MemoryStore<T>();

    if (cleanupIntervalMs > 0) {
      this.startPeriodicCleanup(cleanupIntervalMs);
    }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Lazy expiry check
    if (this.isExpired(entry)) {
      this.evict(key, entry);
      this._misses++;
      return undefined;
    }

    // Update access metadata (no reordering needed — TTL doesn't care about recency)
    const updated: CacheEntry<T> = {
      ...entry,
      accessCount: entry.accessCount + 1,
      lastAccessed: Date.now(),
    };
    this.store.set(key, updated);

    this._hits++;
    return updated.value;
  }

  set(key: string, value: T, ttl?: number): void {
    const effectiveTTL = ttl ?? this.config.defaultTTL;

    if (effectiveTTL <= 0) {
      throw new Error("TTL must be > 0 for TTL cache");
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + effectiveTTL,
      accessCount: 0,
      lastAccessed: now,
    };

    this.store.set(key, entry);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    if (!this.store.has(key)) return false;

    const entry = this.store.get(key);
    if (entry && this.isExpired(entry)) {
      this.evict(key, entry);
      return false;
    }
    return true;
  }

  clear(): void {
    this.store.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      hitRate: total === 0 ? 0 : this._hits / total,
      size: this.store.size(),
    };
  }

  /**
   * Actively prune all expired entries.
   * @returns Number of entries removed.
   */
  prune(): number {
    const keysToDelete: string[] = [];

    for (const key of this.store.keys()) {
      const entry = this.store.get(key);
      if (entry && this.isExpired(entry)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.store.get(key);
      if (entry) {
        this.evict(key, entry);
      }
    }

    return keysToDelete.length;
  }

  /** Stop the periodic cleanup timer (call on shutdown) */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private evict(key: string, entry: CacheEntry<T>): void {
    this.store.delete(key);
    this._evictions++;
    this.config.onEvict?.(key, entry.value);
  }

  private startPeriodicCleanup(intervalMs: number): void {
    this.cleanupTimer = setInterval(() => {
      this.prune();
    }, intervalMs);

    // Allow Node to exit even if timer is running
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }
}
