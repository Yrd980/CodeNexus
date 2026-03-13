import { describe, expect, it } from "vitest";
import { Aggregate, InMemoryEventStore } from "../src/event-store.js";
import type { Event } from "../src/types.js";

// ─── Test event map ─────────────────────────────────────────

type AccountEvents = {
  "account.opened": { owner: string; initialBalance: number };
  "account.deposited": { amount: number };
  "account.withdrawn": { amount: number };
  "account.closed": { reason: string };
};

interface AccountState {
  owner: string;
  balance: number;
  isOpen: boolean;
}

class AccountAggregate extends Aggregate<AccountState, AccountEvents> {
  constructor() {
    super({ owner: "", balance: 0, isOpen: false });

    this.registerApply("account.opened", (state, event) => ({
      ...state,
      owner: event.payload.owner,
      balance: event.payload.initialBalance,
      isOpen: true,
    }));

    this.registerApply("account.deposited", (state, event) => ({
      ...state,
      balance: state.balance + event.payload.amount,
    }));

    this.registerApply("account.withdrawn", (state, event) => ({
      ...state,
      balance: state.balance - event.payload.amount,
    }));

    this.registerApply("account.closed", (state) => ({
      ...state,
      isOpen: false,
    }));
  }
}

describe("InMemoryEventStore", () => {
  it("should append and retrieve events for an aggregate", async () => {
    const store = new InMemoryEventStore<AccountEvents>();

    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });
    await store.append("acc-1", "account.deposited", { amount: 50 });

    const events = await store.getEvents("acc-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("account.opened");
    expect(events[1]!.type).toBe("account.deposited");
  });

  it("should isolate events by aggregate ID", async () => {
    const store = new InMemoryEventStore<AccountEvents>();

    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });
    await store.append("acc-2", "account.opened", {
      owner: "Bob",
      initialBalance: 200,
    });

    const events1 = await store.getEvents("acc-1");
    const events2 = await store.getEvents("acc-2");

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(
      (events1[0] as Event<AccountEvents["account.opened"]>).payload.owner,
    ).toBe("Alice");
    expect(
      (events2[0] as Event<AccountEvents["account.opened"]>).payload.owner,
    ).toBe("Bob");
  });

  it("should filter events by type", async () => {
    const store = new InMemoryEventStore<AccountEvents>();

    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });
    await store.append("acc-1", "account.deposited", { amount: 50 });
    await store.append("acc-2", "account.deposited", { amount: 75 });

    const deposits = await store.getEventsByType("account.deposited");
    expect(deposits).toHaveLength(2);
    expect(deposits[0]!.payload.amount).toBe(50);
    expect(deposits[1]!.payload.amount).toBe(75);
  });

  it("should filter events since a timestamp", async () => {
    const store = new InMemoryEventStore<AccountEvents>();

    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });

    const midpoint = Date.now();
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));

    await store.append("acc-1", "account.deposited", { amount: 50 });

    const recent = await store.getEventsSince(midpoint);
    // Should include only the deposit (or both if timestamps are close)
    // We check that we get at least the deposit
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent.some((e) => e.type === "account.deposited")).toBe(true);
  });

  it("should return all events sorted by timestamp", async () => {
    const store = new InMemoryEventStore<AccountEvents>();

    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });
    await store.append("acc-2", "account.opened", {
      owner: "Bob",
      initialBalance: 200,
    });
    await store.append("acc-1", "account.deposited", { amount: 50 });

    const all = await store.getAllEvents();
    expect(all).toHaveLength(3);

    // Timestamps should be non-decreasing
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.timestamp).toBeGreaterThanOrEqual(all[i - 1]!.timestamp);
    }
  });

  it("should track size and support clear", async () => {
    const store = new InMemoryEventStore<AccountEvents>();

    expect(store.size).toBe(0);

    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });
    expect(store.size).toBe(1);

    store.clear();
    expect(store.size).toBe(0);
  });

  it("should return events with correct structure", async () => {
    const store = new InMemoryEventStore<AccountEvents>();

    const event = await store.append(
      "acc-1",
      "account.opened",
      { owner: "Alice", initialBalance: 100 },
      { source: "test" },
    );

    expect(event.id).toMatch(/^evt_/);
    expect(event.type).toBe("account.opened");
    expect(event.payload).toEqual({ owner: "Alice", initialBalance: 100 });
    expect(event.timestamp).toBeTypeOf("number");
    expect(event.metadata.source).toBe("test");
  });
});

describe("Aggregate", () => {
  it("should build state by applying events", async () => {
    const store = new InMemoryEventStore<AccountEvents>();
    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });
    await store.append("acc-1", "account.deposited", { amount: 50 });
    await store.append("acc-1", "account.withdrawn", { amount: 30 });

    const agg = new AccountAggregate();
    const events = await store.getEvents("acc-1");
    agg.loadFromHistory(events);

    expect(agg.state).toEqual({
      owner: "Alice",
      balance: 120, // 100 + 50 - 30
      isOpen: true,
    });
    expect(agg.version).toBe(3);
  });

  it("should start with initial state and version 0", () => {
    const agg = new AccountAggregate();

    expect(agg.state).toEqual({
      owner: "",
      balance: 0,
      isOpen: false,
    });
    expect(agg.version).toBe(0);
  });

  it("should increment version for unknown event types too", () => {
    const agg = new AccountAggregate();
    // Apply an event with an unregistered type
    agg.applyEvent({
      id: "evt_test" as any,
      type: "unknown.event",
      payload: {},
      timestamp: Date.now(),
      metadata: {},
    });

    // State should be unchanged, but version incremented
    expect(agg.version).toBe(1);
    expect(agg.state).toEqual({
      owner: "",
      balance: 0,
      isOpen: false,
    });
  });

  // ─── Snapshots ──────────────────────────────────────────

  it("should create a snapshot of current state", async () => {
    const store = new InMemoryEventStore<AccountEvents>();
    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });

    const agg = new AccountAggregate();
    agg.loadFromHistory(await store.getEvents("acc-1"));

    const snapshot = agg.createSnapshot("acc-1");
    expect(snapshot.aggregateId).toBe("acc-1");
    expect(snapshot.state).toEqual({
      owner: "Alice",
      balance: 100,
      isOpen: true,
    });
    expect(snapshot.version).toBe(1);
    expect(snapshot.timestamp).toBeTypeOf("number");
  });

  it("should restore from snapshot and apply subsequent events", async () => {
    const store = new InMemoryEventStore<AccountEvents>();
    await store.append("acc-1", "account.opened", {
      owner: "Alice",
      initialBalance: 100,
    });

    // Build aggregate and take snapshot
    const agg1 = new AccountAggregate();
    agg1.loadFromHistory(await store.getEvents("acc-1"));
    const snapshot = agg1.createSnapshot("acc-1");

    // More events after the snapshot
    await store.append("acc-1", "account.deposited", { amount: 200 });
    await store.append("acc-1", "account.withdrawn", { amount: 50 });

    // All events include the original, so filter to only events after snapshot
    const allEvents = await store.getEvents("acc-1");
    const eventsAfterSnapshot = allEvents.slice(snapshot.version);

    // Restore into a fresh aggregate
    const agg2 = new AccountAggregate();
    agg2.restoreFromSnapshot(snapshot, eventsAfterSnapshot);

    expect(agg2.state).toEqual({
      owner: "Alice",
      balance: 250, // 100 + 200 - 50
      isOpen: true,
    });
    expect(agg2.version).toBe(3);
  });
});
