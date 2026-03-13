import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../src/store/memory-store.js";
import type { Job } from "../src/types.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = Date.now();
  return {
    id: `test_${Math.random().toString(36).slice(2)}`,
    name: "test-job",
    data: {},
    priority: 0,
    attempts: 0,
    maxRetries: 3,
    delay: 0,
    timeout: 30_000,
    createdAt: now,
    processAfter: now,
    status: "waiting",
    progress: 0,
    ...overrides,
  };
}

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("should add and retrieve a job", () => {
    const job = makeJob({ id: "job-1" });
    store.add(job);

    const retrieved = store.get("job-1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe("job-1");
  });

  it("should return undefined for non-existent job", () => {
    expect(store.get("nope")).toBeUndefined();
  });

  it("should update a job", () => {
    const job = makeJob({ id: "job-1", status: "waiting" });
    store.add(job);

    store.update("job-1", { status: "active" });
    expect(store.get("job-1")!.status).toBe("active");
  });

  it("should remove a job", () => {
    const job = makeJob({ id: "job-1" });
    store.add(job);
    store.remove("job-1");

    expect(store.get("job-1")).toBeUndefined();
  });

  it("should return next job by priority (highest first)", () => {
    store.add(makeJob({ id: "low", priority: 1 }));
    store.add(makeJob({ id: "high", priority: 10 }));
    store.add(makeJob({ id: "mid", priority: 5 }));

    const next = store.getNext();
    expect(next!.id).toBe("high");
  });

  it("should return FIFO within the same priority", () => {
    const now = Date.now();
    store.add(makeJob({ id: "first", priority: 5, createdAt: now }));
    store.add(makeJob({ id: "second", priority: 5, createdAt: now + 1 }));

    const next = store.getNext();
    expect(next!.id).toBe("first");
  });

  it("should skip delayed jobs", () => {
    store.add(makeJob({ id: "delayed", processAfter: Date.now() + 60_000 }));
    store.add(makeJob({ id: "ready" }));

    const next = store.getNext();
    expect(next!.id).toBe("ready");
  });

  it("should skip non-waiting jobs", () => {
    store.add(makeJob({ id: "active", status: "active" }));
    store.add(makeJob({ id: "waiting", status: "waiting" }));

    const next = store.getNext();
    expect(next!.id).toBe("waiting");
  });

  it("should detect duplicate keys", () => {
    store.add(makeJob({ deduplicationKey: "dup-key", status: "waiting" }));

    expect(store.hasDuplicateKey("dup-key")).toBe(true);
    expect(store.hasDuplicateKey("other-key")).toBe(false);
  });

  it("should not detect duplicate keys for completed/failed jobs", () => {
    store.add(makeJob({ deduplicationKey: "dup-key", status: "completed" }));

    expect(store.hasDuplicateKey("dup-key")).toBe(false);
  });

  it("should query jobs by status", () => {
    store.add(makeJob({ id: "w1", status: "waiting" }));
    store.add(makeJob({ id: "w2", status: "waiting" }));
    store.add(makeJob({ id: "a1", status: "active" }));

    expect(store.getByStatus("waiting")).toHaveLength(2);
    expect(store.getByStatus("active")).toHaveLength(1);
    expect(store.getByStatus("failed")).toHaveLength(0);
  });

  it("should count jobs by status", () => {
    store.add(makeJob({ status: "waiting" }));
    store.add(makeJob({ status: "waiting" }));
    store.add(makeJob({ status: "completed" }));

    expect(store.countByStatus("waiting")).toBe(2);
    expect(store.countByStatus("completed")).toBe(1);
  });

  it("should return all jobs", () => {
    store.add(makeJob());
    store.add(makeJob());
    store.add(makeJob());

    expect(store.getAll()).toHaveLength(3);
  });

  it("should clear all jobs", () => {
    store.add(makeJob());
    store.add(makeJob());
    store.clear();

    expect(store.getAll()).toHaveLength(0);
  });
});
