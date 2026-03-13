/**
 * Job Scheduler
 *
 * Simple recurring job scheduler — "run this every N milliseconds".
 * No cron parser dependency; for complex cron patterns, use a dedicated lib.
 *
 * Design decisions:
 * - setInterval-based, not cron-based. Most startups need "every 5 minutes"
 *   not "at 3:42 AM on the second Tuesday". Keep it simple.
 * - maxExecutions cap prevents runaway schedules in dev/test.
 * - Each scheduled invocation creates a real job in the queue, so it gets
 *   the same retry/priority/concurrency behavior as any other job.
 */

import type { Queue } from "./queue.js";
import type { ScheduledTask, ScheduleOptions } from "./types.js";

let scheduleIdCounter = 0;

function generateScheduleId(): string {
  scheduleIdCounter++;
  return `schedule_${Date.now()}_${scheduleIdCounter}`;
}

export class Scheduler {
  private queue: Queue;
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(queue: Queue) {
    this.queue = queue;
  }

  /**
   * Schedule a recurring job.
   *
   * @returns ScheduledTask with a cancel() method
   */
  schedule(options: ScheduleOptions): ScheduledTask {
    const id = generateScheduleId();

    const task: ScheduledTask = {
      id,
      options,
      executionCount: 0,
      active: true,
      cancel: () => this.cancel(id),
    };

    this.tasks.set(id, task);

    // Create the interval
    const timer = setInterval(() => {
      this.tick(id);
    }, options.every);

    this.timers.set(id, timer);

    // Also fire immediately on the first tick
    this.tick(id);

    return task;
  }

  /** Cancel a scheduled task */
  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    task.active = false;

    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  /** Cancel all scheduled tasks */
  cancelAll(): void {
    for (const id of this.tasks.keys()) {
      this.cancel(id);
    }
  }

  /** Get all active scheduled tasks */
  getActiveTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.active);
  }

  /** Get a scheduled task by ID */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  // ─── Internal ──────────────────────────────────────────

  private tick(id: string): void {
    const task = this.tasks.get(id);
    if (!task || !task.active) return;

    // Check max executions
    const max = task.options.maxExecutions ?? 0;
    if (max > 0 && task.executionCount >= max) {
      this.cancel(id);
      return;
    }

    // Enqueue the job
    const data = task.options.dataFactory();
    this.queue.add(task.options.name, data, task.options.jobOptions);

    task.executionCount++;

    // Check if we've reached max after this execution
    if (max > 0 && task.executionCount >= max) {
      this.cancel(id);
    }
  }
}
