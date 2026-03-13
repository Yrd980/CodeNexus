# Realtime

## 解决什么问题

Real-time features — chat, live notifications, collaborative editing, multiplayer — all require managing WebSocket lifecycle, room-based messaging, presence tracking, and connection recovery. Getting this wrong means lost messages, ghost users showing as "online" forever, and thundering herd reconnection storms after a blip.

This module provides the **server-side building blocks** for real-time communication. It is transport-agnostic: it doesn't depend on any specific WebSocket library. You bring the transport (ws, uWebSockets.js, Socket.io, even SSE), this module handles the logic.

## 为什么这样设计

**Connection Manager separate from Message Broker** — Connection lifecycle (register, heartbeat, state machine) and message routing (pub/sub, ordering, ack) are orthogonal concerns. Separating them means you can swap out the message routing strategy without touching connection management, and vice versa.

**Room-based pub/sub** — Almost every real-time feature is scoped to a "room" or "channel": a chat room, a document, a game lobby. Room-based broadcasting is the right default abstraction. Point-to-point messaging is a degenerate case (room with one member).

**Presence as a first-class concept** — "Who's online?" is the first real-time feature every app ships. Most teams bolt it on as an afterthought and get it wrong (ghost users, stale status). Making presence a core building block means it handles multi-device users, graceful degradation on unclean disconnects, and custom data (typing indicators, cursor positions) from day one.

**Message buffering + replay** — Mobile connections drop frequently. Rather than losing messages during a 5-second reconnect, the broker buffers messages with a configurable TTL and replays them when the client reconnects. Combined with per-room sequence numbers, this gives at-least-once delivery with ordering guarantees.

**Transport-agnostic** — The module never touches a WebSocket directly. Instead, you provide a `sendFn` callback and the broker calls it when a message needs to go out. This means the same logic works with ws, uWebSockets.js, Socket.io, or even Server-Sent Events.

**权衡:**
- This is an in-memory implementation. For horizontal scaling across multiple server instances, you'd add Redis pub/sub (or NATS, etc.) as a backing layer. The interfaces are designed to make that substitution straightforward.
- Message ordering is per-room, not global. Global ordering requires a centralized sequencer which doesn't scale well.
- Presence merging is simplified compared to Phoenix's CRDT approach. For most startup use cases, "online if any connection is online" is sufficient.

## 快速使用

```ts
import { createRealtimeServer } from "./src/index.js";

// 1. Create server with your transport's send function
const server = createRealtimeServer({
  sendFn: (connectionId, message) => {
    const ws = wsConnections.get(connectionId);
    ws?.send(JSON.stringify(message));
  },
  config: {
    heartbeatInterval: 30_000,
    maxConnectionsPerUser: 5,
  },
});

// 2. When a WebSocket connects
server.connections.register("conn-1", "user-123");
server.presence.track("conn-1", "user-123");
server.rooms.join("conn-1", "chat:general");

// 3. Send messages to a room
server.messages.publishToRoom("chat:general", "chat:message", {
  text: "Hello, world!",
}, {
  senderId: "conn-1",
  excludeSender: true,  // Don't echo back to sender
});

// 4. Update presence (e.g., typing indicator)
server.presence.setCustomData("conn-1", { typing: true });

// 5. Handle disconnection with recovery support
server.recovery.saveSession("conn-1");
server.rooms.leaveAll("conn-1");
server.presence.untrack("conn-1");
server.connections.deregister("conn-1");

// 6. Handle reconnection
server.connections.register("conn-2", "user-123");
const { restored, replayedMessages } = server.recovery.recover("conn-1", "conn-2");
// replayedMessages contains everything the client missed

// 7. Cleanup on server shutdown
server.destroy();
```

## 配置项

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `heartbeatInterval` | `30000` | Heartbeat ping interval (ms) |
| `heartbeatTimeout` | `10000` | Time to wait for heartbeat response before marking dead (ms) |
| `reconnectMaxRetries` | `10` | Maximum reconnection attempts |
| `reconnectBackoff.base` | `1000` | Initial reconnect delay (ms) |
| `reconnectBackoff.factor` | `2` | Backoff multiplier per attempt |
| `reconnectBackoff.maxDelay` | `30000` | Maximum backoff delay cap (ms) |
| `maxConnectionsPerUser` | `5` | Max simultaneous connections per user |
| `roomHistorySize` | `50` | Recent messages to keep per room for late-joiners |
| `messageBufferTTL` | `60000` | How long to buffer messages for disconnected clients (ms) |

## Architecture

```
┌──────────────────────────────────────────────┐
│              Your Transport Layer             │
│        (ws / uWebSockets / Socket.io)        │
└──────────────┬───────────────────┬───────────┘
               │                   │
        register/deregister    sendFn callback
               │                   │
┌──────────────▼───────────────────▼───────────┐
│           ConnectionManager                   │
│  • State machine (connecting → connected →…)  │
│  • Heartbeat monitoring                       │
│  • Per-user connection limits                 │
└──────────────┬───────────────────────────────┘
               │
       ┌───────┼───────┐
       │       │       │
┌──────▼──┐ ┌─▼─────┐ ┌▼──────────┐
│  Room   │ │Message│ │ Presence  │
│ Manager │ │Broker │ │ Manager   │
│         │ │       │ │           │
│ • join  │ │• pub  │ │• track    │
│ • leave │ │• sub  │ │• status   │
│ • hist  │ │• ack  │ │• custom   │
└─────────┘ │• buf  │ └───────────┘
            └───┬───┘
                │
         ┌──────▼──────┐
         │  Recovery   │
         │  Manager    │
         │             │
         │ • sessions  │
         │ • replay    │
         │ • backoff   │
         └─────────────┘
```

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 Socket.io、Phoenix Channels、Ably 的模式中提炼，创建通用的 real-time 服务端构建块 |
