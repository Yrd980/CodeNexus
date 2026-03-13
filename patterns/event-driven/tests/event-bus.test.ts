import { describe, expect, it, vi } from "vitest";
import { createEventBus, EventBus } from "../src/event-bus.js";
import type { Event, EventHandler } from "../src/types.js";

// ─── Test event map ─────────────────────────────────────────

type TestEvents = {
  "user.created": { userId: string; email: string };
  "user.deleted": { userId: string };
  "order.placed": { orderId: string; total: number };
};

describe("EventBus", () => {
  // ─── Basic pub/sub ──────────────────────────────────────

  it("should deliver events to subscribers", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();

    bus.subscribe("user.created", handler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user.created",
        payload: { userId: "u1", email: "a@b.com" },
      }),
    );
  });

  it("should deliver events to multiple subscribers", async () => {
    const bus = createEventBus<TestEvents>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe("user.created", handler1);
    bus.subscribe("user.created", handler2);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("should not deliver events to subscribers of other types", async () => {
    const bus = createEventBus<TestEvents>();
    const userHandler = vi.fn();
    const orderHandler = vi.fn();

    bus.subscribe("user.created", userHandler);
    bus.subscribe("order.placed", orderHandler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });

    expect(userHandler).toHaveBeenCalledOnce();
    expect(orderHandler).not.toHaveBeenCalled();
  });

  it("should include metadata in events", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();

    bus.subscribe("user.created", handler);
    await bus.publish(
      "user.created",
      { userId: "u1", email: "a@b.com" },
      { source: "user-service", correlationId: "req-123" },
    );

    const event: Event<TestEvents["user.created"]> = handler.mock.calls[0]![0];
    expect(event.metadata.source).toBe("user-service");
    expect(event.metadata.correlationId).toBe("req-123");
  });

  it("should generate unique event IDs", async () => {
    const bus = createEventBus<TestEvents>();
    const ids: string[] = [];

    bus.subscribe("user.created", (event) => {
      ids.push(event.id);
    });

    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });
    await bus.publish("user.created", { userId: "u2", email: "b@c.com" });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  // ─── Unsubscribe ────────────────────────────────────────

  it("should stop delivering events after unsubscribe", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();

    const sub = bus.subscribe("user.created", handler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });
    expect(handler).toHaveBeenCalledOnce();

    sub.unsubscribe();
    await bus.publish("user.created", { userId: "u2", email: "b@c.com" });
    expect(handler).toHaveBeenCalledOnce(); // Still 1, not 2
  });

  it("should be safe to unsubscribe multiple times", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();

    const sub = bus.subscribe("user.created", handler);
    sub.unsubscribe();
    sub.unsubscribe(); // Should not throw
    sub.unsubscribe();

    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });
    expect(handler).not.toHaveBeenCalled();
  });

  // ─── once() ─────────────────────────────────────────────

  it("should auto-unsubscribe after once()", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();

    bus.once("user.created", handler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });
    await bus.publish("user.created", { userId: "u2", email: "b@c.com" });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("should allow once() alongside persistent subscribers", async () => {
    const bus = createEventBus<TestEvents>();
    const onceHandler = vi.fn();
    const persistentHandler = vi.fn();

    bus.once("user.created", onceHandler);
    bus.subscribe("user.created", persistentHandler);

    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });
    await bus.publish("user.created", { userId: "u2", email: "b@c.com" });

    expect(onceHandler).toHaveBeenCalledOnce();
    expect(persistentHandler).toHaveBeenCalledTimes(2);
  });

  // ─── Wildcard ───────────────────────────────────────────

  it("should deliver all events to wildcard subscribers", async () => {
    const bus = createEventBus<TestEvents>();
    const wildcardHandler = vi.fn();

    bus.subscribeAll(wildcardHandler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });
    await bus.publish("order.placed", { orderId: "o1", total: 99 });

    expect(wildcardHandler).toHaveBeenCalledTimes(2);
    expect(wildcardHandler.mock.calls[0]![0]).toMatchObject({
      type: "user.created",
    });
    expect(wildcardHandler.mock.calls[1]![0]).toMatchObject({
      type: "order.placed",
    });
  });

  it("should deliver to both type-specific and wildcard handlers", async () => {
    const bus = createEventBus<TestEvents>();
    const specificHandler = vi.fn();
    const wildcardHandler = vi.fn();

    bus.subscribe("user.created", specificHandler);
    bus.subscribeAll(wildcardHandler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });

    expect(specificHandler).toHaveBeenCalledOnce();
    expect(wildcardHandler).toHaveBeenCalledOnce();
  });

  // ─── Error isolation ────────────────────────────────────

  it("should isolate handler errors — other handlers still run", async () => {
    const bus = createEventBus<TestEvents>();
    const failingHandler: EventHandler<TestEvents["user.created"]> = async () => {
      throw new Error("handler exploded");
    };
    const survivingHandler = vi.fn();

    bus.subscribe("user.created", failingHandler);
    bus.subscribe("user.created", survivingHandler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });

    expect(survivingHandler).toHaveBeenCalledOnce();
  });

  it("should send failed handler events to the dead letter queue", async () => {
    const bus = createEventBus<TestEvents>({ deadLetterEnabled: true });
    const failingHandler: EventHandler<TestEvents["user.created"]> = async () => {
      throw new Error("handler exploded");
    };

    bus.subscribe("user.created", failingHandler);
    await bus.publish("user.created", { userId: "u1", email: "a@b.com" });

    const dlq = bus.getDeadLetterQueue()!;
    expect(dlq.size).toBe(1);

    const entries = dlq.getAll();
    expect(entries[0]!.error.message).toBe("handler exploded");
    expect(entries[0]!.event.type).toBe("user.created");
  });

  it("should not have a dead letter queue when disabled", () => {
    const bus = createEventBus<TestEvents>({ deadLetterEnabled: false });
    expect(bus.getDeadLetterQueue()).toBeNull();
  });

  // ─── publishAndWait ─────────────────────────────────────

  it("should wait for all handlers to complete with publishAndWait", async () => {
    const bus = createEventBus<TestEvents>();
    let completed = false;

    bus.subscribe("user.created", async () => {
      await new Promise((r) => setTimeout(r, 50));
      completed = true;
    });

    await bus.publishAndWait("user.created", {
      userId: "u1",
      email: "a@b.com",
    });
    expect(completed).toBe(true);
  });

  // ─── Utility methods ───────────────────────────────────

  it("should report listener count correctly", () => {
    const bus = createEventBus<TestEvents>();

    expect(bus.listenerCount("user.created")).toBe(0);

    const sub1 = bus.subscribe("user.created", vi.fn());
    bus.subscribe("user.created", vi.fn());
    expect(bus.listenerCount("user.created")).toBe(2);

    sub1.unsubscribe();
    expect(bus.listenerCount("user.created")).toBe(1);
  });

  it("should list event types with subscribers", () => {
    const bus = createEventBus<TestEvents>();

    bus.subscribe("user.created", vi.fn());
    bus.subscribe("order.placed", vi.fn());

    const types = bus.eventTypes();
    expect(types).toContain("user.created");
    expect(types).toContain("order.placed");
    expect(types).not.toContain("user.deleted");
  });

  it("should remove all listeners", () => {
    const bus = createEventBus<TestEvents>();

    bus.subscribe("user.created", vi.fn());
    bus.subscribe("order.placed", vi.fn());
    bus.removeAllListeners();

    expect(bus.listenerCount("user.created")).toBe(0);
    expect(bus.listenerCount("order.placed")).toBe(0);
  });

  it("should remove listeners for a specific event type", () => {
    const bus = createEventBus<TestEvents>();

    bus.subscribe("user.created", vi.fn());
    bus.subscribe("order.placed", vi.fn());
    bus.removeAllListeners("user.created");

    expect(bus.listenerCount("user.created")).toBe(0);
    expect(bus.listenerCount("order.placed")).toBe(1);
  });

  // ─── Max listeners warning ─────────────────────────────

  it("should warn when maxListeners is exceeded", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = createEventBus<TestEvents>({ maxListeners: 2 });

    bus.subscribe("user.created", vi.fn());
    bus.subscribe("user.created", vi.fn());
    expect(warnSpy).not.toHaveBeenCalled();

    bus.subscribe("user.created", vi.fn());
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("maxListeners"),
    );

    warnSpy.mockRestore();
  });

  // ─── Factory function ──────────────────────────────────

  it("createEventBus should return an EventBus instance", () => {
    const bus = createEventBus<TestEvents>();
    expect(bus).toBeInstanceOf(EventBus);
  });
});
