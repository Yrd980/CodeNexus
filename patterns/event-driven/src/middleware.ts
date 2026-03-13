/**
 * Event middleware pipeline for cross-cutting concerns.
 *
 * Design decisions:
 * - Before/after hooks keep logging, validation, auth, enrichment out of handlers.
 * - A before-hook returning null suppresses the event entirely (conditional routing).
 * - Middleware is ordered: first added = first executed (before) / last executed (after).
 * - Each middleware has a name for debugging pipeline issues.
 */

import type { Event, EventMap, EventMiddleware } from "./types.js";

export class EventMiddlewarePipeline<TEventMap extends EventMap = EventMap> {
  private readonly stack: Array<EventMiddleware<TEventMap>> = [];

  /** Add middleware to the pipeline */
  use(middleware: EventMiddleware<TEventMap>): void {
    this.stack.push(middleware);
  }

  /** Remove middleware by name */
  remove(name: string): boolean {
    const idx = this.stack.findIndex((m) => m.name === name);
    if (idx === -1) return false;
    this.stack.splice(idx, 1);
    return true;
  }

  /** List registered middleware names (in execution order) */
  list(): ReadonlyArray<string> {
    return this.stack.map((m) => m.name);
  }

  /**
   * Run all before-hooks in order.
   * Each hook receives the (possibly transformed) event from the previous hook.
   * If any hook returns null, the event is suppressed and null is returned.
   */
  async runBefore(event: Event): Promise<Event | null> {
    let current: Event | null = event;
    for (const mw of this.stack) {
      if (current === null) break;
      if (mw.before) {
        current = await mw.before(current);
      }
    }
    return current;
  }

  /**
   * Run all after-hooks in reverse order (LIFO — like middleware unwinding).
   */
  async runAfter(event: Event): Promise<void> {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const mw = this.stack[i];
      if (mw?.after) {
        await mw.after(event);
      }
    }
  }
}

// ─── Convenience middleware factories ───────────────────────

/**
 * Creates a logging middleware that logs events as they flow through.
 *
 * ```ts
 * bus.getMiddleware().use(createLoggingMiddleware());
 * ```
 */
export function createLoggingMiddleware<
  TEventMap extends EventMap = EventMap,
>(
  logger: (message: string) => void = console.log,
): EventMiddleware<TEventMap> {
  return {
    name: "logging",
    before(event) {
      logger(`[Event] Publishing: ${event.type} (${event.id})`);
      return event;
    },
    after(event) {
      logger(`[Event] Completed: ${event.type} (${event.id})`);
    },
  };
}

/**
 * Creates a middleware that enriches events with additional metadata.
 *
 * ```ts
 * bus.getMiddleware().use(createEnrichmentMiddleware({
 *   source: "user-service",
 *   environment: "production",
 * }));
 * ```
 */
export function createEnrichmentMiddleware<
  TEventMap extends EventMap = EventMap,
>(
  additionalMetadata: Record<string, unknown>,
): EventMiddleware<TEventMap> {
  return {
    name: "enrichment",
    before(event) {
      return {
        ...event,
        metadata: {
          ...event.metadata,
          ...additionalMetadata,
        },
      };
    },
  };
}

/**
 * Creates a middleware that filters events based on a predicate.
 * Events that don't pass the predicate are suppressed (not delivered to handlers).
 *
 * ```ts
 * bus.getMiddleware().use(createFilterMiddleware(
 *   (event) => event.type !== "internal.heartbeat"
 * ));
 * ```
 */
export function createFilterMiddleware<
  TEventMap extends EventMap = EventMap,
>(
  predicate: (event: Event) => boolean,
): EventMiddleware<TEventMap> {
  return {
    name: "filter",
    before(event) {
      return predicate(event) ? event : null;
    },
  };
}
