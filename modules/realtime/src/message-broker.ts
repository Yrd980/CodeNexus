/**
 * Message Broker — routes messages between connections and rooms.
 *
 * Responsibilities:
 * - Publish to a specific connection, a room, or broadcast to all
 * - Message acknowledgment (at-least-once delivery semantics)
 * - Per-room sequence numbers for ordering
 * - Message type filtering (subscribe to specific types)
 * - Message buffering for temporarily disconnected clients
 *
 * Design: The broker doesn't send data over the wire — it computes WHO should
 * receive WHAT and calls your `sendFn` callback. This keeps the broker
 * decoupled from transport.
 */

import { randomUUID } from "node:crypto";
import type { ConnectionManager } from "./connection-manager.js";
import type { RoomManager } from "./room.js";
import type {
  EventListener,
  Message,
  PendingAck,
  RealtimeConfig,
  RealtimeEvent,
} from "./types.js";

export type SendFunction = (connectionId: string, message: Message) => void;
export type MessageTypeFilter = (type: string) => boolean;

interface Subscription {
  connectionId: string;
  filter: MessageTypeFilter;
}

interface BufferedMessage {
  message: Message;
  targetConnectionId: string;
  bufferedAt: number;
}

export class MessageBroker {
  private roomSequences = new Map<string, number>();
  private pendingAcks = new Map<string, PendingAck>();
  private subscriptions: Subscription[] = [];
  private messageBuffer: BufferedMessage[] = [];
  private listeners: EventListener[] = [];
  private config: RealtimeConfig;
  private connectionManager: ConnectionManager;
  private roomManager: RoomManager;
  private sendFn: SendFunction;

