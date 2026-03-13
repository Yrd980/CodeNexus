/**
 * modules/realtime — Real-time communication patterns for startups.
 *
 * This module provides the server-side building blocks for real-time features:
 * WebSocket management, pub/sub rooms, presence tracking, and connection
 * recovery. It is transport-agnostic — plug in any WebSocket library (ws,
 * uWebSockets.js, Socket.io) and wire up the callbacks.
 *
 * @example
 * ```ts
 * import { createRealtimeServer } from "./src/index.js";
 *
 * const server = createRealtimeServer({
 *   sendFn: (connectionId, message) => {
 *     // Your WebSocket send logic
 *     const ws = wsConnections.get(connectionId);
 *     ws?.send(JSON.stringify(message));
 *   },
 * });
 *
 * // When a WebSocket connects
 * server.connections.register("conn-1", "user-123");
 * server.presence.track("conn-1", "user-123");
 * server.rooms.join("conn-1", "chat:general");
 *
 * // When a message arrives
 * server.messages.publishToRoom("chat:general", "chat:message", {
 *   text: "Hello!",
 * }, { senderId: "conn-1", excludeSender: true });
 *
 * // When a WebSocket disconnects
 * server.recovery.saveSession("conn-1");
 * server.rooms.leaveAll("conn-1");
 * server.presence.untrack("conn-1");
 * server.connections.deregister("conn-1");
 *
 * // When a client reconnects
 * server.connections.register("conn-2", "user-123");
 * const { replayedMessages } = server.recovery.recover("conn-1", "conn-2");
 * ```
 */

import { ConnectionManager } from "./connection-manager.js";
import { MessageBroker, type SendFunction } from "./message-broker.js";
import { PresenceManager } from "./presence.js";
import { RecoveryManager } from "./recovery.js";
import { RoomManager } from "./room.js";
import { DEFAULT_CONFIG, type RealtimeConfig } from "./types.js";

export interface RealtimeServerOptions {
  /** Partial config — missing keys fall back to defaults */
  config?: Partial<RealtimeConfig>;

  /**
   * The transport-level send function. The broker calls this when a message
   * needs to be delivered to a specific connection.
   */
  sendFn: SendFunction;
}

export interface RealtimeServer {
  connections: ConnectionManager;
  rooms: RoomManager;
  presence: PresenceManager;
  messages: MessageBroker;
  recovery: RecoveryManager;
  config: RealtimeConfig;

  /** Tear down everything — call on server shutdown */
  destroy: () => void;
}

/**
 * Factory function — creates a fully wired realtime server instance.
 */
export function createRealtimeServer(
  options: RealtimeServerOptions,
): RealtimeServer {
  const config: RealtimeConfig = { ...DEFAULT_CONFIG, ...options.config };

  // Merge nested backoff config
  if (options.config?.reconnectBackoff) {
    config.reconnectBackoff = {
      ...DEFAULT_CONFIG.reconnectBackoff,
      ...options.config.reconnectBackoff,
    };
  }

  const connections = new ConnectionManager(config);
  const rooms = new RoomManager(config, connections);
  const messages = new MessageBroker(config, connections, rooms, options.sendFn);
  const presence = new PresenceManager(config, connections, rooms);
  const recovery = new RecoveryManager(
    config,
    connections,
    rooms,
    messages,
    presence,
  );

  return {
    connections,
    rooms,
    presence,
    messages,
    recovery,
    config,
    destroy() {
      recovery.destroy();
      messages.destroy();
      presence.destroy();
      rooms.destroy();
      connections.destroy();
    },
  };
}

// Re-export all types and classes
export { ConnectionManager } from "./connection-manager.js";
export { MessageBroker, type SendFunction } from "./message-broker.js";
export { PresenceManager } from "./presence.js";
export { RecoveryManager } from "./recovery.js";
export { RoomManager } from "./room.js";
export {
  DEFAULT_CONFIG,
  type Connection,
  type ConnectionState,
  type EventListener,
  type Message,
  type PendingAck,
  type PresenceState,
  type PresenceStatus,
  type RealtimeConfig,
  type RealtimeEvent,
  type RealtimeEventType,
  type Room,
} from "./types.js";
