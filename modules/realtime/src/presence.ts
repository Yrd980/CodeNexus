/**
 * Presence Manager — tracks who is online, away, or offline.
 *
 * "Who's online?" is the first real-time feature every app ships. Getting it
 * right means handling:
 * - Multiple connections per user (phone + laptop)
 * - Graceful degradation when connections drop without clean close
 * - Custom presence data (typing indicators, cursor positions)
 * - Per-room presence lists
 *
 * Design: Presence is keyed by (userId, connectionId) internally but exposed
 * as per-user externally. A user is "online" if ANY of their connections are
 * online. Inspired by Phoenix Channels' presence tracking approach.
 */

import type {
  ConnectionManager,
} from "./connection-manager.js";
import type { RoomManager } from "./room.js";
import type {
  EventListener,
  PresenceState,
  PresenceStatus,
  RealtimeConfig,
  RealtimeEvent,
} from "./types.js";

export class PresenceManager {
  /** Keyed by connectionId */
  private presenceByConnection = new Map<string, PresenceState>();
  private listeners: EventListener[] = [];
  private roomManager: RoomManager;

  constructor(
    _config: RealtimeConfig,
    _connectionManager: ConnectionManager,
    roomManager: RoomManager,
  ) {
    this.roomManager = roomManager;
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: RealtimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // -----------------------------------------------------------------------
  // Presence lifecycle
  // -----------------------------------------------------------------------

  /**
   * Track a connection as present. Called when a connection is registered.
   */
  track(
    connectionId: string,
    userId: string,
    customData: Record<string, unknown> = {},
  ): PresenceState {
    const now = Date.now();
    const state: PresenceState = {
      userId,
      connectionId,
      status: "online",
      lastSeen: now,
      customData,
    };

    this.presenceByConnection.set(connectionId, state);

    this.emit({
      type: "presence:join",
      connectionId,
      timestamp: now,
      data: { userId, status: "online", customData },
    });

    return state;
  }

  /**
   * Stop tracking a connection. Called when a connection is deregistered.
   */
  untrack(connectionId: string): PresenceState | undefined {
    const state = this.presenceByConnection.get(connectionId);
    if (!state) return undefined;

    this.presenceByConnection.delete(connectionId);

    this.emit({
      type: "presence:leave",
      connectionId,
      timestamp: Date.now(),
      data: { userId: state.userId },
    });

    return state;
  }

  // -----------------------------------------------------------------------
  // Status updates
  // -----------------------------------------------------------------------

  /**
   * Update presence status for a connection.
   */
  setStatus(connectionId: string, status: PresenceStatus): void {
    const state = this.presenceByConnection.get(connectionId);
    if (!state) return;

    state.status = status;
    state.lastSeen = Date.now();

    this.emit({
      type: "presence:update",
      connectionId,
      timestamp: state.lastSeen,
      data: { userId: state.userId, status, customData: state.customData },
    });
  }

  /**
   * Update custom presence data (typing indicator, cursor position, etc.).
   */
  setCustomData(
    connectionId: string,
    customData: Record<string, unknown>,
  ): void {
    const state = this.presenceByConnection.get(connectionId);
    if (!state) return;

    state.customData = { ...state.customData, ...customData };
    state.lastSeen = Date.now();

    this.emit({
      type: "presence:update",
      connectionId,
      timestamp: state.lastSeen,
      data: {
        userId: state.userId,
        status: state.status,
        customData: state.customData,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get presence for a specific connection.
   */
  getByConnection(connectionId: string): PresenceState | undefined {
    return this.presenceByConnection.get(connectionId);
  }

  /**
   * Get all presence entries for a user (across all their connections).
   */
  getByUserId(userId: string): PresenceState[] {
    const results: PresenceState[] = [];
    for (const state of this.presenceByConnection.values()) {
      if (state.userId === userId) {
        results.push(state);
      }
    }
    return results;
  }

  /**
   * Get the "effective" status for a user: online if ANY connection is
   * online, away if any is away (and none online), otherwise offline.
   */
  getUserStatus(userId: string): PresenceStatus {
    const states = this.getByUserId(userId);
    if (states.length === 0) return "offline";
    if (states.some((s) => s.status === "online")) return "online";
    if (states.some((s) => s.status === "away")) return "away";
    return "offline";
  }

  /**
   * Get presence list for a room: all unique users with their effective
   * status and the most recent custom data from any of their connections.
   */
  getRoomPresence(
    roomId: string,
  ): Array<{
    userId: string;
    status: PresenceStatus;
    customData: Record<string, unknown>;
  }> {
    const memberIds = this.roomManager.getMembers(roomId);
    const userMap = new Map<
      string,
      { status: PresenceStatus; customData: Record<string, unknown> }
    >();

    for (const connId of memberIds) {
      const presence = this.presenceByConnection.get(connId);
      if (!presence) continue;

      const existing = userMap.get(presence.userId);
      if (!existing) {
        userMap.set(presence.userId, {
          status: presence.status,
          customData: { ...presence.customData },
        });
      } else {
        // Merge: prefer online > away > offline
        if (
          presence.status === "online" ||
          (presence.status === "away" && existing.status === "offline")
        ) {
          existing.status = presence.status;
        }
        existing.customData = { ...existing.customData, ...presence.customData };
      }
    }

    return [...userMap.entries()].map(([userId, data]) => ({
      userId,
      ...data,
    }));
  }

  /**
   * Get all tracked presence entries.
   */
  getAll(): PresenceState[] {
    return [...this.presenceByConnection.values()];
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  destroy(): void {
    this.presenceByConnection.clear();
    this.listeners = [];
  }
}
