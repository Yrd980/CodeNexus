/**
 * In-Memory Job Store
 *
 * Default storage backend — keeps all jobs in memory.
 * This is the right choice for:
 * - Day-1 startups that don't need persistence across restarts
 * - Background jobs that are re-enqueued on startup anyway
 * - Development and testing
 *
 * When you outgrow this, implement JobStore backed by Redis/Postgres
 * and pass it to createQueue(). Zero code changes in your handlers.
 */

import type { Job, JobStatus, JobStore } from "../types.js";

export class MemoryStore implements JobStore {
  private jobs = new Map<string, Job>();

  add(job: Job): void {
    this.jobs.set(job.id, job);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, updates: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, updates);
  }

  remove(id: string): void {
    this.jobs.delete(id);
  }

  /**
   * Get the next processable job:
   * 1. Must be "waiting" status
   * 2. Must have processAfter <= now (not delayed)
   * 3. Highest priority first
   * 4. FIFO within the same priority (earliest createdAt)
   */
  getNext(): Job | undefined {
    const now = Date.now();
    let best: Job | undefined;

    for (const job of this.jobs.values()) {
      if (job.status !== "waiting") continue;
      if (job.processAfter > now) continue;

      if (
        !best ||
        job.priority > best.priority ||
        (job.priority === best.priority && job.createdAt < best.createdAt)
      ) {
        best = job;
      }
    }

    return best;
  }

  hasDuplicateKey(key: string): boolean {
    for (const job of this.jobs.values()) {
      if (
        job.deduplicationKey === key &&
        (job.status === "waiting" || job.status === "active")
      ) {
        return true;
      }
    }
    return false;
  }

  getByStatus(status: JobStatus): Job[] {
    const result: Job[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === status) {
        result.push(job);
      }
    }
    return result;
  }

  countByStatus(status: JobStatus): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === status) {
        count++;
      }
    }
    return count;
  }

  getAll(): Job[] {
    return Array.from(this.jobs.values());
  }

  clear(): void {
    this.jobs.clear();
  }
}
