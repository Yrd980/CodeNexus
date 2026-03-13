import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConnectionManager } from "../src/connection-manager.js";
import { DEFAULT_CONFIG } from "../src/types.js";

describe("ConnectionManager", () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager({ ...DEFAULT_CONFIG, maxConnectionsPerUser: 3 });
  });

  afterEach(() => {
    manager.destroy();
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  it("should register a connection", () => {
    const conn = manager.register("c1", "user-1");
    expect(conn.id).toBe("c1");
    expect(conn.userId).toBe("user-1");
    expect(conn.state).toBe("connected");
    expect(conn.rooms.size).toBe(0);
  });

  it("should store metadata on registration", () => {
    const conn = manager.register("c1", "user-1", { device: "mobile" });
    expect(conn.metadata).toEqual({ device: "mobile" });
  });

  it("should track connections per user", () => {
    manager.register("c1", "user-1");
    manager.register("c2", "user-1");
    const conns = manager.getByUserId("user-1");
    expect(conns).toHaveLength(2);
  });

  it("should enforce max connections per user", () => {
    manager.register("c1", "user-1");
    manager.register("c2", "user-1");
    manager.register("c3", "user-1");
    expect(() => manager.register("c4", "user-1")).toThrow(
      "maximum of 3 connections",
    );
  });

  it("should return empty array for unknown user", () => {
    expect(manager.getByUserId("nobody")).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Deregistration
  // -----------------------------------------------------------------------

  it("should deregister a connection", () => {
    manager.register("c1", "user-1");
    const removed = manager.deregister("c1");
    expect(removed?.state).toBe("disconnected");
    expect(manager.get("c1")).toBeUndefined();
  });

  it("should clean up user tracking on deregister", () => {
    manager.register("c1", "user-1");
    manager.deregister("c1");
    expect(manager.getByUserId("user-1")).toEqual([]);
  });

  it("should return undefined when deregistering unknown connection", () => {
    expect(manager.deregister("nope")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  it("should transition connected -> reconnecting", () => {
    manager.register("c1", "user-1");
    manager.transition("c1", "reconnecting");
    expect(manager.get("c1")?.state).toBe("reconnecting");
  });

  it("should transition reconnecting -> connected", () => {
    manager.register("c1", "user-1");
    manager.transition("c1", "reconnecting");
    manager.transition("c1", "connected");
    expect(manager.get("c1")?.state).toBe("connected");
  });

  it("should transition connected -> disconnected", () => {
    manager.register("c1", "user-1");
    manager.transition("c1", "disconnected");
    expect(manager.get("c1")?.state).toBe("disconnected");
  });

  it("should reject invalid state transitions", () => {
    manager.register("c1", "user-1");
    expect(() => manager.transition("c1", "connecting")).toThrow(
      "Invalid state transition",
    );
  });

  it("should reject transitions on disconnected connections", () => {
    manager.register("c1", "user-1");
    manager.transition("c1", "disconnected");
    expect(() => manager.transition("c1", "connected")).toThrow(
      "Invalid state transition",
    );
  });

  it("should throw when transitioning unknown connection", () => {
    expect(() => manager.transition("nope", "connected")).toThrow(
      "not found",
    );
  });

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  it("should update lastHeartbeat on heartbeat()", () => {
    const conn = manager.register("c1", "user-1");
    const before = conn.lastHeartbeat;
    // Advance time slightly
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    manager.heartbeat("c1");
    expect(conn.lastHeartbeat).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it("should detect dead connections via heartbeat monitor", () => {
    vi.useFakeTimers();
    const deadIds: string[] = [];

    manager.register("c1", "user-1");
    manager.startHeartbeatMonitor((id) => deadIds.push(id));

    // The monitor checks every heartbeatInterval. At the first tick (30s),
    // the connection was created at time 0 so delta = 30s, but threshold is
    // heartbeatInterval + heartbeatTimeout = 40s — not dead yet.
    // At the second tick (60s), delta = 60s > 40s — dead.
    vi.advanceTimersByTime(DEFAULT_CONFIG.heartbeatInterval * 2);

    expect(deadIds).toContain("c1");

    manager.stopHeartbeatMonitor();
    vi.useRealTimers();
  });

  it("should not mark connections with recent heartbeat as dead", () => {
    vi.useFakeTimers();
    const deadIds: string[] = [];

    manager.register("c1", "user-1");
    manager.startHeartbeatMonitor((id) => deadIds.push(id));

    // Send a heartbeat before the timeout
    vi.advanceTimersByTime(DEFAULT_CONFIG.heartbeatInterval - 1);
    manager.heartbeat("c1");

    vi.advanceTimersByTime(DEFAULT_CONFIG.heartbeatInterval);

    expect(deadIds).not.toContain("c1");

    manager.stopHeartbeatMonitor();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  it("should update connection metadata", () => {
    manager.register("c1", "user-1", { device: "mobile" });
    manager.updateMetadata("c1", { version: "2.0" });
    expect(manager.get("c1")?.metadata).toEqual({
      device: "mobile",
      version: "2.0",
    });
  });

  it("should throw when updating metadata on unknown connection", () => {
    expect(() => manager.updateMetadata("nope", {})).toThrow("not found");
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  it("should emit connection:open event on register", () => {
    const events: string[] = [];
    manager.on((e) => events.push(e.type));
    manager.register("c1", "user-1");
    expect(events).toContain("connection:open");
  });

  it("should emit connection:close event on deregister", () => {
    manager.register("c1", "user-1");
    const events: string[] = [];
    manager.on((e) => events.push(e.type));
    manager.deregister("c1");
    expect(events).toContain("connection:close");
  });

  it("should allow unsubscribing from events", () => {
    const events: string[] = [];
    const unsub = manager.on((e) => events.push(e.type));
    unsub();
    manager.register("c1", "user-1");
    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  it("should report correct connection count", () => {
    manager.register("c1", "user-1");
    manager.register("c2", "user-2");
    expect(manager.getConnectionCount()).toBe(2);
    manager.deregister("c1");
    expect(manager.getConnectionCount()).toBe(1);
  });

  it("should return all connections", () => {
    manager.register("c1", "user-1");
    manager.register("c2", "user-2");
    const all = manager.getAllConnections();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });
});
