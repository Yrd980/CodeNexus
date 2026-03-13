import { describe, it, expect, afterEach } from "vitest";
import { createQueue, createWorker, createScheduler } from "../src/index.js";

describe("Integration: Queue + Worker end-to-end", () => {
  let teardowns: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const fn of teardowns) {
      await fn();
    }
    teardowns = [];
  });

  it("should process jobs end-to-end", async () => {
    const queue = createQueue();
    const worker = createWorker(queue, {
      concurrency: 2,
      pollInterval: 10,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });

    teardowns.push(async () => {
      await worker.shutdown();
      queue.clear();
    });

    const results: string[] = [];

    worker.handle<{ name: string }, string>("greet", async ({ job }) => {
      const msg = `Hello, ${job.data.name}!`;
      results.push(msg);
      return msg;
    });

    worker.start();

    queue.add("greet", { name: "Alice" });
    queue.add("greet", { name: "Bob" });
    queue.add("greet", { name: "Charlie" });

    await waitFor(() => results.length === 3);

    expect(results).toContain("Hello, Alice!");
    expect(results).toContain("Hello, Bob!");
    expect(results).toContain("Hello, Charlie!");
    expect(queue.completedCount).toBe(3);
  });

  it("should handle mixed success and failure", async () => {
    const queue = createQueue();
    const worker = createWorker(queue, {
      concurrency: 1,
      pollInterval: 10,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });

    teardowns.push(async () => {
      await worker.shutdown();
      queue.clear();
    });

    worker.handle("process", async ({ job }) => {
      const data = job.data as { shouldFail: boolean };
      if (data.shouldFail) throw new Error("intentional failure");
      return "ok";
    });

    worker.start();

    queue.add("process", { shouldFail: false });
    queue.add("process", { shouldFail: true }, { maxRetries: 0 });
    queue.add("process", { shouldFail: false });

    await waitFor(() => queue.completedCount + queue.failedCount === 3, 5000);

    expect(queue.completedCount).toBe(2);
    expect(queue.failedCount).toBe(1);
  });

  it("should respect priority ordering under load", async () => {
    const queue = createQueue();
    const worker = createWorker(queue, {
      concurrency: 1,
      pollInterval: 10,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });

    teardowns.push(async () => {
      await worker.shutdown();
      queue.clear();
    });

    const order: string[] = [];

    worker.handle("task", async ({ job }) => {
      order.push((job.data as { label: string }).label);
    });

    // Add jobs BEFORE starting worker — so priority should determine order
    queue.add("task", { label: "low" }, { priority: 1 });
    queue.add("task", { label: "high" }, { priority: 10 });
    queue.add("task", { label: "medium" }, { priority: 5 });

    worker.start();

    await waitFor(() => order.length === 3);

    expect(order).toEqual(["high", "medium", "low"]);
  });

  it("should work with scheduler for recurring jobs", async () => {
    const queue = createQueue();
    const worker = createWorker(queue, {
      concurrency: 1,
      pollInterval: 10,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });
    const scheduler = createScheduler(queue);

    teardowns.push(async () => {
      scheduler.cancelAll();
      await worker.shutdown();
      queue.clear();
    });

    let execCount = 0;

    worker.handle("recurring", async () => {
      execCount++;
    });

    worker.start();

    scheduler.schedule({
      name: "recurring",
      dataFactory: () => ({}),
      every: 30,
      maxExecutions: 3,
    });

    await waitFor(() => execCount >= 3, 5000);

    expect(execCount).toBe(3);
  });

  it("should emit events through the full lifecycle", async () => {
    const queue = createQueue();
    const worker = createWorker(queue, {
      concurrency: 1,
      pollInterval: 10,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });

    teardowns.push(async () => {
      await worker.shutdown();
      queue.clear();
    });

    const events: string[] = [];

    queue.on("job:added", () => events.push("added"));
    queue.on("job:active", () => events.push("active"));
    queue.on("job:completed", () => events.push("completed"));

    worker.handle("task", async () => "result");

    queue.add("task", {});
    worker.start();

    await waitFor(() => events.includes("completed"));

    expect(events).toContain("added");
    expect(events).toContain("active");
    expect(events).toContain("completed");
  });

  it("should support concurrent workers with different handlers", async () => {
    const queue = createQueue();
    const worker = createWorker(queue, {
      concurrency: 3,
      pollInterval: 10,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });

    teardowns.push(async () => {
      await worker.shutdown();
      queue.clear();
    });

    const emailsSent: string[] = [];
    const reportsGenerated: string[] = [];

    worker
      .handle<{ to: string }, void>("send-email", async ({ job }) => {
        emailsSent.push(job.data.to);
      })
      .handle<{ id: string }, void>("generate-report", async ({ job }) => {
        reportsGenerated.push(job.data.id);
      });

    worker.start();

    queue.add("send-email", { to: "alice@example.com" });
    queue.add("generate-report", { id: "report-1" });
    queue.add("send-email", { to: "bob@example.com" });
    queue.add("generate-report", { id: "report-2" });

    await waitFor(() => emailsSent.length === 2 && reportsGenerated.length === 2, 5000);

    expect(emailsSent).toContain("alice@example.com");
    expect(emailsSent).toContain("bob@example.com");
    expect(reportsGenerated).toContain("report-1");
    expect(reportsGenerated).toContain("report-2");
  });
});

// ─── Helpers ─────────────────────────────────────────────

function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
  intervalMs = 10,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = (): void => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}
