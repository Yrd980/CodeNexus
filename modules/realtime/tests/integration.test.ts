import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRealtimeServer } from "../src/index.js";
import type { Message, RealtimeServer } from "../src/index.js";

describe("Integration — createRealtimeServer", () => {
  let server: RealtimeServer;
  let sent: Array<{ connectionId: string; message: Message }>;

  beforeEach(() => {
    sent = [];
    server = createRealtimeServer({
      sendFn: (connId, msg) => {
        sent.push({ connectionId: connId, message: msg });
      },
      config: {
        roomHistorySize: 10,
        messageBufferTTL: 5_000,
        maxConnectionsPerUser: 3,
      },
    });
  });

  afterEach(() => {
    server.destroy();
  });

  it("should wire up all components correctly", () => {
    expect(server.connections).toBeDefined();
    expect(server.rooms).toBeDefined();
    expect(server.presence).toBeDefined();
    expect(server.messages).toBeDefined();
    expect(server.recovery).toBeDefined();
  });

  it("should handle the full connect -> join -> message -> leave -> disconnect flow", () => {
    // Connect
    server.connections.register("c1", "user-1");
    server.connections.register("c2", "user-2");
    server.presence.track("c1", "user-1");
    server.presence.track("c2", "user-2");

    // Join room
    server.rooms.join("c1", "chat:general");
    server.rooms.join("c2", "chat:general");

    // Send message
    server.messages.publishToRoom("chat:general", "chat:message", {
      text: "Hello!",
    }, { senderId: "c1", excludeSender: true });

    // c2 should receive it, c1 should not
    expect(sent).toHaveLength(1);
    expect(sent[0]?.connectionId).toBe("c2");

    // Presence
    expect(server.presence.getUserStatus("user-1")).toBe("online");
    const roomPresence = server.presence.getRoomPresence("chat:general");
    expect(roomPresence).toHaveLength(2);

    // Leave
    server.rooms.leave("c1", "chat:general");
    expect(server.rooms.getMembers("chat:general")).toHaveLength(1);

    // Disconnect
    server.presence.untrack("c1");
    server.connections.deregister("c1");
    expect(server.connections.getConnectionCount()).toBe(1);
  });

  it("should handle disconnect -> reconnect -> replay flow", () => {
    // Setup
    server.connections.register("c1", "user-1");
    server.connections.register("c2", "user-2");
    server.rooms.join("c1", "room-a");
    server.rooms.join("c2", "room-a");
    server.presence.track("c1", "user-1");

    // c1 disconnects
    server.recovery.saveSession("c1");
    server.rooms.leaveAll("c1");
    server.presence.untrack("c1");
    server.connections.deregister("c1");

    // Messages arrive while c1 is gone
    server.messages.publishToRoom("room-a", "chat", { text: "missed 1" });
    server.messages.publishToRoom("room-a", "chat", { text: "missed 2" });

    // c1 reconnects with a new connection id
    server.connections.register("c3", "user-1");
    const { restored, replayedMessages } = server.recovery.recover("c1", "c3");

    expect(restored).toBe(true);
    expect(replayedMessages.length).toBeGreaterThan(0);

    // c3 should be in room-a
    expect(server.rooms.getMembers("room-a")).toContain("c3");

    // Presence restored
    expect(server.presence.getUserStatus("user-1")).toBe("online");
  });

  it("should apply config defaults correctly", () => {
    expect(server.config.heartbeatInterval).toBe(30_000);
    expect(server.config.maxConnectionsPerUser).toBe(3);
    expect(server.config.roomHistorySize).toBe(10);
  });

  it("should clean up everything on destroy", () => {
    server.connections.register("c1", "user-1");
    server.rooms.join("c1", "room-a");
    server.presence.track("c1", "user-1");

    server.destroy();

    expect(server.connections.getConnectionCount()).toBe(0);
    expect(server.rooms.getRoomCount()).toBe(0);
    expect(server.presence.getAll()).toHaveLength(0);
  });

  it("should handle multiple users in multiple rooms", () => {
    server.connections.register("c1", "user-1");
    server.connections.register("c2", "user-2");
    server.connections.register("c3", "user-3");

    server.rooms.join("c1", "room-a");
    server.rooms.join("c1", "room-b");
    server.rooms.join("c2", "room-a");
    server.rooms.join("c3", "room-b");

    // Publish to room-a: c1 and c2 should get it
    sent = [];
    server.messages.publishToRoom("room-a", "test", { data: 1 });
    const roomARecipients = sent.map((s) => s.connectionId).sort();
    expect(roomARecipients).toEqual(["c1", "c2"]);

    // Publish to room-b: c1 and c3 should get it
    sent = [];
    server.messages.publishToRoom("room-b", "test", { data: 2 });
    const roomBRecipients = sent.map((s) => s.connectionId).sort();
    expect(roomBRecipients).toEqual(["c1", "c3"]);
  });
});
