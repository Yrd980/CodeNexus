/**
 * Event sourcing primitives: store, replay, and aggregate.
 *
 * Design decisions:
 * - InMemoryEventStore is intentionally simple — production systems should
 *   swap it for Postgres/EventStoreDB, but the interface stays the same.
 * - Snapshots prevent O(n) replay cost for long-lived aggregates.
 * - The Aggregate base class encodes the "apply events to build state" pattern
 *   so teams don't reinvent it (and get it wrong).
 */

import type {
  Event,
  EventMap,
  EventMetadata,
  EventStore,
  Snapshot,
} from "./types.js";
import { generateEventId } from "./types.js";

/**
 * In-memory event store. Suitable for development, testing, and
 * applications where durability is handled elsewhere (e.g., events
 * are also published to Kafka).
 *
 * Replace with a persistent implementation for production.
 */
export class InMemoryEventStore<TEventMap extends EventMap = EventMap>
  implements EventStore<TEventMap>
{
  private readonly events: Array<Event & { aggregateId: string }> = [];

  async append<K extends string & keyof TEventMap>(
    aggregateId: string,
    eventType: K,
    payload: TEventMap[K],
    metadata?: EventMetadata,
  ): Promise<Event<TEventMap[K]>> {
    const event: Event<TEventMap[K]> & { aggregateId: string } = {
      id: generateEventId(),
      type: eventType,
      payload,
      timestamp: Date.now(),
      metadata: { ...metadata },
      aggregateId,
    };
    this.events.push(event);
    return event;
  }

  async getEvents(aggregateId: string): Promise<ReadonlyArray<Event>> {
    return this.events
      .filter((e) => e.aggregateId === aggregateId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getEventsByType<K extends string & keyof TEventMap>(
    eventType: K,
  ): Promise<ReadonlyArray<Event<TEventMap[K]>>> {
    return this.events
      .filter((e) => e.type === eventType)
      .sort(
        (a, b) => a.timestamp - b.timestamp,
      ) as ReadonlyArray<Event<TEventMap[K]>>;
  }

  async getEventsSince(timestamp: number): Promise<ReadonlyArray<Event>> {
    return this.events
      .filter((e) => e.timestamp >= timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getAllEvents(): Promise<ReadonlyArray<Event>> {
    return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Number of stored events (useful in tests) */
  get size(): number {
    return this.events.length;
  }

  /** Clear all events (useful in tests) */
  clear(): void {
    this.events.length = 0;
  }
}

/**
 * Apply function type: given current state + event, produce next state.
 * Pure function — no side effects.
 */
export type ApplyFn<TState, TPayload = unknown> = (
  state: TState,
  event: Event<TPayload>,
) => TState;

/**
 * Aggregate root pattern for event sourcing.
 *
 * Subclass this to model your domain aggregates. Register apply handlers
 * for each event type, then call `loadFromHistory()` or `applyEvent()`
 * to build up state.
 *
 * ```ts
 * class UserAggregate extends Aggregate<UserState, UserEvents> {
 *   constructor() {
 *     super({ name: "", email: "" });
 *     this.registerApply("user.created", (state, event) => ({
 *       ...state,
 *       name: event.payload.name,
 *       email: event.payload.email,
 *     }));
 *   }
 * }
 * ```
 */
export class Aggregate<
  TState,
  TEventMap extends EventMap = EventMap,
> {
  private _state: TState;
  private _version: number = 0;
  private readonly appliers = new Map<string, ApplyFn<TState>>();

  constructor(initialState: TState) {
    this._state = initialState;
  }

  /** Current aggregate state (read-only snapshot) */
  get state(): TState {
    return this._state;
  }

  /** Number of events applied since creation or last snapshot */
  get version(): number {
    return this._version;
  }

  /**
   * Register an apply function for a specific event type.
   * This is how you declare "when event X happens, transform state like this".
   */
  protected registerApply<K extends string & keyof TEventMap>(
    eventType: K,
    fn: ApplyFn<TState, TEventMap[K]>,
  ): void {
    this.appliers.set(eventType, fn as ApplyFn<TState>);
  }

  /**
   * Apply a single event to the aggregate, advancing state and version.
   */
  applyEvent(event: Event): void {
    const applier = this.appliers.get(event.type);
    if (applier) {
      this._state = applier(this._state, event);
    }
    this._version++;
  }

  /**
   * Replay a history of events to rebuild aggregate state.
   * Typically called after loading events from an EventStore.
   */
  loadFromHistory(events: ReadonlyArray<Event>): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Restore state from a snapshot, then apply any events after the snapshot.
   * This avoids replaying the full event history for long-lived aggregates.
   */
  restoreFromSnapshot(
    snapshot: Snapshot<TState>,
    eventsAfterSnapshot: ReadonlyArray<Event>,
  ): void {
    this._state = snapshot.state;
    this._version = snapshot.version;
    for (const event of eventsAfterSnapshot) {
      this.applyEvent(event);
    }
  }

  /** Create a snapshot of the current state */
  createSnapshot(aggregateId: string): Snapshot<TState> {
    return {
      aggregateId,
      state: this._state,
      version: this._version,
      timestamp: Date.now(),
    };
  }
}
