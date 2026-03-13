import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Queue } from "../src/queue.js";
import { Scheduler } from "../src/scheduler.js";

describe("Scheduler", () => {
  let queue: Queue;
  let scheduler: Scheduler;

  beforeEach(() => {
    queue = new Queue();
    scheduler = new Scheduler(queue);
  });

  afterEach(() => {
    scheduler.cancelAll();
    queue.clear();
  });

  // ─── Basic Scheduling ──────────────────────────────────

  it("should enqueue a job immediately on schedule", () => {
    scheduler.schedule({
      name: "heartbeat",
      dataFactory: () => ({ ts: Date.now() }),
      every: 1000,
    });

    // First tick fires immediately
    expect(queue.size).toBe(1);
  });

  it("should enqueue jobs at the specified interval", async () => {
    scheduler.schedule({
      name: "ping",
      dataFactory: () => ({}),
      every: 50,
    });

    // Initial + a few ticks
    await delay(180);

    // Should have at least 3 jobs (initial + ~3 interval ticks)
    expect(queue.size).toBeGreaterThanOrEqual(3);
  });

  it("should call dataFactory each time to produce fresh data", async () => {
    let counter = 0;

    scheduler.schedule({
      name: "counter",
      dataFactory: () => {
        counter++;
        return { count: counter };
      },
      every: 30,
    });

    await delay(100);

    const jobs = queue.getJobsByStatus("waiting");
    const data = jobs.map((j) => (j.data as { count: number }).count);

    // Each invocation should have a unique counter value
    const unique = new Set(data);
    expect(unique.size).toBe(data.length);
  });

  // ─── Max Executions ────────────────────────────────────

  it("should stop after maxExecutions", async () => {
    const task = scheduler.schedule({
      name: "limited",
      dataFactory: () => ({}),
      every: 20,
      maxExecutions: 3,
    });

    await delay(200);

    expect(task.executionCount).toBe(3);
    expect(task.active).toBe(false);

    // No more jobs should be added
    const currentSize = queue.size;
    await delay(100);
    expect(queue.size).toBe(currentSize);
  });

  it("should handle maxExecutions of 1 (run once)", () => {
    const task = scheduler.schedule({
      name: "once",
      dataFactory: () => ({}),
      every: 1000,
      maxExecutions: 1,
    });

    expect(task.executionCount).toBe(1);
    expect(task.active).toBe(false);
    expect(queue.size).toBe(1);
  });

  // ─── Cancel ────────────────────────────────────────────

  it("should cancel a scheduled task", async () => {
    const task = scheduler.schedule({
      name: "cancelable",
      dataFactory: () => ({}),
      every: 30,
    });

    const sizeAtCancel = queue.size;
    task.cancel();

    await delay(100);

    // No new jobs should have been added after cancel
    expect(queue.size).toBe(sizeAtCancel);
    expect(task.active).toBe(false);
  });

  it("should cancel all tasks", async () => {
    scheduler.schedule({
      name: "a",
      dataFactory: () => ({}),
      every: 30,
    });

    scheduler.schedule({
      name: "b",
      dataFactory: () => ({}),
      every: 30,
    });

    scheduler.cancelAll();

    const sizeAfterCancel = queue.size;
    await delay(100);

    expect(queue.size).toBe(sizeAfterCancel);
    expect(scheduler.getActiveTasks()).toHaveLength(0);
  });

  // ─── Job Options ───────────────────────────────────────

  it("should forward job options to enqueued jobs", () => {
    scheduler.schedule({
      name: "priority-task",
      dataFactory: () => ({}),
      every: 1000,
      maxExecutions: 1,
      jobOptions: { priority: 10, maxRetries: 5 },
    });

    const jobs = queue.getJobsByStatus("waiting");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.priority).toBe(10);
    expect(jobs[0]!.maxRetries).toBe(5);
  });

  // ─── Task Query ────────────────────────────────────────

  it("should return active tasks", () => {
    scheduler.schedule({ name: "a", dataFactory: () => ({}), every: 1000 });
    scheduler.schedule({ name: "b", dataFactory: () => ({}), every: 1000 });

    expect(scheduler.getActiveTasks()).toHaveLength(2);
  });

  it("should retrieve a task by ID", () => {
    const task = scheduler.schedule({
      name: "findme",
      dataFactory: () => ({}),
      every: 1000,
    });

    const found = scheduler.getTask(task.id);
    expect(found).toBeDefined();
    expect(found!.options.name).toBe("findme");
  });
});

// ─── Helpers ─────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
