import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConnectionManager } from "../src/connection-manager.js";
import { MessageBroker } from "../src/message-broker.js";
import { RoomManager } from "../src/room.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { Message, RealtimeConfig } from "../src/types.js";

describe("MessageBroker", () => {
  let config: RealtimeConfig;
  let connections: ConnectionManager;
  let rooms: RoomManager;
  let broker: MessageBroker;
  let sent: Array<{ connectionId: string; message: Message }>;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG, roomHistorySize: 10, messageBufferTTL: 5_000 };
    connections = new ConnectionManager(config);
    rooms = new RoomManager(config, connections);
    sent = [];
    broker = new MessageBroker(config, connections, rooms, (connId, msg) => {
      sent.push({ connectionId: connId, message: msg });
    });

    connections.register("c1", "user-1");
    connections.register("c2", "user-2");
    connections.register("c3", "user-3");
  });

  afterEach(() => {
    broker.destroy();
    rooms.destroy();
    connections.destroy();
  });

  // -----------------------------------------------------------------------
  // Send to connection
  // -----------------------------------------------------------------------

  it("should send a message to a specific connection", () => {
    broker.sendToConnection("c1", "notification", { text: "hello" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.connectionId).toBe("c1");
    expect(sent[0]?.message.type).toBe("notification");
    expect(sent[0]?.message.payload).toEqual({ text: "hello" });
  });

  it("should assign a unique message id", () => {
    const msg = broker.sendToConnection("c1", "test", {});
    expect(msg.id).toBeDefined();
    expect(typeof msg.id).toBe("string");
  });

  it("should buffer messages for disconnected connections", () => {
    connections.transition("c1", "disconnected");
    broker.sendToConnection("c1", "test", { data: 1 });
    expect(sent).toHaveLength(0);
    expect(broker.getBufferSize()).toBe(1);
  });

  it("should buffer messages for reconnecting connections", () => {
    connections.transition("c1", "reconnecting");
    broker.sendToConnection("c1", "test", { data: 1 });
    expect(sent).toHaveLength(0);
    expect(broker.getBufferSize()).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Publish to room
  // -----------------------------------------------------------------------

  it("should publish to all room members", () => {
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");
    broker.publishToRoom("room-1", "chat", { text: "hi" });
    expect(sent).toHaveLength(2);
  });

  it("should exclude sender when excludeSender is true", () => {
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");
    broker.publishToRoom("room-1", "chat", { text: "hi" }, {
      senderId: "c1",
      excludeSender: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.connectionId).toBe("c2");
  });

  it("should assign sequence numbers per room", () => {
    rooms.join("c1", "room-1");
    const msg1 = broker.publishToRoom("room-1", "chat", { n: 1 });
    const msg2 = broker.publishToRoom("room-1", "chat", { n: 2 });
    expect(msg1.sequence).toBe(1);
    expect(msg2.sequence).toBe(2);
  });

  it("should maintain independent sequences per room", () => {
    rooms.join("c1", "room-1");
    rooms.join("c1", "room-2");
    broker.publishToRoom("room-1", "chat", { n: 1 });
    broker.publishToRoom("room-1", "chat", { n: 2 });
    const msg = broker.publishToRoom("room-2", "chat", { n: 1 });
    expect(msg.sequence).toBe(1); // room-2 has its own counter
  });

  it("should store messages in room history", () => {
    rooms.join("c1", "room-1");
    broker.publishToRoom("room-1", "chat", { text: "stored" });
    const history = rooms.getHistory("room-1");
    expect(history).toHaveLength(1);
    expect(history[0]?.type).toBe("chat");
  });

  // -----------------------------------------------------------------------
  // Broadcast
  // -----------------------------------------------------------------------

  it("should broadcast to all connections", () => {
    broker.broadcast("system", { msg: "maintenance" });
    expect(sent).toHaveLength(3); // c1, c2, c3
  });

  it("should exclude a connection from broadcast", () => {
    broker.broadcast("system", { msg: "hi" }, { excludeConnectionId: "c1" });
    expect(sent).toHaveLength(2);
    expect(sent.map((s) => s.connectionId)).not.toContain("c1");
  });

  // -----------------------------------------------------------------------
  // Acknowledgment
  // -----------------------------------------------------------------------

  it("should track pending acks when requireAck is true", () => {
    broker.sendToConnection("c1", "important", {}, { requireAck: true });
    const pending = broker.getPendingAcks();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.connectionId).toBe("c1");
  });

  it("should remove pending ack on acknowledge", () => {
    const msg = broker.sendToConnection("c1", "important", {}, {
      requireAck: true,
    });
    const acked = broker.acknowledge(msg.id);
    expect(acked).toBe(true);
    expect(broker.getPendingAcks()).toHaveLength(0);
  });

  it("should return false when acknowledging unknown message", () => {
    expect(broker.acknowledge("unknown-id")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Subscriptions (type filtering)
  // -----------------------------------------------------------------------

  it("should filter messages by subscription", () => {
    broker.subscribe("c1", (type) => type === "chat");
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");

    broker.publishToRoom("room-1", "system", { msg: "ignored" });
    // c1 has a subscription that filters for "chat" only, so "system" won't reach c1
    // c2 has no subscription, so it gets everything
    const c1Messages = sent.filter((s) => s.connectionId === "c1");
    const c2Messages = sent.filter((s) => s.connectionId === "c2");
    expect(c1Messages).toHaveLength(0);
    expect(c2Messages).toHaveLength(1);
  });

  it("should deliver matching messages to subscribed connections", () => {
    broker.subscribe("c1", (type) => type === "chat");
    rooms.join("c1", "room-1");

    broker.publishToRoom("room-1", "chat", { text: "delivered" });
    const c1Messages = sent.filter((s) => s.connectionId === "c1");
    expect(c1Messages).toHaveLength(1);
  });

  it("should allow unsubscribing", () => {
    const unsub = broker.subscribe("c1", (type) => type === "chat");
    unsub();
    rooms.join("c1", "room-1");

    // Now c1 has no subscriptions, so everything passes through
    broker.publishToRoom("room-1", "system", { msg: "delivered" });
    const c1Messages = sent.filter((s) => s.connectionId === "c1");
    expect(c1Messages).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Buffer management
  // -----------------------------------------------------------------------

  it("should flush buffered messages for a connection", () => {
    connections.transition("c1", "reconnecting");
    broker.sendToConnection("c1", "msg1", { n: 1 });
    broker.sendToConnection("c1", "msg2", { n: 2 });

    const flushed = broker.flushBuffer("c1");
    expect(flushed).toHaveLength(2);
    expect(broker.getBufferSize()).toBe(0);
  });

  it("should expire buffered messages past TTL", () => {
    vi.useFakeTimers();
    connections.transition("c1", "reconnecting");
    broker.sendToConnection("c1", "old", { data: "old" });

    vi.advanceTimersByTime(config.messageBufferTTL + 1);

    const flushed = broker.flushBuffer("c1");
    expect(flushed).toHaveLength(0);
    vi.useRealTimers();
  });

  it("should prune expired messages from buffer", () => {
    vi.useFakeTimers();
    connections.transition("c1", "reconnecting");
    broker.sendToConnection("c1", "test", { data: 1 });

    vi.advanceTimersByTime(config.messageBufferTTL + 1);

    const pruned = broker.pruneBuffer();
    expect(pruned).toBe(1);
    expect(broker.getBufferSize()).toBe(0);
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  it("should emit message:send event", () => {
    const events: string[] = [];
    broker.on((e) => events.push(e.type));
    broker.sendToConnection("c1", "test", {});
    expect(events).toContain("message:send");
  });

  it("should emit room:message event on room publish", () => {
    rooms.join("c1", "room-1");
    const events: string[] = [];
    broker.on((e) => events.push(e.type));
    broker.publishToRoom("room-1", "chat", { text: "hi" });
    expect(events).toContain("room:message");
  });

  it("should emit message:ack event on acknowledge", () => {
    const msg = broker.sendToConnection("c1", "test", {}, {
      requireAck: true,
    });
    const events: string[] = [];
    broker.on((e) => events.push(e.type));
    broker.acknowledge(msg.id);
    expect(events).toContain("message:ack");
  });
});
