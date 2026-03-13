/**
 * Dead letter queue for events whose handlers failed.
 *
 * Design decisions:
 * - Failed events must never be silently lost — that's how you get
 *   inconsistent state and hours of debugging.
 * - Retry with a cap: infinite retries would just hammer a broken handler.
 * - Inspection API lets operators see exactly what failed and why.
 * - Replay lets you re-process once the root cause is fixed.
 */

import type { DeadLetterEntry, DeadLetterQueueConfig, Event } from "./types.js";
import { generateEventId } from "./types.js";

const DEFAULT_DLQ_CONFIG: DeadLetterQueueConfig = {
  maxRetries: 3,
};

export class DeadLetterQueue {
  private readonly config: DeadLetterQueueConfig;
  private readonly entries: Array<DeadLetterEntry> = [];

  constructor(config?: Partial<DeadLetterQueueConfig>) {
    this.config = { ...DEFAULT_DLQ_CONFIG, ...config };
  }

  /**
   * Add a failed event to the dead letter queue.
   * Called internally by the EventBus when a handler throws.
   */
  add(event: Event, error: Error): DeadLetterEntry {
    const entry: DeadLetterEntry = {
      id: generateEventId(),
      event,
      error,
      failedAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Get all entries in the dead letter queue */
  getAll(): ReadonlyArray<DeadLetterEntry> {
    return [...this.entries];
  }

  /** Get entries that are eligible for retry (haven't exceeded maxRetries) */
  getRetryable(): ReadonlyArray<DeadLetterEntry> {
    return this.entries.filter((e) => e.retryCount < e.maxRetries);
  }

  /** Get entries that have exceeded their retry limit */
  getPermanentlyFailed(): ReadonlyArray<DeadLetterEntry> {
    return this.entries.filter((e) => e.retryCount >= e.maxRetries);
  }

  /** Number of entries in the queue */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Retry a specific dead letter entry by running the provided handler.
   * Increments the retry count. If the handler succeeds, the entry
   * is removed from the queue.
   *
   * Returns true if the retry succeeded, false if it failed again.
   */
  async retry(
    entryId: string,
    handler: (event: Event) => Promise<void> | void,
  ): Promise<boolean> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) {
      throw new Error(`Dead letter entry "${entryId}" not found`);
    }

    if (entry.retryCount >= entry.maxRetries) {
      throw new Error(
        `Dead letter entry "${entryId}" has exceeded max retries (${entry.maxRetries})`,
      );
    }

    entry.retryCount++;

    try {
      await handler(entry.event);
      // Success — remove from queue
      const idx = this.entries.indexOf(entry);
      if (idx !== -1) this.entries.splice(idx, 1);
      return true;
    } catch {
      // Still failing — stays in queue with incremented retry count
      return false;
    }
  }

  /**
   * Replay all retryable entries through the provided handler.
   * Returns a summary of successes and failures.
   */
  async replayAll(
    handler: (event: Event) => Promise<void> | void,
  ): Promise<{ succeeded: number; failed: number }> {
    const retryable = this.getRetryable();
    let succeeded = 0;
    let failed = 0;

    for (const entry of retryable) {
      const ok = await this.retry(entry.id, handler);
      if (ok) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return { succeeded, failed };
  }

  /** Remove a specific entry from the queue (e.g., after manual inspection) */
  remove(entryId: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  /** Clear the entire dead letter queue */
  clear(): void {
    this.entries.length = 0;
  }
}