  constructor(
    config: RealtimeConfig,
    connectionManager: ConnectionManager,
    roomManager: RoomManager,
    sendFn: SendFunction,
  ) {
    this.config = config;
    this.connectionManager = connectionManager;
    this.roomManager = roomManager;
    this.sendFn = sendFn;
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
  // Sequence numbers
  // -----------------------------------------------------------------------

  private nextSequence(roomId: string): number {
    const current = this.roomSequences.get(roomId) ?? 0;
    const next = current + 1;
    this.roomSequences.set(roomId, next);
    return next;
  }

  getSequence(roomId: string): number {
    return this.roomSequences.get(roomId) ?? 0;
  }

  // -----------------------------------------------------------------------
  // Publishing
  // -----------------------------------------------------------------------

  /**
   * Send a message to a specific connection. If the connection is
   * disconnected/reconnecting, buffer the message.
   */
  sendToConnection(
    connectionId: string,
    type: string,
    payload: unknown,
    options: { requireAck?: boolean } = {},
  ): Message {
    const message: Message = {
      id: randomUUID(),
      type,
      payload,
      senderId: undefined,
      timestamp: Date.now(),
    };

    const connection = this.connectionManager.get(connectionId);
    if (!connection || connection.state === "disconnected") {
      // Buffer for potential reconnect
      this.bufferMessage(connectionId, message);
      return message;
    }

    if (connection.state === "reconnecting") {
      this.bufferMessage(connectionId, message);
      return message;
    }

    this.deliverToConnection(connectionId, message, options.requireAck);
    return message;
  }

  /**
   * Publish a message to all members of a room.
   */
  publishToRoom(
    roomId: string,
    type: string,
    payload: unknown,
    options: {
      senderId?: string;
      excludeSender?: boolean;
      requireAck?: boolean;
    } = {},
  ): Message {
    const sequence = this.nextSequence(roomId);
    const message: Message = {
      id: randomUUID(),
      type,
      payload,
      roomId,
      senderId: options.senderId,
      timestamp: Date.now(),
      sequence,
    };

    // Store in room history
    this.roomManager.addToHistory(roomId, message);

    // Determine recipients
    const recipients =
      options.excludeSender && options.senderId
        ? this.roomManager.getMembersExcept(roomId, options.senderId)
        : this.roomManager.getMembers(roomId);

    for (const connId of recipients) {
      const connection = this.connectionManager.get(connId);
      if (!connection) continue;

      if (
        connection.state === "reconnecting" ||
        connection.state === "disconnected"
      ) {
        this.bufferMessage(connId, message);
      } else {
        this.deliverToConnection(connId, message, options.requireAck);
      }
    }

    this.emit({
      type: "room:message",
      roomId,
      timestamp: message.timestamp,
      data: { messageId: message.id, type, sequence },
    });

    return message;
  }

  /**
   * Broadcast a message to ALL connected clients.
   */
  broadcast(
    type: string,
    payload: unknown,
    options: { excludeConnectionId?: string; requireAck?: boolean } = {},
  ): Message {
    const message: Message = {
      id: randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
    };

    for (const connection of this.connectionManager.getAllConnections()) {
      if (connection.id === options.excludeConnectionId) continue;

      if (
        connection.state === "reconnecting" ||
        connection.state === "disconnected"
      ) {
        this.bufferMessage(connection.id, message);
      } else {
        this.deliverToConnection(
          connection.id,
          message,
          options.requireAck,
        );
      }
    }

    return message;
  }

  // -----------------------------------------------------------------------
  // Delivery & Buffering
  // -----------------------------------------------------------------------

  private deliverToConnection(
    connectionId: string,
    message: Message,
    requireAck?: boolean,
  ): void {
    // Check subscriptions (type filters)
    if (!this.matchesSubscription(connectionId, message.type)) {
      // If the connection has active subscriptions, only deliver matching types
      // If no subscriptions, deliver everything (default pass-through)
      const hasSubscriptions = this.subscriptions.some(
        (s) => s.connectionId === connectionId,
      );
      if (hasSubscriptions) return;
    }

    this.sendFn(connectionId, message);

    if (requireAck) {
      this.pendingAcks.set(message.id, {
        messageId: message.id,
        connectionId,
        sentAt: Date.now(),
        retries: 0,
      });
    }

    this.emit({
      type: "message:send",
      connectionId,
      timestamp: Date.now(),
      data: { messageId: message.id, type: message.type },
    });
  }

  private bufferMessage(connectionId: string, message: Message): void {
    this.messageBuffer.push({
      message,
      targetConnectionId: connectionId,
      bufferedAt: Date.now(),
    });
  }

  // -----------------------------------------------------------------------
  // Acknowledgment
  // -----------------------------------------------------------------------

  /**
   * Acknowledge receipt of a message.
   */
  acknowledge(messageId: string): boolean {
    const pending = this.pendingAcks.get(messageId);
    if (!pending) return false;

    this.pendingAcks.delete(messageId);

    this.emit({
      type: "message:ack",
      connectionId: pending.connectionId,
      timestamp: Date.now(),
      data: { messageId },
    });

    return true;
  }

  /**
   * Get all pending (unacknowledged) messages.
   */
  getPendingAcks(): PendingAck[] {
    return [...this.pendingAcks.values()];
  }

  // -----------------------------------------------------------------------
  // Subscriptions (type filtering)
  // -----------------------------------------------------------------------

  /**
   * Subscribe a connection to specific message types.
   * Only messages matching the filter will be delivered.
   */
  subscribe(connectionId: string, filter: MessageTypeFilter): () => void {
    const sub: Subscription = { connectionId, filter };
    this.subscriptions.push(sub);
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s !== sub);
    };
  }

  private matchesSubscription(connectionId: string, type: string): boolean {
    return this.subscriptions.some(
      (s) => s.connectionId === connectionId && s.filter(type),
    );
  }

  // -----------------------------------------------------------------------
  // Buffer management (used by recovery)
  // -----------------------------------------------------------------------

  /**
   * Flush buffered messages for a connection (after reconnect).
   * Returns messages in order and removes them from the buffer.
   */
  flushBuffer(connectionId: string): Message[] {
    const now = Date.now();
    const messages: Message[] = [];
    const remaining: BufferedMessage[] = [];

    for (const buffered of this.messageBuffer) {
      if (buffered.targetConnectionId === connectionId) {
        // Check TTL
        if (now - buffered.bufferedAt <= this.config.messageBufferTTL) {
          messages.push(buffered.message);
        }
        // Either way, remove from buffer (expired or flushed)
      } else {
        remaining.push(buffered);
      }
    }

    this.messageBuffer = remaining;
    return messages;
  }

  /**
   * Remove expired messages from the buffer.
   */
  pruneBuffer(): number {
    const now = Date.now();
    const before = this.messageBuffer.length;
    this.messageBuffer = this.messageBuffer.filter(
      (b) => now - b.bufferedAt <= this.config.messageBufferTTL,
    );
    return before - this.messageBuffer.length;
  }

  /**
   * Get the current buffer size (for monitoring).
   */
  getBufferSize(): number {
    return this.messageBuffer.length;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  destroy(): void {
    this.roomSequences.clear();
    this.pendingAcks.clear();
    this.subscriptions = [];
    this.messageBuffer = [];
    this.listeners = [];
  }
}
