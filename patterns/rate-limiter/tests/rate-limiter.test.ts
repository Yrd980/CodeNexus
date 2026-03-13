import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixedWindowRateLimiter } from "../src/algorithms/fixed-window.js";
import { SlidingWindowRateLimiter } from "../src/algorithms/sliding-window.js";
import { TokenBucketRateLimiter } from "../src/algorithms/token-bucket.js";
import { MemoryStore } from "../src/store/memory-store.js";
import {
  createRateLimitMiddleware,
  keyByAuthHeader,
  keyByHeader,
  keyByIp,
} from "../src/middleware.js";
import type { RateLimitRequest } from "../src/middleware.js";

// ---------------------------------------------------------------------------
// Memory Store
// ---------------------------------------------------------------------------

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ cleanupIntervalMs: 0 });
  });

  afterEach(() => {
    store.destroy();
  });

  it("returns null for a missing key", async () => {
    expect(await store.get("nonexistent")).toBeNull();
  });

  it("stores and retrieves a value", async () => {
    await store.set("key1", "hello", 10_000);
    expect(await store.get("key1")).toBe("hello");
  });

  it("expires entries after TTL", async () => {
    vi.useFakeTimers();
    try {
      await store.set("ephemeral", "value", 500);
      expect(await store.get("ephemeral")).toBe("value");

      vi.advanceTimersByTime(600);
      expect(await store.get("ephemeral")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("increments a counter atomically", async () => {
    const v1 = await store.increment("counter", 1, 10_000);
    expect(v1).toBe(1);

    const v2 = await store.increment("counter", 5, 10_000);
    expect(v2).toBe(6);
  });

  it("creates a new counter on increment if key is missing", async () => {
    const v = await store.increment("fresh", 3, 10_000);
    expect(v).toBe(3);
  });

  it("resets expired counter on increment", async () => {
    vi.useFakeTimers();
    try {
      await store.increment("x", 10, 500);
      vi.advanceTimersByTime(600);
      const v = await store.increment("x", 1, 500);
      expect(v).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes a key", async () => {
    await store.set("doomed", "bye", 10_000);
    await store.delete("doomed");
    expect(await store.get("doomed")).toBeNull();
  });

  it("cleanup removes expired entries", async () => {
    vi.useFakeTimers();
    try {
      await store.set("a", "1", 200);
      await store.set("b", "2", 1000);
      expect(store.size).toBe(2);

      vi.advanceTimersByTime(300);
      store.cleanup();
      expect(store.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Fixed Window Rate Limiter
// ---------------------------------------------------------------------------

describe("FixedWindowRateLimiter", () => {
  it("allows requests within the limit", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 3,
    });

    const r1 = await limiter.check("user-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r1.limit).toBe(3);

    const r2 = await limiter.check("user-1");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.check("user-1");
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("denies requests over the limit", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 2,
    });

    await limiter.check("user-2");
    await limiter.check("user-2");
    const r3 = await limiter.check("user-2");

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfter).toBeGreaterThan(0);
  });

  it("resets at window boundary", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new FixedWindowRateLimiter({
        windowSize: 1000,
        maxRequests: 1,
      });

      const r1 = await limiter.check("user-3");
      expect(r1.allowed).toBe(true);

      const r2 = await limiter.check("user-3");
      expect(r2.allowed).toBe(false);

      // Move past the window boundary.
      vi.advanceTimersByTime(1100);

      const r3 = await limiter.check("user-3");
      expect(r3.allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks different identifiers independently", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 1,
    });

    const r1 = await limiter.check("alice");
    const r2 = await limiter.check("bob");

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });

  it("reset clears the counter for an identifier", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 1,
    });

    await limiter.check("user-reset");
    const r2 = await limiter.check("user-reset");
    expect(r2.allowed).toBe(false);

    await limiter.reset("user-reset");
    const r3 = await limiter.check("user-reset");
    expect(r3.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sliding Window Rate Limiter
// ---------------------------------------------------------------------------

describe("SlidingWindowRateLimiter", () => {
  it("allows requests within the limit", async () => {
    const limiter = new SlidingWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 5,
    });

    for (let i = 0; i < 5; i++) {
      const r = await limiter.check("user-sw");
      expect(r.allowed).toBe(true);
    }
  });

  it("denies requests over the limit", async () => {
    const limiter = new SlidingWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 3,
    });

    for (let i = 0; i < 3; i++) {
      await limiter.check("user-sw-deny");
    }

    const denied = await limiter.check("user-sw-deny");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("accounts for previous window weight across boundaries", async () => {
    vi.useFakeTimers();
    try {
      const windowSize = 10_000;
      const limiter = new SlidingWindowRateLimiter({
        windowSize,
        maxRequests: 10,
      });

      // Fill up 8 requests in the current window.
      for (let i = 0; i < 8; i++) {
        await limiter.check("user-sw-boundary");
      }

      // We need to advance into the NEXT window (not two windows ahead).
      // Calculate how much time is left in the current window, then add 50%.
      const now = Date.now();
      const currentWindowStart =
        Math.floor(now / windowSize) * windowSize;
      const timeLeftInCurrentWindow =
        currentWindowStart + windowSize - now;
      // Advance to 50% into the next window.
      vi.advanceTimersByTime(timeLeftInCurrentWindow + windowSize / 2);

      // Now: previous window had 8 requests, weight ≈ 0.5 → weighted ≈ 4.
      // So we should have ~6 more requests available (10 - 4 = 6).
      let allowedCount = 0;
      for (let i = 0; i < 10; i++) {
        const r = await limiter.check("user-sw-boundary");
        if (r.allowed) allowedCount++;
      }

      expect(allowedCount).toBeGreaterThanOrEqual(5);
      expect(allowedCount).toBeLessThanOrEqual(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset clears state for an identifier", async () => {
    const limiter = new SlidingWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 1,
    });

    await limiter.check("reset-sw");
    const denied = await limiter.check("reset-sw");
    expect(denied.allowed).toBe(false);

    await limiter.reset("reset-sw");
    const after = await limiter.check("reset-sw");
    expect(after.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token Bucket Rate Limiter
// ---------------------------------------------------------------------------

describe("TokenBucketRateLimiter", () => {
  it("allows requests within capacity", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillRate: 1,
      refillInterval: 1000,
    });

    for (let i = 0; i < 5; i++) {
      const r = await limiter.check("user-tb");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(5 - i - 1);
    }
  });

  it("denies requests when bucket is empty", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 2,
      refillRate: 1,
      refillInterval: 1000,
    });

    await limiter.check("user-tb-deny");
    await limiter.check("user-tb-deny");
    const r3 = await limiter.check("user-tb-deny");

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfter).toBeGreaterThan(0);
  });

  it("refills tokens over time", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new TokenBucketRateLimiter({
        capacity: 3,
        refillRate: 1,
        refillInterval: 1000,
      });

      // Drain all tokens.
      for (let i = 0; i < 3; i++) {
        await limiter.check("user-tb-refill");
      }

      const denied = await limiter.check("user-tb-refill");
      expect(denied.allowed).toBe(false);

      // Advance time to refill 2 tokens.
      vi.advanceTimersByTime(2000);

      const r1 = await limiter.check("user-tb-refill");
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(1);

      const r2 = await limiter.check("user-tb-refill");
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(0);

      const r3 = await limiter.check("user-tb-refill");
      expect(r3.allowed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not exceed capacity when refilling", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new TokenBucketRateLimiter({
        capacity: 3,
        refillRate: 1,
        refillInterval: 1000,
      });

      // Use one token.
      await limiter.check("user-tb-cap");

      // Wait a very long time (more than enough to fully refill).
      vi.advanceTimersByTime(100_000);

      const r = await limiter.check("user-tb-cap");
      expect(r.allowed).toBe(true);
      // Should be capped at capacity - 1 (we just used one).
      expect(r.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset clears bucket state", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 1,
      refillRate: 1,
      refillInterval: 60_000,
    });

    await limiter.check("reset-tb");
    const denied = await limiter.check("reset-tb");
    expect(denied.allowed).toBe(false);

    await limiter.reset("reset-tb");
    const after = await limiter.check("reset-tb");
    expect(after.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

describe("createRateLimitMiddleware", () => {
  it("returns correct headers when allowed", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 10,
    });

    const handler = createRateLimitMiddleware({ limiter, keyExtractor: keyByIp });
    const req: RateLimitRequest = { ip: "192.168.1.1" };
    const result = await handler(req);

    expect(result.status).toBe(200);
    expect(result.headers["X-RateLimit-Limit"]).toBe("10");
    expect(result.headers["X-RateLimit-Remaining"]).toBe("9");
    expect(result.headers["X-RateLimit-Reset"]).toBeDefined();
    expect(result.headers["Retry-After"]).toBeUndefined();
  });

  it("returns 429 with Retry-After when denied", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 1,
    });

    const handler = createRateLimitMiddleware({ limiter });
    const req: RateLimitRequest = { ip: "10.0.0.1" };

    await handler(req);
    const result = await handler(req);

    expect(result.status).toBe(429);
    expect(result.headers["Retry-After"]).toBeDefined();
    expect(Number(result.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("uses custom key extractor", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 1,
    });

    const byApiKey = keyByHeader("x-api-key");
    const handler = createRateLimitMiddleware({
      limiter,
      keyExtractor: byApiKey,
    });

    const req1: RateLimitRequest = {
      headers: { "x-api-key": "key-abc" },
    };
    const req2: RateLimitRequest = {
      headers: { "x-api-key": "key-xyz" },
    };

    const r1 = await handler(req1);
    const r2 = await handler(req2);

    // Different keys — both should be allowed.
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it("skips rate limiting when key extractor returns null", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 1,
    });

    const handler = createRateLimitMiddleware({
      limiter,
      keyExtractor: keyByAuthHeader,
    });

    // No authorization header → null key → skip.
    const req: RateLimitRequest = { headers: {} };
    const r1 = await handler(req);
    const r2 = await handler(req);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it("keyByIp defaults to 'unknown' when ip is missing", async () => {
    const limiter = new FixedWindowRateLimiter({
      windowSize: 60_000,
      maxRequests: 2,
    });

    const handler = createRateLimitMiddleware({ limiter, keyExtractor: keyByIp });
    const req: RateLimitRequest = {};

    const r1 = await handler(req);
    expect(r1.status).toBe(200);

    const r2 = await handler(req);
    expect(r2.status).toBe(200);

    const r3 = await handler(req);
    expect(r3.status).toBe(429);
  });
});
