/**
 * @codenexus/event-driven
 *
 * Type-safe event bus with pub/sub, event sourcing primitives,
 * dead letter queue, and middleware pipeline.
 */

// Core event bus
export { EventBus, createEventBus } from "./event-bus.js";

// Event store & aggregate
export { Aggregate, InMemoryEventStore } from "./event-store.js";
export type { ApplyFn } from "./event-store.js";

// Dead letter queue
export { DeadLetterQueue } from "./dead-letter-queue.js";

// Middleware
export {
  EventMiddlewarePipeline,
  createEnrichmentMiddleware,
  createFilterMiddleware,
  createLoggingMiddleware,
} from "./middleware.js";

// Types — re-export everything for consumers
export type {
  DeadLetterEntry,
  DeadLetterQueueConfig,
  Event,
  EventBusConfig,
  EventHandler,
  EventMap,
  EventMetadata,
  EventMiddleware,
  EventStore,
  Snapshot,
  Subscription,
} from "./types.js";
export { WILDCARD, generateEventId } from "./types.js";
export type { EventId } from "./types.js";
