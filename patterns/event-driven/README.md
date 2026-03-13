# Event-Driven

Type-safe event bus with pub/sub, event sourcing primitives, dead letter queue, and middleware pipeline.

## 解决什么问题

直接函数调用让服务之间产生紧耦合。服务 A 要调服务 B 的方法，就必须知道 B 的存在、知道 B 的接口签名、知道 B 什么时候可用。这在 Startup 早期可能还行，一旦团队超过 3 人、服务超过 5 个，改一个地方就要改一串。

Event-driven 架构让生产者和消费者彻底解耦：生产者只管发事件，消费者自己决定要不要处理。新增功能只需要订阅已有事件，不用改任何现有代码。

## 为什么这样设计

### Type-safe events（类型安全事件）

运行时因为事件名拼写错误导致的 bug 是事件驱动系统中的 #1 痛点。我们用 TypeScript 的 mapped types 把事件名和 payload 类型绑定在一起，拼错事件名在编译期就会报错。

```ts
type MyEvents = {
  "user.created": { userId: string; email: string };
  "order.placed": { orderId: string; total: number };
};

const bus = createEventBus<MyEvents>();

// 编译通过
bus.publish("user.created", { userId: "u1", email: "a@b.com" });

// 编译报错 — "user.craeted" 不在 MyEvents 里
bus.publish("user.craeted", { userId: "u1", email: "a@b.com" });
```

### Handler error isolation（处理器错误隔离）

一个 handler 抛异常不应该影响其他 handler 执行。我们用 `Promise.allSettled` 而不是 `Promise.all`，确保所有 handler 都会被调用。

**权衡**：这意味着 publish 不会抛出 handler 的错误。如果你需要知道哪些 handler 失败了，查看 Dead Letter Queue。

### Dead Letter Queue（死信队列）

丢失事件 = 丢失数据。handler 失败的事件会被捕获到 DLQ 中，支持查看、重试和重放。这在生产环境中是必须的——你需要知道什么失败了、为什么失败、以及修复后能重新处理。

### Event Sourcing Primitives（事件溯源原语）

"发生了什么" 比 "当前状态" 更有价值。事件溯源让你能完整回放历史、做时间旅行调试、构建审计日志。我们提供了 `InMemoryEventStore` 和 `Aggregate` 基类作为起点，生产环境可以替换为 Postgres 或 EventStoreDB。

**权衡**：`InMemoryEventStore` 不持久化，重启就没了。但接口是标准的，换成持久化实现只需要实现 `EventStore` 接口。Snapshot 机制避免了长生命周期聚合的 O(n) 重放开销。

### Middleware（中间件）

日志、认证、数据充实这些 cross-cutting concerns 不应该污染 handler 代码。中间件管道让你能在事件到达 handler 之前/之后做统一处理，包括修改事件、过滤事件、记录日志。

## 快速使用

### 安装

```bash
npm install  # 在 patterns/event-driven 目录下
```

### 基础 Pub/Sub

```ts
import { createEventBus } from "@codenexus/event-driven";

// 1. 定义事件类型
type AppEvents = {
  "user.created": { userId: string; email: string };
  "user.deleted": { userId: string };
  "order.placed": { orderId: string; total: number };
};

// 2. 创建 bus
const bus = createEventBus<AppEvents>();

// 3. 订阅
const sub = bus.subscribe("user.created", async (event) => {
  console.log(`New user: ${event.payload.email}`);
});

// 4. 发布
await bus.publish("user.created", {
  userId: "u123",
  email: "alice@example.com",
});

// 5. 取消订阅
sub.unsubscribe();
```

### 一次性订阅 & 通配符

```ts
// 只监听一次
bus.once("order.placed", async (event) => {
  console.log(`First order: ${event.payload.orderId}`);
});

// 监听所有事件（适合日志、监控）
bus.subscribeAll(async (event) => {
  console.log(`[${event.type}]`, event.payload);
});
```

### Event Sourcing

```ts
import { InMemoryEventStore, Aggregate } from "@codenexus/event-driven";

type AccountEvents = {
  "account.opened": { owner: string; initialBalance: number };
  "account.deposited": { amount: number };
  "account.withdrawn": { amount: number };
};

interface AccountState {
  owner: string;
  balance: number;
}

// 定义聚合
class AccountAggregate extends Aggregate<AccountState, AccountEvents> {
  constructor() {
    super({ owner: "", balance: 0 });

    this.registerApply("account.opened", (state, event) => ({
      ...state,
      owner: event.payload.owner,
      balance: event.payload.initialBalance,
    }));

    this.registerApply("account.deposited", (state, event) => ({
      ...state,
      balance: state.balance + event.payload.amount,
    }));

    this.registerApply("account.withdrawn", (state, event) => ({
      ...state,
      balance: state.balance - event.payload.amount,
    }));
  }
}

// 使用
const store = new InMemoryEventStore<AccountEvents>();

await store.append("acc-1", "account.opened", {
  owner: "Alice",
  initialBalance: 1000,
});
await store.append("acc-1", "account.deposited", { amount: 500 });
await store.append("acc-1", "account.withdrawn", { amount: 200 });

const agg = new AccountAggregate();
const events = await store.getEvents("acc-1");
agg.loadFromHistory(events);

console.log(agg.state); // { owner: "Alice", balance: 1300 }
```

### Dead Letter Queue

```ts
const bus = createEventBus<AppEvents>({ deadLetterEnabled: true });

bus.subscribe("user.created", async () => {
  throw new Error("DB is down");
});

await bus.publish("user.created", { userId: "u1", email: "a@b.com" });

const dlq = bus.getDeadLetterQueue()!;
console.log(dlq.size); // 1

// 修复问题后，重放所有失败事件
const result = await dlq.replayAll(async (event) => {
  console.log(`Replaying: ${event.type}`);
});
console.log(result); // { succeeded: 1, failed: 0 }
```

### Middleware

```ts
import {
  createEventBus,
  createLoggingMiddleware,
  createEnrichmentMiddleware,
  createFilterMiddleware,
} from "@codenexus/event-driven";

const bus = createEventBus<AppEvents>();

// 自动添加元数据
bus.getMiddleware().use(
  createEnrichmentMiddleware({ source: "user-service", env: "production" }),
);

// 日志
bus.getMiddleware().use(createLoggingMiddleware());

// 过滤内部事件
bus.getMiddleware().use(
  createFilterMiddleware((event) => !event.type.startsWith("internal.")),
);
```

## 配置项

### EventBusConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxListeners` | `number` | `100` | 每个事件类型最大监听器数。超过时输出警告，帮助检测内存泄漏 |
| `deadLetterEnabled` | `boolean` | `true` | 是否启用死信队列捕获 handler 失败 |
| `retryOnError` | `boolean` | `true` | handler 失败时是否继续执行其他 handler |

### DeadLetterQueueConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRetries` | `number` | `3` | 最大重试次数，超过后视为永久失败 |

## 运行测试

```bash
npm test        # 运行一次
npm run test:watch  # 持续监听
```

## 来源 & 致谢

- **EventEmitter3** — wildcard subscriptions 和 once() 是必须的人体工学特性
- **EventStore/EventStoreDB** — event sourcing + snapshots 平衡了可审计性和性能
- **RxJS** — operator 管道的理念影响了 middleware 设计
- **CQRS/ES** 社区 — aggregate root pattern 和 "事件即事实" 的理念

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本：event bus + event store + DLQ + middleware | Startup 工程团队需要一个开箱即用的事件驱动基础设施，而不是从零开始造轮子 |
