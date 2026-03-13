/**
 * Cache Strategy — Type Definitions
 *
 * Core types for a pluggable, multi-strategy caching system.
 * Designed to be storage-agnostic: implement CacheStore<T> for any backend.
 */

/** Available eviction/expiry strategies */
export enum CacheStrategy {
  /** Least Recently Used — evicts the entry that hasn't been accessed the longest */
  LRU = "LRU",
  /** Least Frequently Used — evicts the entry with the fewest accesses */
  LFU = "LFU",
  /** Time-To-Live Only — no size limit, entries expire by time */
  TTL_ONLY = "TTL_ONLY",
}

/** Configuration for cache creation */
export interface CacheConfig {
  /** Maximum number of entries (ignored for TTL_ONLY strategy) */
  maxSize: number;
  /** Default TTL in milliseconds. 0 = no expiry. */
  defaultTTL: number;
  /** Eviction strategy */
  strategy: CacheStrategy;
  /** Called when an entry is evicted (for cleanup, logging, metrics) */
  onEvict?: <T>(key: string, value: T) => void;
}

/** Internal representation of a cached value */
export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  lastAccessed: number;
}

/**
 * Pluggable storage backend interface.
 *
 * Implement this for any backend: in-memory Map, Redis, SQLite, etc.
 * The cache strategies operate on CacheStore without caring about persistence.
 */
export interface CacheStore<T> {
  get(key: string): CacheEntry<T> | undefined;
  set(key: string, entry: CacheEntry<T>): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  clear(): void;
  size(): number;
  keys(): IterableIterator<string>;
}

/** Runtime statistics for cache observability */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  /** Computed hit rate: hits / (hits + misses). Returns 0 if no requests yet. */
  hitRate: number;
  /** Current number of entries in the cache */
  size: number;
}

/**
 * Unified cache interface returned by all strategy constructors.
 * Consumers interact only with this — the strategy is an implementation detail.
 */
export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttl?: number): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  clear(): void;
  stats(): CacheStats;
  /** Actively remove all expired entries (instead of waiting for lazy cleanup) */
  prune(): number;
}

/** Persistence backend for write-through/write-behind patterns */
export interface PersistenceBackend<T> {
  read(key: string): Promise<T | undefined>;
  write(key: string, value: T): Promise<void>;
  writeBatch(entries: Array<{ key: string; value: T }>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Configuration for write-through/write-behind cache */
export interface WriteThroughConfig {
  /** Write-behind flush interval in ms. 0 = write-through (synchronous). */
  flushInterval: number;
  /** Max entries to batch before forcing a flush (write-behind only) */
  maxBatchSize: number;
}
