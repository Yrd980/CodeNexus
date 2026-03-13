/**
 * In-Memory Rate Limiter Store
 *
 * A Map-backed store with TTL-based expiry and periodic cleanup.
 * Suitable for single-process / development use. For production distributed
 * systems, plug in a Redis-backed store that implements the same interface.
 */

import type { RateLimiterStore } from "../types.js";

interface Entry {
  value: string;
  expiresAt: number;
}

export interface MemoryStoreOptions {
  /**
   * How often (ms) the store scans for expired entries.
   * Default: 60 000 (1 minute).
   */
  cleanupIntervalMs?: number;
}

export class MemoryStore implements RateLimiterStore {
  private readonly data = new Map<string, Entry>();
  private readonly cleanupTimer: ReturnType<typeof setInterval> | null;

  constructor(options: MemoryStoreOptions = {}) {
    const intervalMs = options.cleanupIntervalMs ?? 60_000;

    if (intervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
      // Allow the process to exit even if the timer is still running.
      if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
        this.cleanupTimer.unref();
      }
    } else {
      this.cleanupTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // RateLimiterStore implementation
  // -----------------------------------------------------------------------

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async increment(key: string, amount: number, ttlMs: number): Promise<number> {
    const existing = this.data.get(key);
    const now = Date.now();

    if (existing && now < existing.expiresAt) {
      const newValue = Number(existing.value) + amount;
      existing.value = String(newValue);
      return newValue;
    }

    // Key missing or expired — create fresh.
    this.data.set(key, {
      value: String(amount),
      expiresAt: now + ttlMs,
    });
    return amount;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  // -----------------------------------------------------------------------
  // Lifecycle helpers
  // -----------------------------------------------------------------------

  /** Remove all expired entries. Called automatically on the cleanup interval. */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.data) {
      if (now >= entry.expiresAt) {
        this.data.delete(key);
      }
    }
  }

  /** Stop the periodic cleanup timer and clear all data. */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
    }
    this.data.clear();
  }

  /** Number of (possibly expired) entries currently held. Useful for tests. */
  get size(): number {
    return this.data.size;
  }
}
