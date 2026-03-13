import { describe, it, expect, beforeEach } from "vitest";
import { Queue } from "../src/queue.js";

describe("Queue", () => {
  let queue: Queue;

  beforeEach(() => {
    queue = new Queue();
  });

  // ─── Adding Jobs ────────────────────────────────────────

  it("should add a job and return it", () => {
    const job = queue.add("send-email", { to: "user@test.com" });

    expect(job).not.toBeNull();
    expect(job!.name).toBe("send-email");
    expect(job!.data).toEqual({ to: "user@test.com" });
    expect(job!.status).toBe("waiting");
    expect(job!.attempts).toBe(0);
    expect(job!.id).toMatch(/^job_/);
  });

  it("should assign default priority and retries from config", () => {
    const q = new Queue({ defaultPriority: 5, defaultRetries: 10 });
    const job = q.add("task", {});

    expect(job!.priority).toBe(5);
    expect(job!.maxRetries).toBe(10);
  });

  it("should override defaults with job options", () => {
    const job = queue.add("task", {}, { priority: 10, maxRetries: 5 });

    expect(job!.priority).toBe(10);
    expect(job!.maxRetries).toBe(5);
  });

  // ─── Priority Ordering ─────────────────────────────────

  it("should return highest priority job first", () => {
    queue.add("low", {}, { priority: 1 });
    queue.add("high", {}, { priority: 10 });
    queue.add("medium", {}, { priority: 5 });

    const next = queue.getNextJob();
    expect(next!.name).toBe("high");
  });

  it("should return FIFO within the same priority", () => {
    queue.add("first", {}, { priority: 5 });
    queue.add("second", {}, { priority: 5 });
    queue.add("third", {}, { priority: 5 });

    const first = queue.getNextJob();
    const second = queue.getNextJob();
    const third = queue.getNextJob();

    expect(first!.name).toBe("first");
    expect(second!.name).toBe("second");
    expect(third!.name).toBe("third");
  });

  // ─── Delayed Jobs ──────────────────────────────────────

  it("should mark delayed jobs with 'delayed' status", () => {
    const job = queue.add("later", {}, { delay: 5000 });

    expect(job!.status).toBe("delayed");
    expect(job!.delay).toBe(5000);
  });

  it("should not return delayed jobs that haven't matured", () => {
    queue.add("later", {}, { delay: 60_000 });

    const next = queue.getNextJob();
    expect(next).toBeUndefined();
  });

  it("should return delayed jobs after delay expires", async () => {
    queue.add("soon", {}, { delay: 50 });

    // Immediately not available
    expect(queue.getNextJob()).toBeUndefined();

    // Wait for delay + transition
    await new Promise((r) => setTimeout(r, 100));

    const next = queue.getNextJob();
    expect(next).toBeDefined();
    expect(next!.name).toBe("soon");
  });

  // ─── Deduplication ─────────────────────────────────────

  it("should deduplicate jobs with the same key", () => {
    const first = queue.add("email", { userId: 1 }, { deduplicationKey: "welcome-1" });
    const second = queue.add("email", { userId: 1 }, { deduplicationKey: "welcome-1" });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(queue.size).toBe(1);
  });

  it("should allow same dedup key after first job completes", () => {
    queue.add("email", { userId: 1 }, { deduplicationKey: "welcome-1" });

    const job = queue.getNextJob()!;
    queue.completeJob(job.id, "done", 100);

    const second = queue.add("email", { userId: 1 }, { deduplicationKey: "welcome-1" });
    expect(second).not.toBeNull();
  });

  it("should allow different dedup keys", () => {
    const first = queue.add("email", {}, { deduplicationKey: "key-1" });
    const second = queue.add("email", {}, { deduplicationKey: "key-2" });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });

  // ─── Max Size ──────────────────────────────────────────

  it("should enforce max queue size", () => {
    const q = new Queue({ maxSize: 2 });

    expect(q.add("a", {})).not.toBeNull();
    expect(q.add("b", {})).not.toBeNull();
    expect(q.add("c", {})).toBeNull(); // rejected
    expect(q.size).toBe(2);
  });

  it("should allow adding after a job is consumed", () => {
    const q = new Queue({ maxSize: 1 });

    q.add("a", {});
    const job = q.getNextJob()!;
    q.completeJob(job.id, null, 0);

    // Now there's room
    expect(q.add("b", {})).not.toBeNull();
  });

  // ─── Pause / Resume ────────────────────────────────────

  it("should not return jobs when paused", () => {
    queue.add("task", {});
    queue.pause();

    expect(queue.getNextJob()).toBeUndefined();
    expect(queue.isPaused()).toBe(true);

    queue.resume();
    expect(queue.getNextJob()).toBeDefined();
    expect(queue.isPaused()).toBe(false);
  });

  // ─── Job Lifecycle ─────────────────────────────────────

  it("should mark job as active when fetched", () => {
    queue.add("task", {});
    const job = queue.getNextJob()!;

    expect(job.status).toBe("active");
    expect(queue.activeCount).toBe(1);
  });

  it("should mark job as completed", () => {
    queue.add("task", {});
    const job = queue.getNextJob()!;
    queue.completeJob(job.id, { success: true }, 150);

    const completed = queue.getJob(job.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ success: true });
    expect(queue.completedCount).toBe(1);
  });

  it("should requeue failed job for retry when attempts remain", () => {
    queue.add("task", {}, { maxRetries: 3 });
    const job = queue.getNextJob()!;
    job.attempts = 1; // simulate first attempt

    const willRetry = queue.failJob(job.id, new Error("boom"));
    expect(willRetry).toBe(true);

    const retried = queue.getJob(job.id)!;
    expect(retried.status).toBe("waiting");
    expect(retried.lastError).toBe("boom");
  });

  it("should permanently fail job when retries exhausted", () => {
    queue.add("task", {}, { maxRetries: 1 });
    const job = queue.getNextJob()!;
    job.attempts = 1; // reached max

    const willRetry = queue.failJob(job.id, new Error("final failure"));
    expect(willRetry).toBe(false);

    const failed = queue.getJob(job.id)!;
    expect(failed.status).toBe("failed");
    expect(queue.failedCount).toBe(1);
  });

  // ─── Events ────────────────────────────────────────────

  it("should emit job:added event", () => {
    let emitted = false;
    queue.on("job:added", () => {
      emitted = true;
    });

    queue.add("task", {});
    expect(emitted).toBe(true);
  });

  it("should emit job:completed event with result and duration", () => {
    let eventData: { result: unknown; duration: number } | null = null;
    queue.on("job:completed", (data) => {
      eventData = { result: data.result, duration: data.duration };
    });

    queue.add("task", {});
    const job = queue.getNextJob()!;
    queue.completeJob(job.id, "done", 42);

    expect(eventData).not.toBeNull();
    expect(eventData!.result).toBe("done");
    expect(eventData!.duration).toBe(42);
  });

  it("should emit job:failed event", () => {
    let willRetry: boolean | null = null;
    queue.on("job:failed", (data) => {
      willRetry = data.willRetry;
    });

    queue.add("task", {}, { maxRetries: 0 });
    const job = queue.getNextJob()!;
    queue.failJob(job.id, new Error("nope"));

    expect(willRetry).toBe(false);
  });

  it("should emit queue:drained when all jobs complete", () => {
    let drained = false;
    queue.on("queue:drained", () => {
      drained = true;
    });

    queue.add("task", {});
    const job = queue.getNextJob()!;
    queue.completeJob(job.id, null, 0);

    expect(drained).toBe(true);
  });

  // ─── Progress ──────────────────────────────────────────

  it("should update and emit job progress", () => {
    let progressValue = -1;
    queue.on("job:progress", (data) => {
      progressValue = data.progress;
    });

    queue.add("task", {});
    const job = queue.getNextJob()!;
    queue.updateProgress(job.id, 50);

    expect(progressValue).toBe(50);
    expect(queue.getJob(job.id)!.progress).toBe(50);
  });

  // ─── Drain ─────────────────────────────────────────────

  it("should resolve drain immediately when no active jobs", async () => {
    await queue.drain(); // should not hang
  });

  it("should resolve drain when active jobs complete", async () => {
    queue.add("task", {});
    const job = queue.getNextJob()!;

    const drainPromise = queue.drain(5000);

    // Complete the job after a short delay
    setTimeout(() => {
      queue.completeJob(job.id, null, 0);
    }, 50);

    await drainPromise; // should resolve
  });
});
