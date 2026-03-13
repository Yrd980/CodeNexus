/**
 * In-Memory Cache Store
 *
 * Simple Map-backed implementation of CacheStore.
 * Use for tests, development, and single-process apps.
 * For production multi-instance setups, implement CacheStore with Redis.
 */

import type { CacheEntry, CacheStore } from "../types.js";

export class MemoryStore<T> implements CacheStore<T> {
  private store: Map<string, CacheEntry<T>>;

  constructor() {
    this.store = new Map();
  }

  get(key: string): CacheEntry<T> | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: CacheEntry<T>): void {
    this.store.set(key, entry);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }
}
