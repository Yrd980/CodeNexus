import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConnectionManager } from "../src/connection-manager.js";
import { MessageBroker } from "../src/message-broker.js";
import { PresenceManager } from "../src/presence.js";
import { RecoveryManager } from "../src/recovery.js";
import { RoomManager } from "../src/room.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { Message, RealtimeConfig } from "../src/types.js";

describe("RecoveryManager", () => {
  let config: RealtimeConfig;
  let connections: ConnectionManager;
  let rooms: RoomManager;
  let broker: MessageBroker;
  let presence: PresenceManager;
  let recovery: RecoveryManager;
  let sent: Array<{ connectionId: string; message: Message }>;

  beforeEach(() => {
    config = {
      ...DEFAULT_CONFIG,
      roomHistorySize: 20,
      messageBufferTTL: 10_000,
    };
    connections = new ConnectionManager(config);
    rooms = new RoomManager(config, connections);
    sent = [];
    broker = new MessageBroker(config, connections, rooms, (connId, msg) => {
      sent.push({ connectionId: connId, message: msg });
    });
    presence = new PresenceManager(config, connections, rooms);
    recovery = new RecoveryManager(
      config,
      connections,
      rooms,
      broker,
      presence,
    );
  });

  afterEach(() => {
    recovery.destroy();
    broker.destroy();
    presence.destroy();
    rooms.destroy();
    connections.destroy();
  });

  // -----------------------------------------------------------------------
  // Session persistence
  // -----------------------------------------------------------------------

  it("should save a session on disconnect", () => {
    connections.register("c1", "user-1");
    rooms.join("c1", "room-a");
    rooms.join("c1", "room-b");

    const session = recovery.saveSession("c1");
    expect(session).toBeDefined();
    expect(session!.userId).toBe("user-1");
    expect(session!.rooms).toContain("room-a");
    expect(session!.rooms).toContain("room-b");
  });

  it("should return undefined for unknown connection", () => {
    expect(recovery.saveSession("nope")).toBeUndefined();
  });

  it("should retrieve a saved session", () => {
    connections.register("c1", "user-1");
    recovery.saveSession("c1");
    expect(recovery.getSession("c1")).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Recovery
  // -----------------------------------------------------------------------

  it("should restore room memberships on recovery", () => {
    connections.register("c1", "user-1");
    rooms.join("c1", "room-a");
    rooms.join("c1", "room-b");
    recovery.saveSession("c1");

    // Simulate disconnect
    rooms.leaveAll("c1");
    connections.deregister("c1");

    // Reconnect with new connection
    connections.register("c2", "user-1");
    const result = recovery.recover("c1", "c2");

    expect(result.restored).toBe(true);
    expect(rooms.getMembers("room-a")).toContain("c2");
    expect(rooms.getMembers("room-b")).toContain("c2");
  });

  it("should replay buffered messages on recovery", () => {
    connections.register("c1", "user-1");
    rooms.join("c1", "room-a");
    recovery.saveSession("c1");

    // Simulate disconnect — mark as reconnecting so messages get buffered
    connections.transition("c1", "reconnecting");

    // Messages sent while c1 was disconnected
    broker.sendToConnection("c1", "missed-1", { n: 1 });
    broker.sendToConnection("c1", "missed-2", { n: 2 });

    // Disconnect fully
    rooms.leaveAll("c1");
    connections.deregister("c1");

    // Reconnect
    connections.register("c2", "user-1");
    const result = recovery.recover("c1", "c2");

    expect(result.restored).toBe(true);
    // Should have replayed the 2 buffered messages
    expect(result.replayedMessages.length).toBeGreaterThanOrEqual(2);
    const types = result.replayedMessages.map((m) => m.type);
    expect(types).toContain("missed-1");
    expect(types).toContain("missed-2");
  });

  it("should replay room history messages missed since disconnect", () => {
    connections.register("c1", "user-1");
    connections.register("c2", "user-2");
    rooms.join("c1", "room-a");
    rooms.join("c2", "room-a");

    // c1 sends a message (sequence 1), then disconnects
    broker.publishToRoom("room-a", "chat", { text: "before disconnect" });
    recovery.saveSession("c1"); // saves lastSequence = 1

    // c1 disconnects
    rooms.leaveAll("c1");
    connections.deregister("c1");

    // More messages arrive in room-a while c1 is gone (from c2)
    broker.publishToRoom("room-a", "chat", { text: "missed 1" }, {
      senderId: "c2",
    });
    broker.publishToRoom("room-a", "chat", { text: "missed 2" }, {
      senderId: "c2",
    });

    // c1 reconnects
    connections.register("c3", "user-1");
    const result = recovery.recover("c1", "c3");

    expect(result.restored).toBe(true);
    // Should have sequences 2 and 3 (missed after sequence 1)
    const missed = result.replayedMessages.filter(
      (m) => m.sequence !== undefined && m.sequence > 1,
    );
    expect(missed.length).toBe(2);
  });

  it("should restore presence on recovery", () => {
    connections.register("c1", "user-1");
    presence.track("c1", "user-1");
    recovery.saveSession("c1");

    // Disconnect
    presence.untrack("c1");
    rooms.leaveAll("c1");
    connections.deregister("c1");

    expect(presence.getUserStatus("user-1")).toBe("offline");

    // Reconnect
    connections.register("c2", "user-1");
    recovery.recover("c1", "c2");

    expect(presence.getUserStatus("user-1")).toBe("online");
  });

  it("should fail recovery for unknown session", () => {
    connections.register("c2", "user-1");
    const result = recovery.recover("unknown", "c2");
    expect(result.restored).toBe(false);
    expect(result.replayedMessages).toHaveLength(0);
  });

  it("should fail recovery for expired session", () => {
    vi.useFakeTimers();
    connections.register("c1", "user-1");
    recovery.saveSession("c1");
    rooms.leaveAll("c1");
    connections.deregister("c1");

    // Wait past TTL
    vi.advanceTimersByTime(config.messageBufferTTL + 1);

    connections.register("c2", "user-1");
    const result = recovery.recover("c1", "c2");
    expect(result.restored).toBe(false);

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Backoff
  // -----------------------------------------------------------------------

  it("should calculate exponential backoff", () => {
    // With base=1000, factor=2: attempt 0 = ~1000, attempt 1 = ~2000, etc.
    const delay0 = recovery.calculateBackoff(0);
    const delay1 = recovery.calculateBackoff(1);
    const delay2 = recovery.calculateBackoff(2);

    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay0).toBeLessThanOrEqual(1250); // +25% jitter max
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay2).toBeGreaterThanOrEqual(4000);
  });

  it("should cap backoff at maxDelay", () => {
    const delay = recovery.calculateBackoff(100); // way past max
    expect(delay).toBeLessThanOrEqual(
      config.reconnectBackoff.maxDelay * 1.25 + 1,
    );
  });

  it("should check retry limit", () => {
    expect(recovery.shouldRetry(0)).toBe(true);
    expect(recovery.shouldRetry(config.reconnectMaxRetries - 1)).toBe(true);
    expect(recovery.shouldRetry(config.reconnectMaxRetries)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Session pruning
  // -----------------------------------------------------------------------

  it("should prune expired sessions", () => {
    vi.useFakeTimers();
    connections.register("c1", "user-1");
    recovery.saveSession("c1");
    connections.deregister("c1");

    vi.advanceTimersByTime(config.messageBufferTTL + 1);

    const pruned = recovery.pruneSessions();
    expect(pruned).toBe(1);
    expect(recovery.getSession("c1")).toBeUndefined();

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  it("should emit recovery:start and recovery:complete on success", () => {
    connections.register("c1", "user-1");
    recovery.saveSession("c1");
    rooms.leaveAll("c1");
    connections.deregister("c1");

    connections.register("c2", "user-1");
    const events: string[] = [];
    recovery.on((e) => events.push(e.type));
    recovery.recover("c1", "c2");

    expect(events).toContain("recovery:start");
    expect(events).toContain("recovery:complete");
  });

  it("should emit recovery:fail on failure", () => {
    connections.register("c2", "user-1");
    const events: string[] = [];
    recovery.on((e) => events.push(e.type));
    recovery.recover("unknown", "c2");

    expect(events).toContain("recovery:fail");
  });
});
