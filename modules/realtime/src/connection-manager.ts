/**
 * Connection Manager — lifecycle management for real-time connections.
 *
 * Responsibilities:
 * - Register / deregister connections
 * - Heartbeat monitoring (detect and reap dead connections)
 * - Enforce per-user connection limits
 * - Connection state machine transitions
 *
 * Design decision: The manager is transport-agnostic. It tracks logical
 * connections identified by opaque string IDs. The actual WebSocket (or SSE,
 * or whatever) lives in your transport layer and calls into this manager.
 */

import type {
  Connection,
  ConnectionState,
  EventListener,
  RealtimeConfig,
  RealtimeEvent,
} from "./types.js";

export class ConnectionManager {
  private connections = new Map<string, Connection>();
  private userConnections = new Map<string, Set<string>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: EventListener[] = [];
  private config: RealtimeConfig;

  constructor(config: RealtimeConfig) {
    this.config = config;
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
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /**
   * Register a new connection. Returns the Connection object or throws if the
   * user has exceeded `maxConnectionsPerUser`.
   */
  register(
    connectionId: string,
    userId: string,
    metadata: Record<string, unknown> = {},
  ): Connection {
    // Enforce per-user limit
    const existing = this.userConnections.get(userId);
    if (existing && existing.size >= this.config.maxConnectionsPerUser) {
      throw new Error(
        `User ${userId} has reached the maximum of ${this.config.maxConnectionsPerUser} connections`,
      );
    }

    const now = Date.now();
    const connection: Connection = {
      id: connectionId,
      userId,
      state: "connected",
      metadata,
      rooms: new Set(),
      lastHeartbeat: now,
      connectedAt: now,
    };

    this.connections.set(connectionId, connection);

    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    this.emit({
      type: "connection:open",
      connectionId,
      timestamp: now,
      data: { userId },
    });

    return connection;
  }

  /**
   * Remove a connection and clean up user tracking.
   */
  deregister(connectionId: string): Connection | undefined {
    const connection = this.connections.get(connectionId);
    if (!connection) return undefined;

    this.connections.delete(connectionId);

    const userSet = this.userConnections.get(connection.userId);
    if (userSet) {
      userSet.delete(connectionId);
      if (userSet.size === 0) {
        this.userConnections.delete(connection.userId);
      }
    }

    connection.state = "disconnected";

    this.emit({
      type: "connection:close",
      connectionId,
      timestamp: Date.now(),
      data: { userId: connection.userId },
    });

    return connection;
  }

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  /** Valid state transitions. */
  private static readonly TRANSITIONS: Record<
    ConnectionState,
    ConnectionState[]
  > = {
    connecting: ["connected", "disconnected"],
    connected: ["reconnecting", "disconnected"],
    reconnecting: ["connected", "disconnected"],
    disconnected: [],
  };

  /**
   * Transition a connection to a new state. Throws on invalid transition.
   */
  transition(connectionId: string, newState: ConnectionState): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const allowed = ConnectionManager.TRANSITIONS[connection.state];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: ${connection.state} -> ${newState}`,
      );
    }

    connection.state = newState;
  }

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  /**
   * Record a heartbeat for a connection.
   */
  heartbeat(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastHeartbeat = Date.now();

    this.emit({
      type: "connection:heartbeat",
      connectionId,
      timestamp: connection.lastHeartbeat,
    });
  }

  /**
   * Start the heartbeat monitor interval. Returns dead connections via the
   * `onDead` callback so the caller can close their transport sockets.
   */
  startHeartbeatMonitor(onDead: (connectionId: string) => void): void {
    this.stopHeartbeatMonitor();

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const threshold = this.config.heartbeatInterval + this.config.heartbeatTimeout;

      for (const [id, conn] of this.connections) {
        if (conn.state === "connected" && now - conn.lastHeartbeat > threshold) {
          onDead(id);
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop the heartbeat monitor.
   */
  stopHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  get(connectionId: string): Connection | undefined {
    return this.connections.get(connectionId);
  }

  getByUserId(userId: string): Connection[] {
    const ids = this.userConnections.get(userId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.connections.get(id))
      .filter((c): c is Connection => c !== undefined);
  }

  getAllConnections(): Connection[] {
    return [...this.connections.values()];
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  updateMetadata(
    connectionId: string,
    metadata: Record<string, unknown>,
  ): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    connection.metadata = { ...connection.metadata, ...metadata };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Tear down all connections and timers. Call on server shutdown.
   */
  destroy(): void {
    this.stopHeartbeatMonitor();
    this.connections.clear();
    this.userConnections.clear();
    this.listeners = [];
  }
}
