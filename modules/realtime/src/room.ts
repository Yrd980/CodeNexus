/**
 * Room Manager — channel-based pub/sub for real-time messaging.
 *
 * Rooms are the primary unit of message scoping. Almost every real-time
 * feature maps to a room: a chat channel, a document being edited, a game
 * lobby, a notification feed for a user.
 *
 * Design decisions:
 * - Rooms are created lazily on first join (no explicit "create" step)
 * - Each room keeps a bounded history buffer for late-joiners
 * - Broadcast supports "all" and "all-except-sender" patterns
 * - Room metadata is free-form (topic, permissions, etc.)
 */

import type {
  Connection,
  EventListener,
  Message,
  RealtimeConfig,
  RealtimeEvent,
  Room,
} from "./types.js";
import type { ConnectionManager } from "./connection-manager.js";

export class RoomManager {
  private rooms = new Map<string, Room>();
  private roomHistory = new Map<string, Message[]>();
  private listeners: EventListener[] = [];
  private config: RealtimeConfig;
  private connectionManager: ConnectionManager;

  constructor(config: RealtimeConfig, connectionManager: ConnectionManager) {
    this.config = config;
    this.connectionManager = connectionManager;
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
  // Room lifecycle
  // -----------------------------------------------------------------------

  /**
   * Join a connection to a room. Creates the room lazily if needed.
   */
  join(
    connectionId: string,
    roomId: string,
    metadata: Record<string, unknown> = {},
  ): Room {
    const connection = this.connectionManager.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = { id: roomId, members: new Set(), metadata };
      this.rooms.set(roomId, room);
      this.roomHistory.set(roomId, []);
    }

    room.members.add(connectionId);
    connection.rooms.add(roomId);

    this.emit({
      type: "room:join",
      connectionId,
      roomId,
      timestamp: Date.now(),
      data: { userId: connection.userId },
    });

    return room;
  }

  /**
   * Remove a connection from a room. Deletes the room if empty.
   */
  leave(connectionId: string, roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const removed = room.members.delete(connectionId);
    if (!removed) return false;

    const connection = this.connectionManager.get(connectionId);
    if (connection) {
      connection.rooms.delete(roomId);
    }

    this.emit({
      type: "room:leave",
      connectionId,
      roomId,
      timestamp: Date.now(),
      data: { userId: connection?.userId },
    });

    // Auto-cleanup empty rooms
    if (room.members.size === 0) {
      this.rooms.delete(roomId);
      this.roomHistory.delete(roomId);
    }

    return true;
  }

  /**
   * Remove a connection from ALL rooms it belongs to.
   * Called when a connection is deregistered.
   */
  leaveAll(connectionId: string): string[] {
    const connection = this.connectionManager.get(connectionId);
    const roomIds: string[] = [];

    if (connection) {
      for (const roomId of connection.rooms) {
        this.leave(connectionId, roomId);
        roomIds.push(roomId);
      }
    } else {
      // Fallback: scan all rooms
      for (const [roomId, room] of this.rooms) {
        if (room.members.has(connectionId)) {
          room.members.delete(connectionId);
          roomIds.push(roomId);
          if (room.members.size === 0) {
            this.rooms.delete(roomId);
            this.roomHistory.delete(roomId);
          }
        }
      }
    }

    return roomIds;
  }

  // -----------------------------------------------------------------------
  // Broadcasting
  // -----------------------------------------------------------------------

  /**
   * Get all connection IDs in a room.
   */
  getMembers(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.members];
  }

  /**
   * Get all connection IDs in a room except the given one.
   * Classic "broadcast to others" pattern.
   */
  getMembersExcept(roomId: string, excludeConnectionId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.members].filter((id) => id !== excludeConnectionId);
  }

  /**
   * Get resolved Connection objects for room members.
   */
  getMemberConnections(roomId: string): Connection[] {
    return this.getMembers(roomId)
      .map((id) => this.connectionManager.get(id))
      .filter((c): c is Connection => c !== undefined);
  }

  // -----------------------------------------------------------------------
  // Room history
  // -----------------------------------------------------------------------

  /**
   * Append a message to a room's history buffer.
   * The buffer is capped at `config.roomHistorySize`.
   */
  addToHistory(roomId: string, message: Message): void {
    const history = this.roomHistory.get(roomId);
    if (!history) return;

    history.push(message);

    // Trim to configured size
    while (history.length > this.config.roomHistorySize) {
      history.shift();
    }
  }

  /**
   * Get recent messages for a room (for late-joiners).
   */
  getHistory(roomId: string): Message[] {
    return this.roomHistory.get(roomId) ?? [];
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getAllRooms(): Room[] {
    return [...this.rooms.values()];
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  updateMetadata(roomId: string, metadata: Record<string, unknown>): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    room.metadata = { ...room.metadata, ...metadata };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  destroy(): void {
    this.rooms.clear();
    this.roomHistory.clear();
    this.listeners = [];
  }
}
