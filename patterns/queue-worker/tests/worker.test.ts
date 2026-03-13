import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Queue } from "../src/queue.js";
import { Worker } from "../src/worker.js";
import { calculateBackoffDelay } from "../src/worker.js";

describe("Worker", () => {
  let queue: Queue;
  let worker: Worker;

  beforeEach(() => {
    queue = new Queue();
    worker = new Worker(queue, {
      concurrency: 1,
      pollInterval: 20,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });
  });

  afterEach(async () => {
    if (worker.isRunning) {
      await worker.shutdown();
    }
    queue.clear();
  });

  // ─── Basic Processing ──────────────────────────────────

  it("should process a job with the registered handler", async () => {
    let processed = false;

    worker.handle("task", async () => {
      processed = true;
      return "done";
    });

    queue.add("task", { value: 42 });
    worker.start();

    await waitFor(() => processed);
    await worker.shutdown();

    expect(processed).toBe(true);
    expect(queue.completedCount).toBe(1);
  });

  it("should pass job data to the handler", async () => {
    let receivedData: unknown = null;

    worker.handle("task", async ({ job }) => {
      receivedData = job.data;
    });

    queue.add("task", { msg: "hello" });
    worker.start();

    await waitFor(() => receivedData !== null);
    await worker.shutdown();

    expect(receivedData).toEqual({ msg: "hello" });
  });

  it("should process multiple jobs sequentially with concurrency 1", async () => {
    const order: number[] = [];

    worker.handle("task", async ({ job }) => {
      order.push((job.data as { n: number }).n);
    });

    queue.add("task", { n: 1 });
    queue.add("task", { n: 2 });
    queue.add("task", { n: 3 });

    worker.start();

    await waitFor(() => order.length === 3);
    await worker.shutdown();

    expect(order).toEqual([1, 2, 3]);
  });

  // ─── Concurrency ───────────────────────────────────────

  it("should respect concurrency limit", async () => {
    const w = new Worker(queue, {
      concurrency: 2,
      pollInterval: 10,
      maxRetries: 3,
      backoff: { strategy: "fixed", baseDelay: 10, maxDelay: 100 },
    });

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    w.handle("task", async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await delay(50);
      currentConcurrent--;
    });

    // Add 4 jobs
    queue.add("task", {});
    queue.add("task", {});
    queue.add("task", {});
    queue.add("task", {});

    w.start();

    await waitFor(() => queue.completedCount === 4, 5000);
    await w.shutdown();

    // Should have at most 2 running at the same time
    expect(maxConcurrent).toBe(2);
  });

  // ─── Retry on Failure ──────────────────────────────────

  it("should retry failed jobs", async () => {
    let attempts = 0;

    worker.handle("flaky", async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`Fail attempt ${attempts}`);
      }
      return "success";
    });

    queue.add("flaky", {}, { maxRetries: 3 });
    worker.start();

    await waitFor(() => queue.completedCount === 1, 5000);
    await worker.shutdown();

    expect(attempts).toBe(3);
    expect(queue.completedCount).toBe(1);
  });

  it("should permanently fail after max retries", async () => {
    worker.handle("always-fails", async () => {
      throw new Error("nope");
    });

    queue.add("always-fails", {}, { maxRetries: 2 });
    worker.start();

    await waitFor(() => queue.failedCount === 1, 5000);
    await worker.shutdown();

    expect(queue.failedCount).toBe(1);
  });

  // ─── Timeout ───────────────────────────────────────────

  it("should fail a job that exceeds timeout", async () => {
    worker.handle("slow", async ({ signal }) => {
      // Simulate slow work that respects the signal
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      });
    });

    queue.add("slow", {}, { timeout: 100, maxRetries: 0 });
    worker.start();

    await waitFor(() => queue.failedCount === 1, 5000);
    await worker.shutdown();

    const failed = queue.getJobsByStatus("failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.lastError).toContain("timed out");
  });

  // ─── Graceful Shutdown ─────────────────────────────────

  it("should finish active jobs during shutdown", async () => {
    let completed = false;

    worker.handle("slow-job", async () => {
      await delay(100);
      completed = true;
      return "done";
    });

    queue.add("slow-job", {});
    worker.start();

    // Wait for job to start
    await waitFor(() => worker.activeCount > 0);

    // Trigger shutdown — should wait for job to finish
    await worker.shutdown();

    expect(completed).toBe(true);
    expect(worker.isRunning).toBe(false);
  });

  it("should not pick up new jobs after shutdown starts", async () => {
    let processedCount = 0;

    worker.handle("task", async () => {
      await delay(100);
      processedCount++;
    });

    queue.add("task", {});
    queue.add("task", {});
    queue.add("task", {});

    worker.start();

    // Wait for first job to start
    await waitFor(() => worker.activeCount > 0);

    // Shutdown — should finish current but not pick up remaining
    await worker.shutdown();

    expect(processedCount).toBe(1);
  });

  // ─── No Handler ────────────────────────────────────────

  it("should fail jobs with no registered handler", async () => {
    // Intentionally do NOT register a handler for "unknown"
    queue.add("unknown", {}, { maxRetries: 0 });

    worker.start();

    await waitFor(() => queue.failedCount === 1, 3000);
    await worker.shutdown();

    const failed = queue.getJobsByStatus("failed");
    expect(failed[0]!.lastError).toContain("No handler registered");
  });

  // ─── Progress Reporting ────────────────────────────────

  it("should report progress from handler", async () => {
    const progressValues: number[] = [];

    queue.on("job:progress", (data) => {
      progressValues.push(data.progress);
    });

    worker.handle("upload", async ({ reportProgress }) => {
      reportProgress(25);
      reportProgress(50);
      reportProgress(75);
      reportProgress(100);
    });

    queue.add("upload", {});
    worker.start();

    await waitFor(() => queue.completedCount === 1);
    await worker.shutdown();

    expect(progressValues).toEqual([25, 50, 75, 100]);
  });

  // ─── Error Isolation ───────────────────────────────────

  it("should continue processing after a job fails", async () => {
    const results: string[] = [];

    worker.handle("task", async ({ job }) => {
      const n = (job.data as { n: number }).n;
      if (n === 2) throw new Error("job 2 fails");
      results.push(`done-${n}`);
    });

    queue.add("task", { n: 1 });
    queue.add("task", { n: 2 }, { maxRetries: 0 });
    queue.add("task", { n: 3 });

    worker.start();

    await waitFor(() => results.length === 2 && queue.failedCount === 1, 5000);
    await worker.shutdown();

    expect(results).toContain("done-1");
    expect(results).toContain("done-3");
    expect(queue.failedCount).toBe(1);
  });
});

// ─── Backoff Calculation ─────────────────────────────────

describe("calculateBackoffDelay", () => {
  it("should return fixed delay", () => {
    const config = { strategy: "fixed" as const, baseDelay: 1000, maxDelay: 30_000 };
    expect(calculateBackoffDelay(1, config)).toBe(1000);
    expect(calculateBackoffDelay(3, config)).toBe(1000);
  });

  it("should return linear delay", () => {
    const config = { strategy: "linear" as const, baseDelay: 1000, maxDelay: 30_000 };
    expect(calculateBackoffDelay(1, config)).toBe(1000);
    expect(calculateBackoffDelay(3, config)).toBe(3000);
  });

  it("should return exponential delay", () => {
    const config = { strategy: "exponential" as const, baseDelay: 1000, maxDelay: 30_000 };
    expect(calculateBackoffDelay(1, config)).toBe(1000);
    expect(calculateBackoffDelay(2, config)).toBe(2000);
    expect(calculateBackoffDelay(3, config)).toBe(4000);
  });

  it("should cap at maxDelay", () => {
    const config = { strategy: "exponential" as const, baseDelay: 1000, maxDelay: 5000 };
    expect(calculateBackoffDelay(10, config)).toBe(5000);
  });
});

// ─── Helpers ─────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
