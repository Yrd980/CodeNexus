/**
 * Type-safe event bus with pub/sub pattern.
 *
 * Design decisions:
 * - Generic TEventMap enforces compile-time type checking of event names and payloads.
 * - Handler errors are isolated: one failing handler never breaks others.
 * - Wildcard ("*") subscriptions receive all events for cross-cutting concerns.
 * - Max listener warnings detect subscription leaks before they become memory problems.
 */

import { DeadLetterQueue } from "./dead-letter-queue.js";
import { EventMiddlewarePipeline } from "./middleware.js";
import type {
  Event,
  EventBusConfig,
  EventHandler,
  EventMap,
  EventMetadata,
  Subscription,
} from "./types.js";
import { WILDCARD, generateEventId } from "./types.js";

const DEFAULT_CONFIG: EventBusConfig = {
  maxListeners: 100,
  deadLetterEnabled: true,
  retryOnError: true,
};

interface HandlerEntry<TPayload = unknown> {
  id: string;
  handler: EventHandler<TPayload>;
  once: boolean;
}

export class EventBus<TEventMap extends EventMap = EventMap> {
  private readonly config: EventBusConfig;
  private readonly handlers = new Map<string, Array<HandlerEntry>>();
  private readonly deadLetterQueue: DeadLetterQueue | null;
  private readonly middleware: EventMiddlewarePipeline<TEventMap>;
  private readonly warnings = new Set<string>();

  constructor(config?: Partial<EventBusConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deadLetterQueue = this.config.deadLetterEnabled
      ? new DeadLetterQueue()
      : null;
    this.middleware = new EventMiddlewarePipeline<TEventMap>();
  }

  /**
   * Subscribe to an event type. Returns a Subscription handle.
   *
   * ```ts
   * const sub = bus.subscribe("user.created", async (event) => {
   *   console.log(event.payload.email);
   * });
   * sub.unsubscribe(); // clean up
   * ```
   */
  subscribe<K extends string & keyof TEventMap>(
    eventType: K,
    handler: EventHandler<TEventMap[K]>,
  ): Subscription {
    return this.addHandler(eventType, handler as EventHandler, false);
  }

  /**
   * Subscribe to all events (wildcard).
   */
  subscribeAll(handler: EventHandler<unknown>): Subscription {
    return this.addHandler(WILDCARD, handler, false);
  }

  /**
   * Subscribe to an event type, but only for the next occurrence.
   * Automatically unsubscribes after the first invocation.
   */
  once<K extends string & keyof TEventMap>(
    eventType: K,
    handler: EventHandler<TEventMap[K]>,
  ): Subscription {
    return this.addHandler(eventType, handler as EventHandler, true);
  }

  /**
   * Publish an event. Handlers are invoked concurrently.
   * Errors in individual handlers are caught and sent to the dead letter queue.
   * Returns immediately after dispatching — does not wait for handlers.
   */
  async publish<K extends string & keyof TEventMap>(
    eventType: K,
    payload: TEventMap[K],
    metadata?: EventMetadata,
  ): Promise<void> {
    const event = this.createEvent(eventType, payload, metadata);

    // Run middleware before-hooks; a middleware can suppress the event by returning null
    const processedEvent = await this.middleware.runBefore(event);
    if (processedEvent === null) return;

    await this.dispatchToHandlers(eventType, processedEvent);

    // Run middleware after-hooks
    await this.middleware.runAfter(processedEvent);
  }

  /**
   * Publish an event and wait for ALL handlers (including wildcards) to complete.
   * Useful when you need to ensure side effects are done before proceeding.
   */
  async publishAndWait<K extends string & keyof TEventMap>(
    eventType: K,
    payload: TEventMap[K],
    metadata?: EventMetadata,
  ): Promise<void> {
    // Identical to publish — our implementation already awaits all handlers.
    await this.publish(eventType, payload, metadata);
  }

  /** Get the dead letter queue (if enabled) */
  getDeadLetterQueue(): DeadLetterQueue | null {
    return this.deadLetterQueue;
  }

