/**
 * Typed Event Emitter
 *
 * Minimal typed event emitter — no external deps needed.
 * Used internally by Queue and Worker for lifecycle events.
 */

import type { QueueEventListener, QueueEventMap, QueueEventName } from "./types.js";

export class TypedEventEmitter {
  private listeners = new Map<QueueEventName, Set<QueueEventListener<QueueEventName>>>();

  on<E extends QueueEventName>(event: E, listener: QueueEventListener<E>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as QueueEventListener<QueueEventName>);
    return this;
  }

  off<E extends QueueEventName>(event: E, listener: QueueEventListener<E>): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as QueueEventListener<QueueEventName>);
    }
    return this;
  }

  emit<E extends QueueEventName>(event: E, data: QueueEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(data);
      } catch {
        // Listener errors should not crash the queue system.
        // We silently swallow — the queue:error event can be used for observability.
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
