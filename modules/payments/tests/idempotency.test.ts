import { describe, it, expect, beforeEach } from "vitest";
import {
  IdempotencyStore,
  generateIdempotencyKey,
  idempotent,
} from "../src/idempotency.js";

describe("IdempotencyStore", () => {
  let store: IdempotencyStore<string>;

  beforeEach(() => {
    store = new IdempotencyStore<string>();
  });

  it("should store and retrieve a value", () => {
    store.set("key-1", "result-1");
    expect(store.get("key-1")).toBe("result-1");
  });

  it("should return undefined for missing keys", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("should report size correctly", () => {
    store.set("a", "1");
    store.set("b", "2");
    expect(store.size).toBe(2);
  });

  it("should check existence with has()", () => {
    store.set("key-1", "result-1");
    expect(store.has("key-1")).toBe(true);
    expect(store.has("key-2")).toBe(false);
  });

  it("should delete a record", () => {
    store.set("key-1", "result-1");
    expect(store.delete("key-1")).toBe(true);
    expect(store.get("key-1")).toBeUndefined();
  });

  it("should return false when deleting a nonexistent key", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("should clear all records", () => {
    store.set("a", "1");
    store.set("b", "2");
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get("a")).toBeUndefined();
  });

  it("should expire records after TTL", () => {
    const shortTtl = new IdempotencyStore<string>({ ttlMs: 1 });
    shortTtl.set("key", "value");

    // Simulate expiry by waiting slightly
    // We use a synchronous approach: set TTL to 0 ms
    const zeroTtl = new IdempotencyStore<string>({ ttlMs: 0 });
    zeroTtl.set("key", "value");
    // The record is immediately expired on next get
    expect(zeroTtl.get("key")).toBeUndefined();
  });

  it("should prune expired records", () => {
    const zeroTtl = new IdempotencyStore<string>({ ttlMs: 0 });
    zeroTtl.set("a", "1");
    zeroTtl.set("b", "2");

    const pruned = zeroTtl.prune();
    expect(pruned).toBe(2);
    expect(zeroTtl.size).toBe(0);
  });
});

describe("generateIdempotencyKey", () => {
  it("should return a string starting with 'idem_'", () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^idem_/);
  });

  it("should generate unique keys", () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(100);
  });
});

describe("idempotent()", () => {
  it("should execute the operation on first call", async () => {
    const store = new IdempotencyStore<number>();
    let callCount = 0;

    const result = await idempotent(store, "op-1", async () => {
      callCount++;
      return 42;
    });

    expect(result).toBe(42);
    expect(callCount).toBe(1);
  });

  it("should return cached result on second call with same key", async () => {
    const store = new IdempotencyStore<number>();
    let callCount = 0;

    const operation = async () => {
      callCount++;
      return 42;
    };

    await idempotent(store, "op-1", operation);
    const result = await idempotent(store, "op-1", operation);

    expect(result).toBe(42);
    expect(callCount).toBe(1); // Only called once
  });

  it("should execute different operations for different keys", async () => {
    const store = new IdempotencyStore<number>();
    let callCount = 0;

    const result1 = await idempotent(store, "op-1", async () => {
      callCount++;
      return 1;
    });
    const result2 = await idempotent(store, "op-2", async () => {
      callCount++;
      return 2;
    });

    expect(result1).toBe(1);
    expect(result2).toBe(2);
    expect(callCount).toBe(2);
  });

  it("should re-execute after TTL expiry", async () => {
    const store = new IdempotencyStore<number>({ ttlMs: 0 });
    let callCount = 0;

    const operation = async () => {
      callCount++;
      return callCount;
    };

    const result1 = await idempotent(store, "op-1", operation);
    const result2 = await idempotent(store, "op-1", operation);

    expect(result1).toBe(1);
    // With 0ms TTL, the record expires immediately so operation runs again
    expect(result2).toBe(2);
    expect(callCount).toBe(2);
  });
});
