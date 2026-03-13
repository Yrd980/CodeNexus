# Cache Strategy

## 解决什么问题

Every startup hits "it's slow" within the first few months. Caching is the first performance lever you should pull — but choosing the wrong strategy leads to stale data bugs, memory leaks, or caches that don't actually help.

This module provides three battle-proven caching strategies with clear trade-offs, a pluggable storage backend, and built-in observability — so you know *if* your cache is working, not just *that* you have one.

## 为什么这样设计

**Three strategies, each for a distinct use case:**

| Strategy | Best For | Trade-off |
|----------|----------|-----------|
| **LRU** (Least Recently Used) | General purpose — hot data stays, cold data goes | Fixed memory, may evict still-useful entries under burst |
| **TTL** (Time-To-Live) | Time-sensitive data — sessions, tokens, API responses | No size limit, needs periodic cleanup |
| **Write-through / Write-behind** | Consistency-critical data + high write throughput | Write-through is slower; write-behind risks data loss on crash |

**Key design decisions:**

1. **Map-based LRU, not doubly-linked list.** JS `Map` preserves insertion order. Delete + re-insert gives O(1) "move to front" without pointer overhead. Simpler, faster, good enough for 99% of startup workloads. (Learned from `isaacs/node-lru-cache`.)

2. **Pluggable `CacheStore` interface.** Tests use `MemoryStore`. Production uses Redis/Memcached. Same cache logic, different backend. Implement `CacheStore<T>` for your infrastructure.

3. **Stats built-in from day one.** "Is the cache working?" is always the first debugging question. Hit rate, miss count, evictions — available via `cache.stats()` without bolting on APM.

4. **Lazy + periodic expiry for TTL.** Lazy expiry (check on access) keeps the hot path fast. Optional periodic cleanup prevents memory bloat from entries nobody reads.

5. **Write-behind batching.** Instead of writing every cache update to the database, buffer writes and flush in batches. Dramatically reduces backend write load. (Learned from Redis persistence patterns.)

## 快速使用

```bash
cd patterns/cache-strategy
npm install
npm test
```

### LRU Cache

```typescript
import { createCache, CacheStrategy } from "./src/index.js";

const cache = createCache<string>({
  maxSize: 1000,
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  strategy: CacheStrategy.LRU,
});

cache.set("user:42", JSON.stringify({ name: "Alice" }));
cache.get("user:42"); // '{"name":"Alice"}'

console.log(cache.stats());
// { hits: 1, misses: 0, evictions: 0, hitRate: 1, size: 1 }
```

### TTL Cache (sessions, tokens)

```typescript
import { createCache, CacheStrategy } from "./src/index.js";

const sessions = createCache<string>(
  {
    maxSize: 0, // ignored for TTL_ONLY
    defaultTTL: 30 * 60 * 1000, // 30 minutes
    strategy: CacheStrategy.TTL_ONLY,
  },
  undefined,
  60_000, // cleanup every 60s
);

sessions.set("sess:abc123", JSON.stringify({ userId: 42 }));
```

### Write-Through (consistent reads)

```typescript
import { LRUCache, WriteThroughCache } from "./src/index.js";
import type { PersistenceBackend } from "./src/types.js";

// Implement for your database
const dbBackend: PersistenceBackend<string> = {
  read: async (key) => db.get(key),
  write: async (key, value) => db.set(key, value),
  writeBatch: async (entries) => db.batchSet(entries),
  remove: async (key) => db.delete(key),
};

const inner = new LRUCache<string>({ maxSize: 5000, defaultTTL: 0, strategy: "LRU" as any });
const cache = new WriteThroughCache(inner, dbBackend, {
  flushInterval: 0, // write-through (sync)
  maxBatchSize: 100,
});

await cache.set("user:1", "Alice"); // writes to cache AND db
await cache.get("user:1");          // reads from cache (fast)
await cache.get("user:999");        // cache miss → reads from db → populates cache
```

### Write-Behind (high throughput)

```typescript
const analyticsCache = new WriteThroughCache(inner, dbBackend, {
  flushInterval: 5000,   // flush every 5 seconds
  maxBatchSize: 200,     // or when 200 writes are pending
});

await analyticsCache.set("views:page1", "1042"); // instant (cache only)
// Backend receives batched writes every 5s

// On shutdown:
await analyticsCache.destroy(); // flushes remaining + stops timer
```

## 配置项

### CacheConfig

| 参数 | 类型 | 说明 |
|------|------|------|
| `maxSize` | `number` | 最大条目数 (TTL_ONLY 策略忽略) |
| `defaultTTL` | `number` | 默认过期时间(ms), 0 = 不过期 |
| `strategy` | `CacheStrategy` | `LRU`, `LFU`, `TTL_ONLY` |
| `onEvict` | `(key, value) => void` | 条目被驱逐时的回调 |

### WriteThroughConfig

| 参数 | 类型 | 说明 |
|------|------|------|
| `flushInterval` | `number` | 批量写入间隔(ms), 0 = write-through 模式 |
| `maxBatchSize` | `number` | 触发强制刷新的批量大小 |

### CacheStore Interface

实现此接口以支持任何存储后端 (Redis, SQLite, etc.):

```typescript
interface CacheStore<T> {
  get(key: string): CacheEntry<T> | undefined;
  set(key: string, entry: CacheEntry<T>): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  clear(): void;
  size(): number;
  keys(): IterableIterator<string>;
}
```

## 来源 & 致谢

| 项目 | 学到了什么 |
|------|-----------|
| [isaacs/node-lru-cache](https://github.com/isaacs/node-lru-cache) | Map-based LRU 在 JS 中给出 O(1) 复杂度，无需双向链表 |
| [Redis](https://redis.io) | Write-behind 批量写入大幅降低后端写入负载 |
| [Cloudflare Caching](https://developers.cloudflare.com/cache/) | TTL 分层策略的实践经验 |

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本：LRU + TTL + Write-through/behind | Startup 最常用的三种缓存模式，覆盖 80% 的场景 |
