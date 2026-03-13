/**
 * Write-Through / Write-Behind Cache
 *
 * Wraps any Cache<T> with a persistence backend to keep cache and storage in sync.
 *
 * Two modes:
 * - **Write-through**: Every write goes to cache AND backend synchronously.
 *   Consistent but slower writes. Use for user profiles, account settings.
 *
 * - **Write-behind**: Writes go to cache immediately; backend writes are batched
 *   and flushed asynchronously. Faster writes but risk of data loss on crash.
 *   Use for analytics, view counts, activity logs.
 *
 * Read path (cache-aside):
 *   1. Check cache
 *   2. On miss: read from backend, populate cache, return
 */

import type {
  Cache,
  CacheStats,
  PersistenceBackend,
  WriteThroughConfig,
} from "./types.js";

export class WriteThroughCache<T> {
  private cache: Cache<T>;
  private backend: PersistenceBackend<T>;
  private config: WriteThroughConfig;

  /** Pending writes for write-behind mode */
  private pendingWrites: Map<string, T> = new Map();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private _flushCount = 0;

  constructor(
    cache: Cache<T>,
    backend: PersistenceBackend<T>,
    config: WriteThroughConfig = { flushInterval: 0, maxBatchSize: 100 },
  ) {
    this.cache = cache;
    this.backend = backend;
    this.config = config;

    if (this.isWriteBehind()) {
      this.startFlushTimer();
    }
  }

  /**
   * Read with cache-aside pattern:
   * 1. Check cache (fast path)
   * 2. On miss: read from backend, populate cache
   */
  async get(key: string): Promise<T | undefined> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Cache miss — read from backend
    const value = await this.backend.read(key);
    if (value !== undefined) {
      // Populate cache for next access
      this.cache.set(key, value);
    }

    return value;
  }

  /**
   * Write to cache and backend.
   * - Write-through: await backend write (consistent)
   * - Write-behind: buffer for batch flush (fast)
   */
  async set(key: string, value: T, ttl?: number): Promise<void> {
    // Always write to cache immediately
    this.cache.set(key, value, ttl);

    if (this.isWriteBehind()) {
      // Buffer for async batch write
      this.pendingWrites.set(key, value);

      // Force flush if batch is full
      if (this.pendingWrites.size >= this.config.maxBatchSize) {
        await this.flush();
      }
    } else {
      // Write-through: sync write to backend
      await this.backend.write(key, value);
    }
  }

  /**
   * Delete from cache and backend.
   * For write-behind: also remove from pending writes to avoid writing stale data.
   */
  async delete(key: string): Promise<boolean> {
    const existed = this.cache.delete(key);
    this.pendingWrites.delete(key);
    await this.backend.remove(key);
    return existed;
  }

  /** Check if a key exists in cache (does not check backend) */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /** Clear cache and pending writes. Does NOT clear the backend. */
  clear(): void {
    this.cache.clear();
    this.pendingWrites.clear();
  }

  /** Get underlying cache stats */
  stats(): CacheStats & { pendingWrites: number; flushCount: number } {
    return {
      ...this.cache.stats(),
      pendingWrites: this.pendingWrites.size,
      flushCount: this._flushCount,
    };
  }

  /** Force flush all pending writes to backend (write-behind mode) */
  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return;

    const entries = Array.from(this.pendingWrites.entries()).map(
      ([key, value]) => ({ key, value }),
    );
    this.pendingWrites.clear();

    await this.backend.writeBatch(entries);
    this._flushCount++;
  }

  /** Stop the flush timer and flush remaining writes. Call on shutdown. */
  async destroy(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Flush any remaining pending writes
    await this.flush();
  }

  /** Number of entries waiting to be flushed to backend */
  get pendingCount(): number {
    return this.pendingWrites.size;
  }

  private isWriteBehind(): boolean {
    return this.config.flushInterval > 0;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      // Fire-and-forget — errors should be handled by the backend implementation
      void this.flush();
    }, this.config.flushInterval);

    // Allow Node to exit even if timer is running
    if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
      this.flushTimer.unref();
    }
  }
}
