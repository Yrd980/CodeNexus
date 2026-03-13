# Rate Limiter

## 解决什么问题

API 需要保护自身免受滥用和流量高峰的影响。不同的场景需要不同的限流算法：突发型 API 需要 Token Bucket，精确计数需要 Sliding Window，简单场景用 Fixed Window 就够了。这个模块提供三种生产级算法实现，可插拔存储后端，以及框架无关的中间件——开箱即用，无需重复造轮子。

## 为什么这样设计

**三种算法，因为没有万能方案：**

| 算法 | 适用场景 | 特点 |
|------|---------|------|
| Fixed Window | 大多数简单场景 | 实现简单、内存最低；但窗口边界处可能出现 2x 突发 |
| Sliding Window | 需要平滑限流 | 加权插值两个窗口，比 Fixed Window 平滑得多，只多存一个计数器 |
| Token Bucket | 允许短暂突发 | 天然支持 burst，同时约束平均速率；每个 key 状态稍多 |

**可插拔存储接口：** 生产环境通常需要 Redis（多进程 / 分布式共享状态），但开发和测试只需要内存 Map。`RateLimiterStore` 接口让你自由切换，零代码改动。

**框架无关中间件：** Startup 技术栈变化快——今天 Express，明天 Hono，后天 Fastify。中间件层只操作普通对象和标准 HTTP 头，不耦合任何框架。

**零运行时依赖：** 只依赖 TypeScript 类型系统，没有 `lodash`、`dayjs` 或其他包袱。

## 快速使用

### 安装

```bash
cd patterns/rate-limiter
npm install
npm run build
```

### Fixed Window（最简单）

```typescript
import { FixedWindowRateLimiter } from "@codenexus/rate-limiter";

const limiter = new FixedWindowRateLimiter({
  windowSize: 60_000,   // 1 分钟窗口
  maxRequests: 100,      // 每窗口 100 次
});

const result = await limiter.check("user-123");
if (!result.allowed) {
  console.log(`Rate limited. Retry after ${result.retryAfter}s`);
}
```

### Sliding Window（更精确）

```typescript
import { SlidingWindowRateLimiter } from "@codenexus/rate-limiter";

const limiter = new SlidingWindowRateLimiter({
  windowSize: 60_000,
  maxRequests: 100,
});

const result = await limiter.check("user-123");
// result.remaining → 剩余配额
// result.resetAt   → 窗口重置时间戳
```

### Token Bucket（允许突发）

```typescript
import { TokenBucketRateLimiter } from "@codenexus/rate-limiter";

const limiter = new TokenBucketRateLimiter({
  capacity: 20,           // 桶容量
  refillRate: 5,           // 每次补充 5 个 token
  refillInterval: 10_000,  // 每 10 秒补充一次
});

const result = await limiter.check("api-key-abc");
```

### 框架无关中间件

```typescript
import {
  createRateLimitMiddleware,
  keyByIp,
  FixedWindowRateLimiter,
} from "@codenexus/rate-limiter";

const handler = createRateLimitMiddleware({
  limiter: new FixedWindowRateLimiter({ windowSize: 60_000, maxRequests: 100 }),
  keyExtractor: keyByIp,
});

// Express 示例
app.use(async (req, res, next) => {
  const { status, headers } = await handler(req);
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }
  if (status === 429) {
    return res.status(429).json({ error: "Too many requests" });
  }
  next();
});
```

### 自定义 Key Extractor

```typescript
import { keyByHeader, keyByAuthHeader } from "@codenexus/rate-limiter";

// 按 API Key 头限流
const byApiKey = keyByHeader("x-api-key");

// 按 Authorization 头限流
const byAuth = keyByAuthHeader;

// 自定义逻辑
const byUserId = (req) => req.userId ?? null;
```

### 自定义存储后端

```typescript
import type { RateLimiterStore } from "@codenexus/rate-limiter";

class RedisStore implements RateLimiterStore {
  async get(key: string) { /* redis.get(key) */ }
  async set(key: string, value: string, ttlMs: number) { /* redis.set(key, value, 'PX', ttlMs) */ }
  async increment(key: string, amount: number, ttlMs: number) { /* INCRBY + PEXPIRE */ }
  async delete(key: string) { /* redis.del(key) */ }
}

const limiter = new FixedWindowRateLimiter({
  windowSize: 60_000,
  maxRequests: 100,
  store: new RedisStore(),
});
```

## 配置项

### Fixed Window

| 参数 | 类型 | 说明 |
|------|------|------|
| `windowSize` | `number` | 窗口时长（ms） |
| `maxRequests` | `number` | 每窗口最大请求数 |
| `store` | `RateLimiterStore` | 可选，存储后端 |

### Sliding Window

| 参数 | 类型 | 说明 |
|------|------|------|
| `windowSize` | `number` | 窗口时长（ms） |
| `maxRequests` | `number` | 每窗口最大请求数 |
| `store` | `RateLimiterStore` | 可选，存储后端 |

### Token Bucket

| 参数 | 类型 | 说明 |
|------|------|------|
| `capacity` | `number` | 桶容量（最大 token 数） |
| `refillRate` | `number` | 每次补充的 token 数 |
| `refillInterval` | `number` | 补充间隔（ms） |
| `store` | `RateLimiterStore` | 可选，存储后端 |

### Memory Store

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cleanupIntervalMs` | `number` | `60000` | 清理过期条目的间隔（ms），设为 `0` 禁用 |

### Middleware

| 参数 | 类型 | 说明 |
|------|------|------|
| `limiter` | `RateLimiter` | 任意限流器实例 |
| `keyExtractor` | `(req) => string \| null` | 从请求提取限流 key，返回 `null` 跳过限流 |

## HTTP 响应头

中间件会设置以下标准头：

| 头 | 说明 |
|----|------|
| `X-RateLimit-Limit` | 当前配置的最大请求数 |
| `X-RateLimit-Remaining` | 剩余可用请求数 |
| `X-RateLimit-Reset` | 限额重置的 Unix 时间戳（秒） |
| `Retry-After` | 被限流时需等待的秒数（仅 429 响应） |

## 来源 & 致谢

- [Cloudflare Rate Limiting Blog](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/) — Sliding window counter 的权威解释
- [Stripe API Rate Limiting](https://stripe.com/docs/rate-limits) — Token bucket 实践参考
- [upstash/ratelimit](https://github.com/upstash/ratelimit) — 可插拔存储接口的设计灵感

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-13 | 初始版本：三种算法 + 内存存储 + 中间件 | Startup 最常见的限流需求覆盖 |
