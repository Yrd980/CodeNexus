import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCache,
  CacheStrategy,
  LRUCache,
  TTLCache,
  WriteThroughCache,
  MemoryStore,
} from "../src/index.js";
import type { CacheConfig, PersistenceBackend } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lruConfig(overrides: Partial<CacheConfig> = {}): CacheConfig {
  return {
    maxSize: 3,
    defaultTTL: 0,
    strategy: CacheStrategy.LRU,
    ...overrides,
  };
}

function ttlConfig(overrides: Partial<CacheConfig> = {}): CacheConfig {
  return {
    maxSize: 0,
    defaultTTL: 1000,
    strategy: CacheStrategy.TTL_ONLY,
    ...overrides,
  };
}

/** In-memory mock persistence backend for write-through tests */
function mockBackend<T>(): PersistenceBackend<T> & { data: Map<string, T> } {
  const data = new Map<string, T>();
  return {
    data,
    read: vi.fn(async (key: string) => data.get(key)),
    write: vi.fn(async (key: string, value: T) => {
      data.set(key, value);
    }),
    writeBatch: vi.fn(async (entries: Array<{ key: string; value: T }>) => {
      for (const { key, value } of entries) {
        data.set(key, value);
      }
    }),
    remove: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
}

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

describe("LRUCache", () => {
  it("should store and retrieve values", () => {
    const cache = new LRUCache<string>(lruConfig());
    cache.set("a", "alpha");
    expect(cache.get("a")).toBe("alpha");
  });

  it("should return undefined for missing keys", () => {
    const cache = new LRUCache<string>(lruConfig());
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should evict least recently used entry when maxSize is exceeded", () => {
    const cache = new LRUCache<string>(lruConfig({ maxSize: 2 }));
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3"); // should evict "a"

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("should update recency on access — accessed entry survives eviction", () => {
    const cache = new LRUCache<string>(lruConfig({ maxSize: 2 }));
    cache.set("a", "1");
    cache.set("b", "2");

    // Access "a" to make it recently used
    cache.get("a");

    // Insert "c" — should evict "b" (least recently used), not "a"
    cache.set("c", "3");

    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
  });

  it("should enforce maxSize strictly", () => {
    const cache = new LRUCache<number>(lruConfig({ maxSize: 3 }));
    for (let i = 0; i < 100; i++) {
      cache.set(`key-${i}`, i);
    }
    expect(cache.stats().size).toBe(3);
  });

  it("should expire entries based on TTL", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(lruConfig({ defaultTTL: 100 }));
    cache.set("a", "1");

    // Before expiry
    expect(cache.get("a")).toBe("1");

    // After expiry
    vi.advanceTimersByTime(150);
    expect(cache.get("a")).toBeUndefined();

    vi.useRealTimers();
  });

  it("should support per-entry TTL override", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(lruConfig({ defaultTTL: 1000 }));
    cache.set("short", "gone soon", 50);
    cache.set("long", "stays", 5000);

    vi.advanceTimersByTime(100);

    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("long")).toBe("stays");

    vi.useRealTimers();
  });

  it("should call onEvict callback when entry is evicted", () => {
    const evicted: Array<{ key: string; value: string }> = [];
    const cache = new LRUCache<string>(
      lruConfig({
        maxSize: 1,
        onEvict: (key, value) => {
          evicted.push({ key, value: value as string });
        },
      }),
    );

    cache.set("a", "1");
    cache.set("b", "2"); // evicts "a"

    expect(evicted).toEqual([{ key: "a", value: "1" }]);
  });

  it("should correctly report has() with TTL expiry", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(lruConfig({ defaultTTL: 50 }));
    cache.set("a", "1");

    expect(cache.has("a")).toBe(true);

    vi.advanceTimersByTime(100);
    expect(cache.has("a")).toBe(false);

    vi.useRealTimers();
  });

  it("should prune expired entries", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(lruConfig({ maxSize: 10, defaultTTL: 50 }));
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    vi.advanceTimersByTime(100);
    const pruned = cache.prune();

    expect(pruned).toBe(3);
    expect(cache.stats().size).toBe(0);

    vi.useRealTimers();
  });

  it("should throw if maxSize < 1", () => {
    expect(() => new LRUCache<string>(lruConfig({ maxSize: 0 }))).toThrow(
      "maxSize must be at least 1",
    );
  });

  it("should handle updating an existing key without double-counting size", () => {
    const cache = new LRUCache<string>(lruConfig({ maxSize: 2 }));
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("a", "updated"); // update, not insert

    expect(cache.stats().size).toBe(2);
    expect(cache.get("a")).toBe("updated");
  });

  it("should delete entries", () => {
    const cache = new LRUCache<string>(lruConfig());
    cache.set("a", "1");
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.delete("nonexistent")).toBe(false);
  });

  it("should clear all entries and reset stats", () => {
    const cache = new LRUCache<string>(lruConfig());
    cache.set("a", "1");
    cache.get("a");
    cache.get("miss");
    cache.clear();

    const s = cache.stats();
    expect(s.size).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TTL Cache
// ---------------------------------------------------------------------------

describe("TTLCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should store and retrieve values before expiry", () => {
    const cache = new TTLCache<string>(ttlConfig());
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
  });

  it("should expire entries after TTL", () => {
    vi.useFakeTimers();
    const cache = new TTLCache<string>(ttlConfig({ defaultTTL: 100 }));
    cache.set("a", "1");

    vi.advanceTimersByTime(150);
    expect(cache.get("a")).toBeUndefined();
  });

  it("should lazily remove expired entries on access", () => {
    vi.useFakeTimers();
    const cache = new TTLCache<string>(ttlConfig({ defaultTTL: 100 }));
    cache.set("a", "1");

    vi.advanceTimersByTime(150);

    // Entry is still in store until accessed
    expect(cache.get("a")).toBeUndefined();
    // Now it should be evicted
    expect(cache.stats().evictions).toBe(1);
  });

  it("should run periodic cleanup", () => {
    vi.useFakeTimers();
    const cache = new TTLCache<string>(
      ttlConfig({ defaultTTL: 100 }),
      undefined,
      200, // cleanup every 200ms
    );

    cache.set("a", "1");
    cache.set("b", "2");

    vi.advanceTimersByTime(150); // entries expired
    vi.advanceTimersByTime(200); // cleanup runs

    expect(cache.stats().size).toBe(0);
    expect(cache.stats().evictions).toBe(2);

    cache.destroy();
  });

  it("should throw if defaultTTL <= 0", () => {
    expect(
      () => new TTLCache<string>(ttlConfig({ defaultTTL: 0 })),
    ).toThrow("TTL cache requires defaultTTL > 0");
  });

  it("should throw if per-entry TTL is <= 0", () => {
    const cache = new TTLCache<string>(ttlConfig());
    expect(() => cache.set("a", "1", 0)).toThrow("TTL must be > 0");
    expect(() => cache.set("a", "1", -100)).toThrow("TTL must be > 0");
  });

  it("should prune all expired entries", () => {
    vi.useFakeTimers();
    const cache = new TTLCache<string>(ttlConfig({ defaultTTL: 50 }));
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    vi.advanceTimersByTime(100);
    const pruned = cache.prune();

    expect(pruned).toBe(3);
    expect(cache.stats().size).toBe(0);
  });

  it("should support per-entry TTL override", () => {
    vi.useFakeTimers();
    const cache = new TTLCache<string>(ttlConfig({ defaultTTL: 1000 }));
    cache.set("short", "gone", 50);
    cache.set("long", "here", 5000);

    vi.advanceTimersByTime(100);

    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("long")).toBe("here");
  });

  it("should correctly report has() with expired entries", () => {
    vi.useFakeTimers();
    const cache = new TTLCache<string>(ttlConfig({ defaultTTL: 50 }));
    cache.set("a", "1");

    expect(cache.has("a")).toBe(true);

    vi.advanceTimersByTime(100);
    expect(cache.has("a")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Write-Through Cache
// ---------------------------------------------------------------------------

describe("WriteThroughCache", () => {
  describe("write-through mode (flushInterval = 0)", () => {
    it("should write to both cache and backend synchronously", async () => {
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 0,
        maxBatchSize: 100,
      });

      await cache.set("user:1", "Alice");

      // In cache
      expect(cache.has("user:1")).toBe(true);
      // In backend
      expect(backend.data.get("user:1")).toBe("Alice");
      expect(backend.write).toHaveBeenCalledWith("user:1", "Alice");
    });

    it("should read-through on cache miss", async () => {
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      backend.data.set("user:1", "Alice");

      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 0,
        maxBatchSize: 100,
      });

      // First access: miss + backend read + populate cache
      const value = await cache.get("user:1");
      expect(value).toBe("Alice");
      expect(backend.read).toHaveBeenCalledWith("user:1");

      // Second access: cache hit, no backend call
      const value2 = await cache.get("user:1");
      expect(value2).toBe("Alice");
      expect(backend.read).toHaveBeenCalledTimes(1);
    });

    it("should delete from both cache and backend", async () => {
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 0,
        maxBatchSize: 100,
      });

      await cache.set("a", "1");
      await cache.delete("a");

      expect(cache.has("a")).toBe(false);
      expect(backend.data.has("a")).toBe(false);
      expect(backend.remove).toHaveBeenCalledWith("a");
    });
  });

  describe("write-behind mode (flushInterval > 0)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("should buffer writes and flush as a batch", async () => {
      vi.useFakeTimers();
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 1000,
        maxBatchSize: 100,
      });

      await cache.set("a", "1");
      await cache.set("b", "2");

      // Not yet written to backend
      expect(backend.writeBatch).not.toHaveBeenCalled();
      expect(cache.pendingCount).toBe(2);

      // Trigger flush
      vi.advanceTimersByTime(1000);

      // Need to wait for the async flush to complete
      await vi.waitFor(() => {
        expect(backend.writeBatch).toHaveBeenCalledTimes(1);
      });

      expect(backend.data.get("a")).toBe("1");
      expect(backend.data.get("b")).toBe("2");

      await cache.destroy();
    });

    it("should force flush when maxBatchSize is reached", async () => {
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 60_000, // very long — shouldn't trigger
        maxBatchSize: 2,
      });

      await cache.set("a", "1");
      await cache.set("b", "2"); // hits maxBatchSize, triggers flush

      expect(backend.writeBatch).toHaveBeenCalledTimes(1);

      await cache.destroy();
    });

    it("should flush remaining writes on destroy", async () => {
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 60_000,
        maxBatchSize: 1000,
      });

      await cache.set("a", "1");
      expect(cache.pendingCount).toBe(1);

      await cache.destroy();

      expect(backend.writeBatch).toHaveBeenCalledTimes(1);
      expect(backend.data.get("a")).toBe("1");
    });

    it("should deduplicate pending writes (last write wins)", async () => {
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 60_000,
        maxBatchSize: 1000,
      });

      await cache.set("a", "first");
      await cache.set("a", "second");
      expect(cache.pendingCount).toBe(1); // Map deduplicates

      await cache.flush();

      expect(backend.data.get("a")).toBe("second");

      await cache.destroy();
    });
  });

  describe("stats", () => {
    it("should include pending writes and flush count", async () => {
      const inner = new LRUCache<string>(lruConfig({ maxSize: 100 }));
      const backend = mockBackend<string>();
      const cache = new WriteThroughCache(inner, backend, {
        flushInterval: 60_000,
        maxBatchSize: 1000,
      });

      await cache.set("a", "1");
      const s1 = cache.stats();
      expect(s1.pendingWrites).toBe(1);
      expect(s1.flushCount).toBe(0);

      await cache.flush();
      const s2 = cache.stats();
      expect(s2.pendingWrites).toBe(0);
      expect(s2.flushCount).toBe(1);

      await cache.destroy();
    });
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe("CacheStats", () => {
  it("should track hits and misses", () => {
    const cache = new LRUCache<string>(lruConfig());
    cache.set("a", "1");

    cache.get("a"); // hit
    cache.get("a"); // hit
    cache.get("b"); // miss

    const s = cache.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
  });

  it("should calculate hit rate correctly", () => {
    const cache = new LRUCache<string>(lruConfig({ maxSize: 10 }));
    cache.set("a", "1");

    cache.get("a"); // hit
    cache.get("a"); // hit
    cache.get("a"); // hit
    cache.get("miss"); // miss

    expect(cache.stats().hitRate).toBeCloseTo(0.75);
  });

  it("should return 0 hit rate when no requests", () => {
    const cache = new LRUCache<string>(lruConfig());
    expect(cache.stats().hitRate).toBe(0);
  });

  it("should track evictions", () => {
    const cache = new LRUCache<string>(lruConfig({ maxSize: 1 }));
    cache.set("a", "1");
    cache.set("b", "2"); // evicts "a"
    cache.set("c", "3"); // evicts "b"

    expect(cache.stats().evictions).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

describe("createCache factory", () => {
  it("should create LRU cache", () => {
    const cache = createCache<string>({
      maxSize: 10,
      defaultTTL: 0,
      strategy: CacheStrategy.LRU,
    });
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
  });

  it("should create TTL cache", () => {
    const cache = createCache<string>({
      maxSize: 0,
      defaultTTL: 60_000,
      strategy: CacheStrategy.TTL_ONLY,
    });
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
  });

  it("should create LFU cache (falls back to LRU)", () => {
    const cache = createCache<string>({
      maxSize: 10,
      defaultTTL: 0,
      strategy: CacheStrategy.LFU,
    });
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
  });

  it("should accept a custom store", () => {
    const store = new MemoryStore<string>();
    const cache = createCache<string>(
      { maxSize: 5, defaultTTL: 0, strategy: CacheStrategy.LRU },
      store,
    );
    cache.set("a", "1");
    expect(store.has("a")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

describe("MemoryStore", () => {
  it("should implement all CacheStore methods", () => {
    const store = new MemoryStore<string>();
    const entry = {
      value: "test",
      createdAt: Date.now(),
      expiresAt: null,
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    store.set("a", entry);
    expect(store.has("a")).toBe(true);
    expect(store.get("a")).toEqual(entry);
    expect(store.size()).toBe(1);

    const keys = Array.from(store.keys());
    expect(keys).toEqual(["a"]);

    store.delete("a");
    expect(store.has("a")).toBe(false);

    store.set("b", entry);
    store.clear();
    expect(store.size()).toBe(0);
  });
});
