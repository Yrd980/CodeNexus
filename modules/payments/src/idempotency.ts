import { randomUUID } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

interface IdempotencyRecord<T> {
  readonly key: string;
  readonly result: T;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface IdempotencyStoreOptions {
  /** Time-to-live for idempotency records in milliseconds. Default: 24 hours. */
  readonly ttlMs?: number;
}

// ─── Idempotency Store ───────────────────────────────────────────────────────

/**
 * In-memory idempotency store.
 *
 * In production, replace this with a Redis- or database-backed store.
 * The interface is intentionally simple: set / get / has / delete.
 */
export class IdempotencyStore<T = unknown> {
  private readonly records = new Map<string, IdempotencyRecord<T>>();
  private readonly ttlMs: number;

  constructor(options: IdempotencyStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000; // 24 hours
  }

  /** Store a result for the given key. */
  set(key: string, result: T): void {
    const now = Date.now();
    this.records.set(key, {
      key,
      result,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });
  }

  /** Retrieve a stored result. Returns `undefined` if missing or expired. */
  get(key: string): T | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;

    if (Date.now() >= record.expiresAt) {
      this.records.delete(key);
      return undefined;
    }

    return record.result;
  }

  /** Check whether a non-expired record exists for the key. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Remove a record. */
  delete(key: string): boolean {
    return this.records.delete(key);
  }

  /** Remove all expired records. Call periodically to reclaim memory. */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, record] of this.records) {
      if (now >= record.expiresAt) {
        this.records.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /** Number of currently stored (including possibly expired) records. */
  get size(): number {
    return this.records.size;
  }

  /** Clear all records. */
  clear(): void {
    this.records.clear();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a random idempotency key. */
export function generateIdempotencyKey(): string {
  return `idem_${randomUUID()}`;
}

/**
 * Wrap an async operation so that repeated calls with the same key
 * return the original result instead of executing again.
 *
 * @example
 * ```ts
 * const store = new IdempotencyStore<Charge>();
 * const charge = await idempotent(store, key, () => provider.createCharge(params));
 * // calling again with the same key returns the cached charge
 * ```
 */
export async function idempotent<T>(
  store: IdempotencyStore<T>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = store.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const result = await operation();
  store.set(key, result);
  return result;
}
