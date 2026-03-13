import { describe, expect, it, vi } from "vitest";
import { DeadLetterQueue } from "../src/dead-letter-queue.js";
import type { Event, EventId } from "../src/types.js";

function makeEvent(type: string, payload: unknown = {}): Event {
  return {
    id: `evt_test_${Math.random().toString(36).slice(2)}` as EventId,
    type,
    payload,
    timestamp: Date.now(),
    metadata: {},
  };
}

describe("DeadLetterQueue", () => {
  it("should capture failed events", () => {
    const dlq = new DeadLetterQueue();
    const event = makeEvent("user.created", { userId: "u1" });
    const error = new Error("handler failed");

    dlq.add(event, error);

    expect(dlq.size).toBe(1);
    const entries = dlq.getAll();
    expect(entries[0]!.event).toBe(event);
    expect(entries[0]!.error).toBe(error);
    expect(entries[0]!.retryCount).toBe(0);
  });

  it("should separate retryable from permanently failed entries", () => {
    const dlq = new DeadLetterQueue({ maxRetries: 2 });

    const entry1 = dlq.add(makeEvent("a"), new Error("err1"));
    const entry2 = dlq.add(makeEvent("b"), new Error("err2"));

    // Manually exhaust retries on entry2
    entry2.retryCount = 2;

    expect(dlq.getRetryable()).toHaveLength(1);
    expect(dlq.getRetryable()[0]!.id).toBe(entry1.id);

    expect(dlq.getPermanentlyFailed()).toHaveLength(1);
    expect(dlq.getPermanentlyFailed()[0]!.id).toBe(entry2.id);
  });

  it("should retry a failed entry and remove it on success", async () => {
    const dlq = new DeadLetterQueue();
    const event = makeEvent("user.created");
    const entry = dlq.add(event, new Error("oops"));

    const handler = vi.fn().mockResolvedValue(undefined);
    const result = await dlq.retry(entry.id, handler);

    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledWith(event);
    expect(dlq.size).toBe(0);
  });

  it("should retry a failed entry and keep it on failure", async () => {
    const dlq = new DeadLetterQueue();
    const entry = dlq.add(makeEvent("user.created"), new Error("oops"));

    const handler = vi.fn().mockRejectedValue(new Error("still broken"));
    const result = await dlq.retry(entry.id, handler);

    expect(result).toBe(false);
    expect(dlq.size).toBe(1);
    expect(dlq.getAll()[0]!.retryCount).toBe(1);
  });

  it("should throw when retrying a non-existent entry", async () => {
    const dlq = new DeadLetterQueue();

    await expect(
      dlq.retry("non-existent", vi.fn()),
    ).rejects.toThrow("not found");
  });

  it("should throw when retrying an entry that exceeded max retries", async () => {
    const dlq = new DeadLetterQueue({ maxRetries: 1 });
    const entry = dlq.add(makeEvent("user.created"), new Error("oops"));

    // Use up the one allowed retry
    await dlq.retry(entry.id, vi.fn().mockRejectedValue(new Error("fail")));

    await expect(
      dlq.retry(entry.id, vi.fn()),
    ).rejects.toThrow("exceeded max retries");
  });

  it("should replay all retryable entries", async () => {
    const dlq = new DeadLetterQueue({ maxRetries: 3 });

    dlq.add(makeEvent("a"), new Error("err1"));
    dlq.add(makeEvent("b"), new Error("err2"));

    const handler = vi.fn().mockResolvedValue(undefined);
    const result = await dlq.replayAll(handler);

    expect(result).toEqual({ succeeded: 2, failed: 0 });
    expect(dlq.size).toBe(0);
  });

  it("should handle mixed success/failure during replay", async () => {
    const dlq = new DeadLetterQueue({ maxRetries: 3 });

    dlq.add(makeEvent("a"), new Error("err1"));
    dlq.add(makeEvent("b"), new Error("err2"));

    let callCount = 0;
    const handler = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return; // Success
      throw new Error("still broken"); // Failure
    });

    const result = await dlq.replayAll(handler);

    expect(result).toEqual({ succeeded: 1, failed: 1 });
    expect(dlq.size).toBe(1);
  });

  it("should remove a specific entry", () => {
    const dlq = new DeadLetterQueue();

    const entry1 = dlq.add(makeEvent("a"), new Error("err1"));
    dlq.add(makeEvent("b"), new Error("err2"));

    expect(dlq.remove(entry1.id)).toBe(true);
    expect(dlq.size).toBe(1);
    expect(dlq.remove(entry1.id)).toBe(false); // Already removed
  });

  it("should clear all entries", () => {
    const dlq = new DeadLetterQueue();

    dlq.add(makeEvent("a"), new Error("err1"));
    dlq.add(makeEvent("b"), new Error("err2"));
    expect(dlq.size).toBe(2);

    dlq.clear();
    expect(dlq.size).toBe(0);
  });
});
