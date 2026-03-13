/**
 * LRU (Least Recently Used) Cache
 *
 * O(1) get/set using Map's insertion-order guarantee in JS engines.
 * When capacity is reached, the least recently accessed entry is evicted.
 *
 * Why Map-based LRU instead of doubly-linked list?
 * - JS Map preserves insertion order and delete+re-insert is O(1)
 * - No pointer overhead, better cache locality, simpler code
 * - Good enough for the vast majority of startup use cases
 * - If you need >1M entries, consider native C++ addons (node-lru-cache)
 */

import type { Cache, CacheConfig, CacheEntry, CacheStats, CacheStore } from "./types.js";
import { MemoryStore } from "./store/memory-store.js";

export class LRUCache<T> implements Cache<T> {
  private store: CacheStore<T>;
  private config: CacheConfig;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(config: CacheConfig, store?: CacheStore<T>) {
    if (config.maxSize < 1) {
      throw new Error("maxSize must be at least 1");
    }
    this.config = config;
    this.store = store ?? new MemoryStore<T>();
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check TTL expiry
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.evict(key, entry);
      this._misses++;
      return undefined;
    }

    // Move to end (most recently used) by delete + re-insert
    this.store.delete(key);
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
    const now = Date.now();

    // If key already exists, delete it first (to update position in Map)
    if (this.store.has(key)) {
      this.store.delete(key);
    } else {
      // Evict LRU entry if at capacity
      this.ensureCapacity();
    }

    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: effectiveTTL > 0 ? now + effectiveTTL : null,
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
    if (entry && entry.expiresAt !== null && Date.now() > entry.expiresAt) {
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

  prune(): number {
    const now = Date.now();
    let pruned = 0;
    const keysToDelete: string[] = [];

    for (const key of this.store.keys()) {
      const entry = this.store.get(key);
      if (entry && entry.expiresAt !== null && now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.store.get(key);
      if (entry) {
        this.evict(key, entry);
        pruned++;
      }
    }

    return pruned;
  }

  /** Evict the least recently used entry (first key in Map = oldest) */
  private ensureCapacity(): void {
    while (this.store.size() >= this.config.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;

      const entry = this.store.get(oldestKey);
      if (entry) {
        this.evict(oldestKey, entry);
      }
    }
  }

  private evict(key: string, entry: CacheEntry<T>): void {
    this.store.delete(key);
    this._evictions++;
    this.config.onEvict?.(key, entry.value);
  }
}
