import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../src/connection-manager.js";
import { PresenceManager } from "../src/presence.js";
import { RoomManager } from "../src/room.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { RealtimeConfig } from "../src/types.js";

describe("PresenceManager", () => {
  let config: RealtimeConfig;
  let connections: ConnectionManager;
  let rooms: RoomManager;
  let presence: PresenceManager;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG };
    connections = new ConnectionManager(config);
    rooms = new RoomManager(config, connections);
    presence = new PresenceManager(config, connections, rooms);

    connections.register("c1", "user-1");
    connections.register("c2", "user-1"); // same user, two connections
    connections.register("c3", "user-2");
  });

  afterEach(() => {
    presence.destroy();
    rooms.destroy();
    connections.destroy();
  });

  // -----------------------------------------------------------------------
  // Track / Untrack
  // -----------------------------------------------------------------------

  it("should track a connection as online", () => {
    const state = presence.track("c1", "user-1");
    expect(state.userId).toBe("user-1");
    expect(state.status).toBe("online");
    expect(state.connectionId).toBe("c1");
  });

  it("should untrack a connection", () => {
    presence.track("c1", "user-1");
    const removed = presence.untrack("c1");
    expect(removed?.userId).toBe("user-1");
    expect(presence.getByConnection("c1")).toBeUndefined();
  });

  it("should return undefined when untracking unknown connection", () => {
    expect(presence.untrack("nope")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Status updates
  // -----------------------------------------------------------------------

  it("should update presence status", () => {
    presence.track("c1", "user-1");
    presence.setStatus("c1", "away");
    expect(presence.getByConnection("c1")?.status).toBe("away");
  });

  it("should ignore setStatus for unknown connection", () => {
    // Should not throw
    presence.setStatus("nope", "away");
  });

  // -----------------------------------------------------------------------
  // Custom data
  // -----------------------------------------------------------------------

  it("should set custom presence data", () => {
    presence.track("c1", "user-1", { typing: false });
    presence.setCustomData("c1", { typing: true });
    expect(presence.getByConnection("c1")?.customData).toEqual({
      typing: true,
    });
  });

  it("should merge custom data", () => {
    presence.track("c1", "user-1", { typing: false, cursor: { x: 0, y: 0 } });
    presence.setCustomData("c1", { typing: true });
    const data = presence.getByConnection("c1")?.customData;
    expect(data).toEqual({ typing: true, cursor: { x: 0, y: 0 } });
  });

  // -----------------------------------------------------------------------
  // User-level queries
  // -----------------------------------------------------------------------

  it("should return all presence entries for a user", () => {
    presence.track("c1", "user-1");
    presence.track("c2", "user-1");
    const entries = presence.getByUserId("user-1");
    expect(entries).toHaveLength(2);
  });

  it("should compute effective user status as online if any connection is online", () => {
    presence.track("c1", "user-1");
    presence.track("c2", "user-1");
    presence.setStatus("c1", "away");
    // c2 is still online
    expect(presence.getUserStatus("user-1")).toBe("online");
  });

  it("should compute effective user status as away if all connections are away", () => {
    presence.track("c1", "user-1");
    presence.track("c2", "user-1");
    presence.setStatus("c1", "away");
    presence.setStatus("c2", "away");
    expect(presence.getUserStatus("user-1")).toBe("away");
  });

  it("should return offline for unknown user", () => {
    expect(presence.getUserStatus("nobody")).toBe("offline");
  });

  // -----------------------------------------------------------------------
  // Room presence
  // -----------------------------------------------------------------------

  it("should return room presence list", () => {
    presence.track("c1", "user-1");
    presence.track("c3", "user-2");
    rooms.join("c1", "room-1");
    rooms.join("c3", "room-1");

    const roomPresence = presence.getRoomPresence("room-1");
    expect(roomPresence).toHaveLength(2);

    const userIds = roomPresence.map((p) => p.userId);
    expect(userIds).toContain("user-1");
    expect(userIds).toContain("user-2");
  });

  it("should deduplicate users in room presence (multiple connections)", () => {
    presence.track("c1", "user-1");
    presence.track("c2", "user-1"); // same user
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");

    const roomPresence = presence.getRoomPresence("room-1");
    expect(roomPresence).toHaveLength(1);
    expect(roomPresence[0]?.userId).toBe("user-1");
  });

  it("should merge presence status for multi-connection users in a room", () => {
    presence.track("c1", "user-1");
    presence.track("c2", "user-1");
    presence.setStatus("c1", "away");
    // c2 is online
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");

    const roomPresence = presence.getRoomPresence("room-1");
    expect(roomPresence[0]?.status).toBe("online");
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  it("should emit presence:join on track", () => {
    const events: string[] = [];
    presence.on((e) => events.push(e.type));
    presence.track("c1", "user-1");
    expect(events).toContain("presence:join");
  });

  it("should emit presence:leave on untrack", () => {
    presence.track("c1", "user-1");
    const events: string[] = [];
    presence.on((e) => events.push(e.type));
    presence.untrack("c1");
    expect(events).toContain("presence:leave");
  });

  it("should emit presence:update on status change", () => {
    presence.track("c1", "user-1");
    const events: string[] = [];
    presence.on((e) => events.push(e.type));
    presence.setStatus("c1", "away");
    expect(events).toContain("presence:update");
  });

  // -----------------------------------------------------------------------
  // getAll
  // -----------------------------------------------------------------------

  it("should return all presence entries", () => {
    presence.track("c1", "user-1");
    presence.track("c3", "user-2");
    expect(presence.getAll()).toHaveLength(2);
  });
});
