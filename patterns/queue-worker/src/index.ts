/**
 * Queue Worker — Public API
 *
 * Factory functions for creating queues, workers, and schedulers.
 * This is the only file consumers need to import.
 *
 * @example
 * ```ts
 * import { createQueue, createWorker, createScheduler } from "@codenexus/queue-worker";
 *
 * const queue = createQueue({ maxSize: 1000 });
 * const worker = createWorker(queue, { concurrency: 5 });
 *
 * worker.handle("send-email", async ({ job }) => {
 *   await sendEmail(job.data.to, job.data.subject);
 * });
 *
 * worker.start();
 * queue.add("send-email", { to: "user@example.com", subject: "Welcome!" });
 * ```
 */

export { Queue } from "./queue.js";
export { Worker, calculateBackoffDelay } from "./worker.js";
export { Scheduler } from "./scheduler.js";
export { MemoryStore } from "./store/memory-store.js";
export { TypedEventEmitter } from "./event-emitter.js";

export type {
  Job,
  JobStatus,
  JobOptions,
  JobContext,
  JobHandler,
  JobResult,
  JobStore,
  BackoffStrategy,
  BackoffConfig,
  WorkerConfig,
  QueueConfig,
  QueueEventMap,
  QueueEventName,
  QueueEventListener,
  ScheduleOptions,
  ScheduledTask,
} from "./types.js";

import type { JobStore, QueueConfig, WorkerConfig } from "./types.js";
import { Queue } from "./queue.js";
import { Worker } from "./worker.js";
import { Scheduler } from "./scheduler.js";

/**
 * Create a new job queue.
 *
 * @param config - Queue configuration (all fields optional)
 * @param store - Custom job store (defaults to in-memory)
 */
export function createQueue(
  config?: Partial<QueueConfig>,
  store?: JobStore,
): Queue {
  return new Queue(config, store);
}

/**
 * Create a new worker that processes jobs from the given queue.
 *
 * @param queue - The queue to pull jobs from
 * @param config - Worker configuration (all fields optional)
 */
export function createWorker(
  queue: Queue,
  config?: Partial<WorkerConfig>,
): Worker {
  return new Worker(queue, config);
}

/**
 * Create a scheduler for recurring jobs.
 *
 * @param queue - The queue to enqueue scheduled jobs into
 */
export function createScheduler(queue: Queue): Scheduler {
  return new Scheduler(queue);
}
