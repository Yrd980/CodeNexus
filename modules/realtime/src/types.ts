/**
 * Core type definitions for the realtime module.
 *
 * Design note: Types are transport-agnostic — they describe connections, rooms,
 * messages, and presence without coupling to any specific WebSocket library.
 * This lets you plug in ws, uWebSockets, Socket.io, or even SSE as the
 * underlying transport.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RealtimeConfig {
  /** Interval in ms between heartbeat pings (default: 30_000) */
  heartbeatInterval: number;

  /** How long to wait for a heartbeat response before marking dead (default: 10_000) */
  heartbeatTimeout: number;

  /** Maximum reconnect attempts before giving up (default: 10) */
  reconnectMaxRetries: number;

  /**
   * Backoff strategy for reconnection.
   * - base: initial delay in ms (default: 1_000)
   * - factor: multiplier per attempt (default: 2)
   * - maxDelay: cap in ms (default: 30_000)
   */
  reconnectBackoff: {
    base: number;
    factor: number;
    maxDelay: number;
  };

  /** Maximum simultaneous connections per userId (default: 5) */
  maxConnectionsPerUser: number;

  /** How many recent messages to keep per room for late-joiners (default: 50) */
  roomHistorySize: number;

  /** How long to buffer messages for disconnected clients in ms (default: 60_000) */
  messageBufferTTL: number;
}

export const DEFAULT_CONFIG: RealtimeConfig = {
  heartbeatInterval: 30_000,
  heartbeatTimeout: 10_000,
  reconnectMaxRetries: 10,
  reconnectBackoff: {
    base: 1_000,
    factor: 2,
    maxDelay: 30_000,
  },
  maxConnectionsPerUser: 5,
  roomHistorySize: 50,
  messageBufferTTL: 60_000,
};

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface Connection {
  id: string;
  userId: string;
  state: ConnectionState;
  metadata: Record<string, unknown>;
  rooms: Set<string>;
  lastHeartbeat: number;
  connectedAt: number;
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export interface Room {
  id: string;
  members: Set<string>; // connection IDs
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  type: string;
  payload: unknown;
  roomId?: string;
  senderId?: string;
  timestamp: number;
  /** Per-room sequence number for ordering */
  sequence?: number;
}

export interface PendingAck {
  messageId: string;
  connectionId: string;
  sentAt: number;
  retries: number;
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export type PresenceStatus = "online" | "away" | "offline";

export interface PresenceState {
  userId: string;
  connectionId: string;
  status: PresenceStatus;
  lastSeen: number;
  customData: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type RealtimeEventType =
  | "connection:open"
  | "connection:close"
  | "connection:error"
  | "connection:heartbeat"
  | "room:join"
  | "room:leave"
  | "room:message"
  | "presence:update"
  | "presence:join"
  | "presence:leave"
  | "message:ack"
  | "message:send"
  | "recovery:start"
  | "recovery:complete"
  | "recovery:fail";

export interface RealtimeEvent {
  type: RealtimeEventType;
  connectionId?: string;
  roomId?: string;
  data?: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Callbacks / Listener
// ---------------------------------------------------------------------------

export type EventListener = (event: RealtimeEvent) => void;
