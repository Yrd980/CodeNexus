/**
 * Recovery Manager — handles reconnection and missed message replay.
 *
 * Mobile connections drop constantly. Users close laptop lids and open them
 * again. A production real-time system MUST handle reconnection gracefully:
 *
 * 1. Reconnect with exponential backoff
 * 2. Re-join previous rooms
 * 3. Replay any messages missed during downtime
 * 4. Sync presence state
 *
 * Design: Recovery stores "sessions" keyed by connectionId. When a client
 * reconnects (possibly with a new connectionId), it presents its old session
 * token. The recovery manager restores room memberships and flushes buffered
 * messages.
 */

import type { ConnectionManager } from "./connection-manager.js";
import type { MessageBroker } from "./message-broker.js";
import type { PresenceManager } from "./presence.js";
import type { RoomManager } from "./room.js";
import type {
  EventListener,
  Message,
  RealtimeConfig,
  RealtimeEvent,
} from "./types.js";

interface Session {
  connectionId: string;
  userId: string;
  rooms: string[];
  lastSequences: Map<string, number>;
  disconnectedAt: number;
}

export class RecoveryManager {
  /** Keyed by the OLD connectionId that disconnected */
  private sessions = new Map<string, Session>();
  private listeners: EventListener[] = [];
  private config: RealtimeConfig;
  private connectionManager: ConnectionManager;
  private roomManager: RoomManager;
  private messageBroker: MessageBroker;
  private presenceManager: PresenceManager;

  constructor(
    config: RealtimeConfig,
    connectionManager: ConnectionManager,
    roomManager: RoomManager,
    messageBroker: MessageBroker,
    presenceManager: PresenceManager,
  ) {
    this.config = config;
    this.connectionManager = connectionManager;
    this.roomManager = roomManager;
    this.messageBroker = messageBroker;
    this.presenceManager = presenceManager;
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
  // Session persistence
  // -----------------------------------------------------------------------

  /**
   * Save a session snapshot when a connection disconnects.
   * This lets us restore state when the client reconnects.
   */
  saveSession(connectionId: string): Session | undefined {
    const connection = this.connectionManager.get(connectionId);
    if (!connection) return undefined;

    const lastSequences = new Map<string, number>();
    for (const roomId of connection.rooms) {
      lastSequences.set(roomId, this.messageBroker.getSequence(roomId));
    }

    const session: Session = {
      connectionId,
      userId: connection.userId,
      rooms: [...connection.rooms],
      lastSequences,
      disconnectedAt: Date.now(),
    };

    this.sessions.set(connectionId, session);
    return session;
  }

  /**
   * Get a saved session.
   */
  getSession(oldConnectionId: string): Session | undefined {
    return this.sessions.get(oldConnectionId);
  }

  // -----------------------------------------------------------------------
  // Recovery
  // -----------------------------------------------------------------------

  /**
   * Recover a session onto a new connection.
   *
   * - Re-joins all previous rooms
   * - Flushes buffered messages
   * - Replays room history for messages missed since disconnect
   * - Restores presence
   *
   * Returns the messages that were replayed.
   */
  recover(
    oldConnectionId: string,
    newConnectionId: string,
  ): { restored: boolean; replayedMessages: Message[] } {
    const session = this.sessions.get(oldConnectionId);
    if (!session) {
      this.emit({
        type: "recovery:fail",
        connectionId: newConnectionId,
        timestamp: Date.now(),
        data: { reason: "No session found", oldConnectionId },
      });
      return { restored: false, replayedMessages: [] };
    }

    // Check if session has expired (based on buffer TTL)
    const elapsed = Date.now() - session.disconnectedAt;
    if (elapsed > this.config.messageBufferTTL) {
      this.sessions.delete(oldConnectionId);
      this.emit({
        type: "recovery:fail",
        connectionId: newConnectionId,
        timestamp: Date.now(),
        data: { reason: "Session expired", oldConnectionId },
      });
      return { restored: false, replayedMessages: [] };
    }

    this.emit({
      type: "recovery:start",
      connectionId: newConnectionId,
      timestamp: Date.now(),
      data: { oldConnectionId, rooms: session.rooms },
    });

    // Re-join rooms
    for (const roomId of session.rooms) {
      try {
        this.roomManager.join(newConnectionId, roomId);
      } catch {
        // Room join may fail if connection is not registered — caller
        // must register the new connection first.
      }
    }

    // Collect replayed messages
    const replayedMessages: Message[] = [];

    // Flush buffered messages (messages that were targeted at the old connection)
    const buffered = this.messageBroker.flushBuffer(oldConnectionId);
    replayedMessages.push(...buffered);

    // Replay room history for messages missed since disconnect
    for (const roomId of session.rooms) {
      const lastSeq = session.lastSequences.get(roomId) ?? 0;
      const history = this.roomManager.getHistory(roomId);
      const missed = history.filter(
        (msg) => msg.sequence !== undefined && msg.sequence > lastSeq,
      );
      replayedMessages.push(...missed);
    }

    // Restore presence
    this.presenceManager.track(newConnectionId, session.userId);

    // Clean up old session
    this.sessions.delete(oldConnectionId);

    this.emit({
      type: "recovery:complete",
      connectionId: newConnectionId,
      timestamp: Date.now(),
      data: {
        oldConnectionId,
        roomsRestored: session.rooms.length,
        messagesReplayed: replayedMessages.length,
      },
    });

    return { restored: true, replayedMessages };
  }

  // -----------------------------------------------------------------------
  // Backoff calculation
  // -----------------------------------------------------------------------

  /**
   * Calculate the reconnection delay for a given attempt number.
   * Uses exponential backoff with jitter, capped at maxDelay.
   */
  calculateBackoff(attempt: number): number {
    const { base, factor, maxDelay } = this.config.reconnectBackoff;
    const delay = Math.min(base * Math.pow(factor, attempt), maxDelay);
    // Add up to 25% jitter to prevent thundering herd
    const jitter = delay * 0.25 * Math.random();
    return Math.floor(delay + jitter);
  }

  /**
   * Check if we should keep retrying.
   */
  shouldRetry(attempt: number): boolean {
    return attempt < this.config.reconnectMaxRetries;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Remove expired sessions.
   */
  pruneSessions(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.disconnectedAt > this.config.messageBufferTTL) {
        this.sessions.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  destroy(): void {
    this.sessions.clear();
    this.listeners = [];
  }
}
