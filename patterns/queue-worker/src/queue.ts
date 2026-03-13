/**
 * Job Queue
 *
 * Priority queue with delayed jobs, deduplication, and size limits.
 * The queue is the "inbox" — it holds jobs until a worker picks them up.
 *
 * Design decisions:
 * - Priority queue (not plain FIFO) because not all jobs are equal.
 *   A password reset email should jump ahead of a weekly digest.
 * - Delayed jobs are stored immediately but skipped until their time comes.
 *   This avoids external schedulers for simple "process in 5 minutes" patterns.
 * - Deduplication prevents the same idempotent operation from being queued
 *   multiple times (e.g., "send welcome email for user X").
 */

import { TypedEventEmitter } from "./event-emitter.js";
import { MemoryStore } from "./store/memory-store.js";
import type {
  Job,
  JobOptions,
  JobStatus,
  JobStore,
  QueueConfig,
  QueueEventListener,
  QueueEventName,
} from "./types.js";

let jobIdCounter = 0;

function generateJobId(): string {
  jobIdCounter++;
  return `job_${Date.now()}_${jobIdCounter}`;
}

const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxSize: 0,
  defaultPriority: 0,
  defaultRetries: 3,
  defaultTimeout: 30_000,
};

export class Queue {
  readonly config: QueueConfig;
  private store: JobStore;
  private emitter = new TypedEventEmitter();
  private paused = false;

  constructor(config?: Partial<QueueConfig>, store?: JobStore) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
    this.store = store ?? new MemoryStore();
  }

  // ─── Adding Jobs ────────────────────────────────────────

  /**
   * Add a job to the queue.
   *
   * @returns The created Job, or null if deduplicated/queue full.
   */
  add<T>(name: string, data: T, options?: JobOptions): Job<T> | null {
    // Check queue size limit
    if (this.config.maxSize > 0) {
      const waitingCount = this.store.countByStatus("waiting");
      if (waitingCount >= this.config.maxSize) {
        return null;
      }
    }

    // Check deduplication
    if (options?.deduplicationKey) {
      if (this.store.hasDuplicateKey(options.deduplicationKey)) {
        return null;
      }
    }

    const now = Date.now();
    const delay = options?.delay ?? 0;

    const job: Job<T> = {
      id: generateJobId(),
      name,
      data,
      priority: options?.priority ?? this.config.defaultPriority,
      attempts: 0,
      maxRetries: options?.maxRetries ?? this.config.defaultRetries,
      delay,
      timeout: options?.timeout ?? this.config.defaultTimeout,
      deduplicationKey: options?.deduplicationKey,
      createdAt: now,
      processAfter: now + delay,
      status: delay > 0 ? "delayed" : "waiting",
      progress: 0,
    };

    this.store.add(job as Job);

    // For delayed jobs, set a timer to transition to "waiting"
    if (delay > 0) {
      setTimeout(() => {
        const current = this.store.get(job.id);
        if (current && current.status === "delayed") {
          this.store.update(job.id, { status: "waiting" });
        }
      }, delay);
    }

    this.emitter.emit("job:added", { job: job as Job });
    return job;
  }

  // ─── Fetching Jobs ──────────────────────────────────────

  /**
   * Get the next processable job and mark it as active.
   * Called by the worker's poll loop.
   */
  getNextJob(): Job | undefined {
    if (this.paused) return undefined;

    const job = this.store.getNext();
    if (!job) return undefined;

    this.store.update(job.id, { status: "active" });
    this.emitter.emit("job:active", { job });
    return job;
  }

  // ─── Job Lifecycle ──────────────────────────────────────

  /** Mark a job as completed */
  completeJob(id: string, result: unknown, duration: number): void {
    const job = this.store.get(id);
    if (!job) return;

    this.store.update(id, {
      status: "completed" as JobStatus,
      result,
    });

    this.emitter.emit("job:completed", {
      job: this.store.get(id)!,
      result,
      duration,
    });

    this.checkDrained();
  }

  /** Mark a job as failed — may requeue for retry */
  failJob(id: string, error: Error): boolean {
    const job = this.store.get(id);
    if (!job) return false;

    const willRetry = job.attempts < job.maxRetries;

    if (willRetry) {
      // Requeue for retry — the worker will handle backoff delay
      this.store.update(id, {
        status: "waiting" as JobStatus,
        lastError: error.message,
      });

      this.emitter.emit("job:failed", { job: this.store.get(id)!, error, willRetry: true });
      return true;
    }

    // Permanent failure
    this.store.update(id, {
      status: "failed" as JobStatus,
      lastError: error.message,
    });

    this.emitter.emit("job:failed", { job: this.store.get(id)!, error, willRetry: false });
    this.checkDrained();
    return false;
  }

  /** Update job progress */
  updateProgress(id: string, progress: number): void {
    const job = this.store.get(id);
    if (!job) return;

    this.store.update(id, { progress });
    this.emitter.emit("job:progress", { job: this.store.get(id)!, progress });
  }

  // ─── Queue Control ─────────────────────────────────────

  /** Pause the queue — workers will stop picking up new jobs */
  pause(): void {
    this.paused = true;
  }

  /** Resume the queue */
  resume(): void {
    this.paused = false;
  }

  /** Whether the queue is paused */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Wait for all active jobs to finish.
   * Resolves immediately if no active jobs.
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    if (this.store.countByStatus("active") === 0) return;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off("queue:drained", onDrained);
        reject(new Error(`Queue drain timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onDrained = (): void => {
        clearTimeout(timer);
        resolve();
      };

      this.on("queue:drained", onDrained);
    });
  }

  // ─── Query ─────────────────────────────────────────────

  getJob(id: string): Job | undefined {
    return this.store.get(id);
  }

  getJobsByStatus(status: JobStatus): Job[] {
    return this.store.getByStatus(status);
  }

  get size(): number {
    return this.store.countByStatus("waiting") + this.store.countByStatus("delayed");
  }

  get activeCount(): number {
    return this.store.countByStatus("active");
  }

  get completedCount(): number {
    return this.store.countByStatus("completed");
  }

  get failedCount(): number {
    return this.store.countByStatus("failed");
  }

  // ─── Events ────────────────────────────────────────────

  on<E extends QueueEventName>(event: E, listener: QueueEventListener<E>): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<E extends QueueEventName>(event: E, listener: QueueEventListener<E>): this {
    this.emitter.off(event, listener);
    return this;
  }

  // ─── Cleanup ───────────────────────────────────────────

  clear(): void {
    this.store.clear();
    this.emitter.removeAllListeners();
  }

  // ─── Internal ──────────────────────────────────────────

  private checkDrained(): void {
    if (
      this.store.countByStatus("active") === 0 &&
      this.store.countByStatus("waiting") === 0
    ) {
      this.emitter.emit("queue:drained", undefined);
    }
  }
}
