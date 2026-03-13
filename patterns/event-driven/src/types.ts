/**
 * Core type definitions for the event-driven module.
 *
 * Design decision: We use branded types and mapped types extensively
 * to catch event name typos at compile time rather than runtime.
 * This is the #1 source of bugs in event-driven systems.
 */

/** Unique identifier for events, subscriptions, and dead letter entries */
export type EventId = string & { readonly __brand: "EventId" };

/** Metadata attached to every event for tracing and debugging */
export interface EventMetadata {
  /** Identifies the service/module that produced the event */
  readonly source?: string;
  /** Trace correlation across a chain of events */
  readonly correlationId?: string;
  /** Identifies the event that caused this one */
  readonly causationId?: EventId;
  /** Arbitrary key-value pairs for extensibility */
  readonly [key: string]: unknown;
}

/** An immutable domain event */
export interface Event<TPayload = unknown> {
  readonly id: EventId;
  readonly type: string;
  readonly payload: TPayload;
  readonly timestamp: number;
  readonly metadata: EventMetadata;
}

/** Async function that processes an event */
export type EventHandler<TPayload = unknown> = (
  event: Event<TPayload>,
) => Promise<void> | void;

/** Configuration for the event bus */
export interface EventBusConfig {
  /**
   * Maximum number of listeners per event type.
   * Exceeding this emits a warning to detect memory leaks.
   * @default 100
   */
  readonly maxListeners: number;

  /**
   * When true, failed handler invocations are sent to the dead letter queue
   * instead of being silently swallowed.
   * @default true
   */
  readonly deadLetterEnabled: boolean;

  /**
   * When true, publishing will catch handler errors and continue
   * invoking remaining handlers instead of short-circuiting.
   * @default true
   */
  readonly retryOnError: boolean;
}

/** A handle returned when subscribing, used to unsubscribe */
export interface Subscription {
  readonly id: string;
  readonly eventType: string;
  /** Remove this subscription. Safe to call multiple times. */
  unsubscribe(): void;
}

/**
 * Mapped type for declaring a type-safe event registry.
 *
 * Usage:
 * ```ts
 * type MyEvents = {
 *   "user.created": { userId: string; email: string };
 *   "order.placed": { orderId: string; total: number };
 * };
 * const bus = createEventBus<MyEvents>();
 * ```
 */
export type EventMap = Record<string, unknown>;

/** Wildcard event type constant — subscribes to every event */
export const WILDCARD = "*" as const;

/** Dead letter entry wrapping a failed event */
export interface DeadLetterEntry<TPayload = unknown> {
  readonly id: string;
  readonly event: Event<TPayload>;
  readonly error: Error;
  readonly failedAt: number;
  retryCount: number;
  readonly maxRetries: number;
}

/** Configuration for the dead letter queue */
export interface DeadLetterQueueConfig {
  /**
   * Maximum number of retry attempts before an entry is considered permanently failed.
   * @default 3
   */
  readonly maxRetries: number;
}

/** A snapshot of aggregate state at a specific version */
export interface Snapshot<TState> {
  readonly aggregateId: string;
  readonly state: TState;
  readonly version: number;
  readonly timestamp: number;
}

/** Interface for persisting and retrieving events */
export interface EventStore<TEventMap extends EventMap = EventMap> {
  /** Append an event to the store */
  append<K extends string & keyof TEventMap>(
    aggregateId: string,
    eventType: K,
    payload: TEventMap[K],
    metadata?: EventMetadata,
  ): Promise<Event<TEventMap[K]>>;

  /** Get all events for an aggregate, ordered by timestamp */
  getEvents(aggregateId: string): Promise<ReadonlyArray<Event>>;

  /** Get events filtered by type */
  getEventsByType<K extends string & keyof TEventMap>(
    eventType: K,
  ): Promise<ReadonlyArray<Event<TEventMap[K]>>>;

  /** Get events after a specific timestamp */
  getEventsSince(timestamp: number): Promise<ReadonlyArray<Event>>;

  /** Get all events across all aggregates */
  getAllEvents(): Promise<ReadonlyArray<Event>>;
}

/**
 * Middleware that can intercept events before/after handling.
 *
 * Middleware operates on the generic Event type (not typed per event name)
 * because cross-cutting concerns (logging, enrichment, filtering) apply
 * across all event types uniformly.
 *
 * The TEventMap parameter is kept for consistency with other APIs but
 * does not constrain the event payload in before/after hooks.
 */
export interface EventMiddleware<_TEventMap extends EventMap = EventMap> {
  /** Unique name for this middleware (for debugging) */
  readonly name: string;

  /** Called before handlers are invoked. Return null to suppress the event. */
  before?(event: Event): Promise<Event | null> | Event | null;

  /** Called after all handlers complete successfully */
  after?(event: Event): Promise<void> | void;
}

/** Utility to generate a unique event ID */
export function generateEventId(): EventId {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `evt_${timestamp}_${random}` as EventId;
}
