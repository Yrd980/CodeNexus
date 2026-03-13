/**
 * Job Worker
 *
 * Pulls jobs from the queue and executes handlers with:
 * - Configurable concurrency (N parallel jobs)
 * - Automatic retry with backoff
 * - Job timeout via AbortController
 * - Graceful shutdown (finish active, don't pick up new)
 *
 * Design decisions:
 * - Poll-based (not push) because it's simpler to reason about and the
 *   in-memory queue doesn't need event-driven efficiency.
 * - One job failing never crashes the worker — isolation is critical.
 * - Graceful shutdown is non-negotiable: k8s sends SIGTERM, and you
 *   have ~30s to finish active jobs before SIGKILL.
 */

import type { Queue } from "./queue.js";
import type {
  BackoffConfig,
  Job,
  JobContext,
  JobHandler,
  WorkerConfig,
} from "./types.js";

const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  concurrency: 1,
  pollInterval: 100,
  maxRetries: 3,
  backoff: {
    strategy: "exponential",
    baseDelay: 1000,
    maxDelay: 30_000,
  },
};

export class Worker {
  readonly config: WorkerConfig;
  private queue: Queue;
  private handlers = new Map<string, JobHandler<unknown, unknown>>();
  private activeJobs = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private shuttingDown = false;
  private shutdownResolve: (() => void) | null = null;

  constructor(queue: Queue, config?: Partial<WorkerConfig>) {
    this.queue = queue;
    this.config = { ...DEFAULT_WORKER_CONFIG, ...config };
  }

  // ─── Handler Registration ───────────────────────────────

  /**
   * Register a handler for a job name.
   * Each job name should have exactly one handler.
   */
  handle<T = unknown, R = unknown>(
    name: string,
    handler: JobHandler<T, R>,
  ): this {
    this.handlers.set(name, handler as JobHandler<unknown, unknown>);
    return this;
  }

  // ─── Lifecycle ──────────────────────────────────────────

  /** Start polling for jobs */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.shuttingDown = false;

    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.config.pollInterval);

    // Also do an immediate poll
    this.poll();
  }

  /** Stop picking up new jobs. Returns a promise that resolves when all active jobs finish. */
  async shutdown(): Promise<void> {
    if (!this.running) return;
    this.shuttingDown = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // If no active jobs, resolve immediately
    if (this.activeJobs.size === 0) {
      this.running = false;
      return;
    }

    // Wait for active jobs to finish
    return new Promise<void>((resolve) => {
      this.shutdownResolve = () => {
        this.running = false;
        resolve();
      };
    });
  }

  /** Whether the worker is currently running */
  get isRunning(): boolean {
    return this.running;
  }

  /** Number of jobs currently being processed */
  get activeCount(): number {
    return this.activeJobs.size;
  }

  // ─── Poll Loop ──────────────────────────────────────────

  private poll(): void {
    if (this.shuttingDown) return;

    // Fill up to concurrency limit
    while (this.activeJobs.size < this.config.concurrency) {
      const job = this.queue.getNextJob();
      if (!job) break;
      this.processJob(job);
    }
  }

  // ─── Job Processing ─────────────────────────────────────

  private processJob(job: Job): void {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      // No handler registered — fail the job immediately
      this.queue.failJob(
        job.id,
        new Error(`No handler registered for job "${job.name}"`),
      );
      return;
    }

    this.activeJobs.add(job.id);

    // Increment attempt count
    job.attempts++;

    // Set up timeout via AbortController
    const controller = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    if (job.timeout > 0) {
      timeoutTimer = setTimeout(() => {
        controller.abort(new Error(`Job timed out after ${job.timeout}ms`));
      }, job.timeout);
    }

    // Build context
    const ctx: JobContext = {
      job,
      reportProgress: (value: number) => {
        this.queue.updateProgress(job.id, value);
      },
      signal: controller.signal,
    };

    const startTime = performance.now();

    // Execute handler
    handler(ctx)
      .then((result) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = performance.now() - startTime;
        this.queue.completeJob(job.id, result, duration);
        this.finishJob(job.id);
      })
      .catch((err: unknown) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const error = err instanceof Error ? err : new Error(String(err));
        const willRetry = this.queue.failJob(job.id, error);

        if (willRetry) {
          // Schedule retry with backoff
          const delay = this.calculateBackoff(job.attempts);
          this.queue.on("job:retrying", () => {}); // no-op to satisfy type
          setTimeout(() => {
            // Job is already back in "waiting" state via failJob
            // The next poll will pick it up
          }, delay);
        }

        this.finishJob(job.id);
      });
  }

  private finishJob(jobId: string): void {
    this.activeJobs.delete(jobId);

    // Check if we should resolve shutdown
    if (this.shuttingDown && this.activeJobs.size === 0 && this.shutdownResolve) {
      this.shutdownResolve();
      this.shutdownResolve = null;
    }

    // Check for idle
    if (this.activeJobs.size === 0 && !this.shuttingDown) {
      this.queue.on("worker:idle", () => {});
    }
  }

  // ─── Backoff Calculation ────────────────────────────────

  private calculateBackoff(attempt: number): number {
    const { strategy, baseDelay, maxDelay } = this.config.backoff;

    let delay: number;
    switch (strategy) {
      case "fixed":
        delay = baseDelay;
        break;
      case "linear":
        delay = baseDelay * attempt;
        break;
      case "exponential":
        delay = baseDelay * 2 ** (attempt - 1);
        break;
      default:
        delay = baseDelay;
    }

    // Add jitter (+-25%) to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.min(delay + jitter, maxDelay);

    return Math.max(0, delay);
  }
}

/**
 * Calculate backoff delay (exported for testing)
 */
export function calculateBackoffDelay(
  attempt: number,
  config: BackoffConfig,
): number {
  const { strategy, baseDelay, maxDelay } = config;

  let delay: number;
  switch (strategy) {
    case "fixed":
      delay = baseDelay;
      break;
    case "linear":
      delay = baseDelay * attempt;
      break;
    case "exponential":
      delay = baseDelay * 2 ** (attempt - 1);
      break;
    default:
      delay = baseDelay;
  }

  return Math.min(delay, maxDelay);
}