  /** Get the middleware pipeline for adding middleware */
  getMiddleware(): EventMiddlewarePipeline<TEventMap> {
    return this.middleware;
  }

  /** Get the number of subscribers for a given event type */
  listenerCount(eventType: string): number {
    return this.handlers.get(eventType)?.length ?? 0;
  }

  /** Remove all subscriptions, optionally for a specific event type only */
  removeAllListeners(eventType?: string): void {
    if (eventType !== undefined) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }

  /** List all event types that have at least one subscriber */
  eventTypes(): ReadonlyArray<string> {
    return Array.from(this.handlers.keys()).filter(
      (key) => (this.handlers.get(key)?.length ?? 0) > 0,
    );
  }

  // ─── Private ──────────────────────────────────────────────

  private addHandler(
    eventType: string,
    handler: EventHandler,
    once: boolean,
  ): Subscription {
    const entry: HandlerEntry = {
      id: generateEventId(),
      handler,
      once,
    };

    let list = this.handlers.get(eventType);
    if (!list) {
      list = [];
      this.handlers.set(eventType, list);
    }
    list.push(entry);

    // Memory leak detection
    if (
      list.length > this.config.maxListeners &&
      !this.warnings.has(eventType)
    ) {
      this.warnings.add(eventType);
      console.warn(
        `[EventBus] Warning: ${list.length} listeners for "${eventType}" ` +
          `exceeds maxListeners (${this.config.maxListeners}). ` +
          `Possible memory leak.`,
      );
    }

    let unsubscribed = false;
    return {
      id: entry.id,
      eventType,
      unsubscribe: () => {
        if (unsubscribed) return;
        unsubscribed = true;
        const current = this.handlers.get(eventType);
        if (current) {
          const idx = current.indexOf(entry);
          if (idx !== -1) current.splice(idx, 1);
        }
      },
    };
  }

  private createEvent<K extends string & keyof TEventMap>(
    eventType: K,
    payload: TEventMap[K],
    metadata?: EventMetadata,
  ): Event<TEventMap[K]> {
    return {
      id: generateEventId(),
      type: eventType,
      payload,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
      },
    };
  }

  private async dispatchToHandlers(
    eventType: string,
    event: Event,
  ): Promise<void> {
    const typeHandlers = this.getHandlersSnapshot(eventType);
    const wildcardHandlers = this.getHandlersSnapshot(WILDCARD);
    const allHandlers = [...typeHandlers, ...wildcardHandlers];

    // Clean up one-time handlers that were snapshotted
    this.removeOnceHandlers(eventType, typeHandlers);
    this.removeOnceHandlers(WILDCARD, wildcardHandlers);

    const settled = await Promise.allSettled(
      allHandlers.map((entry) => entry.handler(event)),
    );

    // Send rejected results to dead letter queue
    for (const result of settled) {
      if (result.status === "rejected") {
        const error =
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason));

        if (this.deadLetterQueue) {
          this.deadLetterQueue.add(event, error);
        }
      }
    }
  }

  private getHandlersSnapshot(eventType: string): ReadonlyArray<HandlerEntry> {
    const list = this.handlers.get(eventType);
    if (!list || list.length === 0) return [];
    // Return a copy so mutations during iteration are safe
    return [...list];
  }

  private removeOnceHandlers(
    eventType: string,
    snapshot: ReadonlyArray<HandlerEntry>,
  ): void {
    const onceEntries = snapshot.filter((e) => e.once);
    if (onceEntries.length === 0) return;

    const list = this.handlers.get(eventType);
    if (!list) return;

    for (const entry of onceEntries) {
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
    }
  }
}

/**
 * Factory function — the recommended way to create an event bus.
 *
 * ```ts
 * type MyEvents = {
 *   "user.created": { userId: string; email: string };
 *   "order.placed": { orderId: string; total: number };
 * };
 *
 * const bus = createEventBus<MyEvents>();
 * ```
 */
export function createEventBus<TEventMap extends EventMap = EventMap>(
  config?: Partial<EventBusConfig>,
): EventBus<TEventMap> {
  return new EventBus<TEventMap>(config);
}
