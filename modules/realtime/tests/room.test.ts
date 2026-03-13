import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager } from "../src/connection-manager.js";
import { RoomManager } from "../src/room.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { RealtimeConfig, Message } from "../src/types.js";

describe("RoomManager", () => {
  let config: RealtimeConfig;
  let connections: ConnectionManager;
  let rooms: RoomManager;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG, roomHistorySize: 5 };
    connections = new ConnectionManager(config);
    rooms = new RoomManager(config, connections);
    connections.register("c1", "user-1");
    connections.register("c2", "user-2");
    connections.register("c3", "user-3");
  });

  afterEach(() => {
    rooms.destroy();
    connections.destroy();
  });

  // -----------------------------------------------------------------------
  // Join / Leave
  // -----------------------------------------------------------------------

  it("should create room on first join", () => {
    const room = rooms.join("c1", "room-1");
    expect(room.id).toBe("room-1");
    expect(room.members.has("c1")).toBe(true);
  });

  it("should add multiple members to a room", () => {
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");
    const members = rooms.getMembers("room-1");
    expect(members).toHaveLength(2);
    expect(members).toContain("c1");
    expect(members).toContain("c2");
  });

  it("should track rooms on the connection object", () => {
    rooms.join("c1", "room-1");
    rooms.join("c1", "room-2");
    const conn = connections.get("c1");
    expect(conn?.rooms.has("room-1")).toBe(true);
    expect(conn?.rooms.has("room-2")).toBe(true);
  });

  it("should throw when joining with unknown connection", () => {
    expect(() => rooms.join("unknown", "room-1")).toThrow("not found");
  });

  it("should leave a room", () => {
    rooms.join("c1", "room-1");
    const result = rooms.leave("c1", "room-1");
    expect(result).toBe(true);
    expect(rooms.getMembers("room-1")).toHaveLength(0);
  });

  it("should auto-delete empty rooms", () => {
    rooms.join("c1", "room-1");
    rooms.leave("c1", "room-1");
    expect(rooms.getRoom("room-1")).toBeUndefined();
  });

  it("should return false when leaving nonexistent room", () => {
    expect(rooms.leave("c1", "no-room")).toBe(false);
  });

  it("should leave all rooms for a connection", () => {
    rooms.join("c1", "room-1");
    rooms.join("c1", "room-2");
    const left = rooms.leaveAll("c1");
    expect(left).toHaveLength(2);
    expect(connections.get("c1")?.rooms.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Broadcasting helpers
  // -----------------------------------------------------------------------

  it("should return members except a specified one", () => {
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");
    rooms.join("c3", "room-1");
    const others = rooms.getMembersExcept("room-1", "c1");
    expect(others).toHaveLength(2);
    expect(others).not.toContain("c1");
  });

  it("should return member connections", () => {
    rooms.join("c1", "room-1");
    rooms.join("c2", "room-1");
    const conns = rooms.getMemberConnections("room-1");
    expect(conns).toHaveLength(2);
    expect(conns[0]?.id).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Room history
  // -----------------------------------------------------------------------

  it("should store messages in room history", () => {
    rooms.join("c1", "room-1");
    const msg: Message = {
      id: "m1",
      type: "chat",
      payload: "hello",
      roomId: "room-1",
      timestamp: Date.now(),
      sequence: 1,
    };
    rooms.addToHistory("room-1", msg);
    expect(rooms.getHistory("room-1")).toHaveLength(1);
    expect(rooms.getHistory("room-1")[0]?.id).toBe("m1");
  });

  it("should cap history at roomHistorySize", () => {
    rooms.join("c1", "room-1");
    for (let i = 0; i < 10; i++) {
      rooms.addToHistory("room-1", {
        id: `m${i}`,
        type: "chat",
        payload: i,
        roomId: "room-1",
        timestamp: Date.now(),
        sequence: i + 1,
      });
    }
    const history = rooms.getHistory("room-1");
    expect(history).toHaveLength(5); // config.roomHistorySize = 5
    expect(history[0]?.id).toBe("m5"); // oldest kept
    expect(history[4]?.id).toBe("m9"); // newest
  });

  it("should return empty history for unknown room", () => {
    expect(rooms.getHistory("nope")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  it("should set room metadata on creation", () => {
    const room = rooms.join("c1", "room-1", { topic: "General" });
    expect(room.metadata).toEqual({ topic: "General" });
  });

  it("should update room metadata", () => {
    rooms.join("c1", "room-1", { topic: "General" });
    rooms.updateMetadata("room-1", { locked: true });
    expect(rooms.getRoom("room-1")?.metadata).toEqual({
      topic: "General",
      locked: true,
    });
  });

  it("should throw when updating metadata on unknown room", () => {
    expect(() => rooms.updateMetadata("nope", {})).toThrow("not found");
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  it("should emit room:join event", () => {
    const events: string[] = [];
    rooms.on((e) => events.push(e.type));
    rooms.join("c1", "room-1");
    expect(events).toContain("room:join");
  });

  it("should emit room:leave event", () => {
    rooms.join("c1", "room-1");
    const events: string[] = [];
    rooms.on((e) => events.push(e.type));
    rooms.leave("c1", "room-1");
    expect(events).toContain("room:leave");
  });

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  it("should count rooms", () => {
    rooms.join("c1", "room-1");
    rooms.join("c1", "room-2");
    expect(rooms.getRoomCount()).toBe(2);
  });

  it("should list all rooms", () => {
    rooms.join("c1", "room-1");
    rooms.join("c1", "room-2");
    const all = rooms.getAllRooms();
    expect(all).toHaveLength(2);
  });
});
