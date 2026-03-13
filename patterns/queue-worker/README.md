# Queue Worker

## 解决什么问题

同步处理阻塞用户请求。发邮件、处理图片、生成报表——这些都应该放到后台任务。你需要一个队列模式：Day 1 简单够用，Day 100 能扩展到分布式。这个模块提供带优先级、重试、并发控制和优雅关停的进程内任务队列。

## 为什么这样设计

**进程内队列（不依赖 Redis）**：大多数 Startup 在 Day 1 不需要分布式 Worker。进程内队列零依赖、零运维，通过可插拔的 `JobStore` 接口，以后加 Redis 只需换一个 store 实现，业务代码零改动。

**优先级队列（不是纯 FIFO）**：不是所有任务都一样重要。密码重置邮件应该排在周报前面。优先级数字越大越先处理。

**并发控制**：不控制并发数的后台任务处理器会把内存吃光。`concurrency: N` 限制同时处理的任务数，简单有效。

**指数退避重试**：瞬时故障（网络抖动、第三方限流）通过重试就能恢复。指数退避 + 抖动避免雷群效应。

**优雅关停**：k8s 发 SIGTERM 时你有约 30 秒完成当前任务。Worker 的 `shutdown()` 会停止接新任务，等待活跃任务完成后才退出。

**权衡**：
- 进程内队列在进程崩溃时会丢失任务。如果任务不能丢，加 Redis/Postgres 持久化。
- 没有 cron 表达式解析器，只有 `every: N ms`。需要复杂调度可以加 `cron-parser` 包。
- 没有 UI dashboard。BullMQ 有 Bull Board，如果需要可视化可以迁移。

## 快速使用

```bash
npm install
npm run build
```

```typescript
import { createQueue, createWorker } from "./src/index.js";

// 1. 创建队列
const queue = createQueue({ maxSize: 10_000 });

// 2. 创建 Worker，注册 Handler
const worker = createWorker(queue, { concurrency: 5 });

worker.handle("send-email", async ({ job, reportProgress }) => {
  const { to, subject, body } = job.data as {
    to: string;
    subject: string;
    body: string;
  };
  await sendEmail(to, subject, body);
  reportProgress(100);
  return { sent: true };
});

worker.handle("generate-report", async ({ job, signal }) => {
  // signal 会在超时或 shutdown 时触发
  const report = await buildReport(job.data, signal);
  return report;
});

// 3. 启动 Worker
worker.start();

// 4. 添加任务
queue.add("send-email", {
  to: "user@example.com",
  subject: "Welcome!",
  body: "Hello from our startup.",
});

// 高优先级任务（数字越大越先处理）
queue.add("send-email", {
  to: "user@example.com",
  subject: "Password Reset",
  body: "Click here to reset.",
}, { priority: 10 });

// 延迟任务（5 分钟后处理）
queue.add("generate-report", { type: "weekly" }, {
  delay: 5 * 60 * 1000,
});

// 去重任务（同一 key 只入队一次）
queue.add("sync-user", { userId: "abc" }, {
  deduplicationKey: "sync-user-abc",
});

// 5. 监听事件
queue.on("job:completed", ({ job, duration }) => {
  console.log(`${job.name} completed in ${duration}ms`);
});

queue.on("job:failed", ({ job, error, willRetry }) => {
  console.error(`${job.name} failed: ${error.message}`, { willRetry });
});

// 6. 优雅关停（处理 SIGTERM）
process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  await worker.shutdown(); // 等待活跃任务完成
  process.exit(0);
});
```

### 定时任务

```typescript
import { createQueue, createWorker, createScheduler } from "./src/index.js";

const queue = createQueue();
const worker = createWorker(queue, { concurrency: 2 });
const scheduler = createScheduler(queue);

worker.handle("health-check", async () => {
  await pingDatabase();
  return { healthy: true };
});

worker.start();

// 每 30 秒执行一次健康检查
scheduler.schedule({
  name: "health-check",
  dataFactory: () => ({ ts: Date.now() }),
  every: 30_000,
});

// 最多执行 10 次的一次性任务
scheduler.schedule({
  name: "retry-failed-payments",
  dataFactory: () => ({}),
  every: 60_000,
  maxExecutions: 10,
});
```

### 自定义存储后端

```typescript
import type { JobStore } from "./src/types.js";
import { createQueue } from "./src/index.js";

class RedisStore implements JobStore {
  // 实现 JobStore 接口的所有方法...
  // add, get, update, remove, getNext, hasDuplicateKey,
  // getByStatus, countByStatus, getAll, clear
}

const queue = createQueue({}, new RedisStore());
// 业务代码完全不变
```

## 配置项

### QueueConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxSize` | `number` | `0` (无限) | 队列最大任务数，超出时 `add()` 返回 `null` |
| `defaultPriority` | `number` | `0` | 任务默认优先级 |
| `defaultRetries` | `number` | `3` | 任务默认最大重试次数 |
| `defaultTimeout` | `number` | `30000` | 任务默认超时时间（ms） |

### WorkerConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `concurrency` | `number` | `1` | 同时处理的最大任务数 |
| `pollInterval` | `number` | `100` | 轮询队列间隔（ms） |
| `maxRetries` | `number` | `3` | Worker 级别的默认重试次数 |
| `backoff.strategy` | `"fixed" \| "exponential" \| "linear"` | `"exponential"` | 退避策略 |
| `backoff.baseDelay` | `number` | `1000` | 基础延迟（ms） |
| `backoff.maxDelay` | `number` | `30000` | 最大延迟（ms） |

### JobOptions

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `priority` | `number` | `0` | 优先级，数字越大越先处理 |
| `maxRetries` | `number` | `3` | 最大重试次数 |
| `delay` | `number` | `0` | 延迟处理时间（ms） |
| `timeout` | `number` | `30000` | 超时时间（ms） |
| `deduplicationKey` | `string` | - | 去重 key，相同 key 的 waiting/active 任务只存在一个 |

## 来源 & 致谢

- **[BullMQ](https://github.com/taskforcesh/bullmq)** — 优先级 + 延迟 + 重试覆盖了 90% 的真实任务队列需求
- **[Sidekiq](https://github.com/sidekiq/sidekiq)** — 并发控制 + 优雅关停是生产环境的刚需
- **[Temporal](https://temporal.io/)** — 可插拔存储后端让你先简单后扩展

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 BullMQ/Sidekiq/Temporal 的模式中提炼出进程内队列的最小可用版本，零外部依赖，适合 Day 1 Startup |
