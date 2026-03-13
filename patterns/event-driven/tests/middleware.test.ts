import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../src/event-bus.js";
import {
  createEnrichmentMiddleware,
  createFilterMiddleware,
  createLoggingMiddleware,
  EventMiddlewarePipeline,
} from "../src/middleware.js";
import type { Event, EventId, EventMiddleware } from "../src/types.js";

type TestEvents = {
  "user.created": { userId: string };
  "internal.heartbeat": Record<string, never>;
  "order.placed": { orderId: string };
};

function makeEvent(type: string, payload: unknown = {}): Event {
  return {
    id: "evt_test_abc" as EventId,
    type,
    payload,
    timestamp: Date.now(),
    metadata: {},
  };
}

describe("EventMiddlewarePipeline", () => {
  it("should run before-hooks in order and pass transformed events", async () => {
    const pipeline = new EventMiddlewarePipeline<TestEvents>();

    pipeline.use({
      name: "add-source",
      before(event) {
        return { ...event, metadata: { ...event.metadata, source: "mw1" } };
      },
    });

    pipeline.use({
      name: "add-env",
      before(event) {
        return {
          ...event,
          metadata: { ...event.metadata, environment: "test" },
        };
      },
    });

    const event = makeEvent("user.created", { userId: "u1" });
    const result = await pipeline.runBefore(event);

    expect(result).not.toBeNull();
    expect(result!.metadata.source).toBe("mw1");
    expect(result!.metadata.environment).toBe("test");
  });

  it("should suppress events when before-hook returns null", async () => {
    const pipeline = new EventMiddlewarePipeline<TestEvents>();

    pipeline.use({
      name: "suppressor",
      before() {
        return null;
      },
    });

    pipeline.use({
      name: "should-not-run",
      before: vi.fn().mockReturnValue(makeEvent("user.created")),
    });

    const result = await pipeline.runBefore(makeEvent("user.created"));
    expect(result).toBeNull();
  });

  it("should run after-hooks in reverse order", async () => {
    const pipeline = new EventMiddlewarePipeline<TestEvents>();
    const order: string[] = [];

    pipeline.use({
      name: "first",
      after() {
        order.push("first");
      },
    });

    pipeline.use({
      name: "second",
      after() {
        order.push("second");
      },
    });

    await pipeline.runAfter(makeEvent("user.created"));
    expect(order).toEqual(["second", "first"]);
  });

  it("should remove middleware by name", () => {
    const pipeline = new EventMiddlewarePipeline<TestEvents>();

    pipeline.use({ name: "a" });
    pipeline.use({ name: "b" });
    pipeline.use({ name: "c" });

    expect(pipeline.list()).toEqual(["a", "b", "c"]);

    expect(pipeline.remove("b")).toBe(true);
    expect(pipeline.list()).toEqual(["a", "c"]);

    expect(pipeline.remove("nonexistent")).toBe(false);
  });
});

describe("Middleware integration with EventBus", () => {
  it("should apply middleware before handlers receive events", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();

    bus.getMiddleware().use(
      createEnrichmentMiddleware<TestEvents>({
        source: "integration-test",
      }),
    );

    bus.subscribe("user.created", handler);
    await bus.publish("user.created", { userId: "u1" });

    const receivedEvent: Event = handler.mock.calls[0]![0];
    expect(receivedEvent.metadata.source).toBe("integration-test");
  });

  it("should suppress events via filter middleware", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();

    bus.getMiddleware().use(
      createFilterMiddleware<TestEvents>(
        (event) => event.type !== "internal.heartbeat",
      ),
    );

    bus.subscribe("internal.heartbeat", handler);
    await bus.publish("internal.heartbeat", {});

    expect(handler).not.toHaveBeenCalled();
  });

  it("should log events with logging middleware", async () => {
    const bus = createEventBus<TestEvents>();
    const logs: string[] = [];

    bus.getMiddleware().use(
      createLoggingMiddleware<TestEvents>((msg) => logs.push(msg)),
    );

    bus.subscribe("user.created", vi.fn());
    await bus.publish("user.created", { userId: "u1" });

    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("Publishing");
    expect(logs[0]).toContain("user.created");
    expect(logs[1]).toContain("Completed");
    expect(logs[1]).toContain("user.created");
  });
});

describe("Middleware factories", () => {
  it("createLoggingMiddleware should have correct name", () => {
    const mw = createLoggingMiddleware();
    expect(mw.name).toBe("logging");
  });

  it("createEnrichmentMiddleware should have correct name", () => {
    const mw = createEnrichmentMiddleware({ env: "prod" });
    expect(mw.name).toBe("enrichment");
  });

  it("createFilterMiddleware should have correct name", () => {
    const mw = createFilterMiddleware(() => true);
    expect(mw.name).toBe("filter");
  });
});
