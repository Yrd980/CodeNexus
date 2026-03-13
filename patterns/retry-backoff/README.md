# Retry with Exponential Backoff

## 解决什么问题

网络调用会失败——DNS 超时、连接重置、503、速率限制。简单的立即重试会引发 **thundering herd**：所有失败的客户端同时重试，把已经过载的服务彻底压垮。你需要的是 **指数退避 + 抖动（jitter）**，让重试请求在时间上散开，给下游服务喘息空间。

## 为什么这样设计

**选择 Full Jitter 而非 Equal Jitter 或 Decorrelated Backoff：**

AWS Architecture Blog 的 [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) 一文通过模拟对比了三种抖动策略。Full jitter（`delay = random(0, min(cap, base * 2^attempt))`）在高竞争场景下的完成时间和总调用次数均优于其他策略。虽然单个请求的延迟方差更大，但整体系统吞吐更高——对 Startup 的后端来说，系统级优化比单请求延迟更重要。

**支持 AbortSignal：**

长重试链可能持续数十秒。用户离开页面、请求超时、服务关闭——都需要一个逃生舱。AbortSignal 是 Web 标准的取消机制，不引入额外依赖。

**零依赖：**

Retry 是基础设施中最底层的模式之一。如果 retry 库本身有依赖链，那这些依赖的网络请求也需要 retry——递归依赖是灾难。保持零依赖意味着这个模块可以被任何层安全使用。

**返回 RetryResult 而非裸值：**

调用方通常需要知道"重试了几次"和"总耗时"来做监控和报警。把这些信息结构化返回，比让调用方自己计时更干净。

**权衡：**

- Full jitter 的单请求延迟方差大于 Equal jitter，但系统整体表现更好——选系统级优化。
- 不支持 circuit breaker，因为那是另一个独立模式（见 `patterns/error-handling`），组合优于耦合。
- 不提供 decorator/wrapper 语法糖——保持核心函数简单，让消费者自己封装。

## 快速使用

```typescript
import { retry, RetryExhaustedError } from "@codenexus/retry-backoff";

// 基本用法——默认 3 次重试，200ms 基础延迟，full jitter
const result = await retry(() =>
  fetch("https://api.example.com/data"),
);
console.log(result.data);        // Response
console.log(result.attempts);    // 成功时的尝试次数
console.log(result.totalTimeMs); // 总耗时

// 自定义配置
const result2 = await retry(
  async () => {
    const res = await fetch("https://api.example.com/data");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  {
    maxRetries: 5,
    baseDelayMs: 300,
    maxDelayMs: 15_000,
    jitter: "full",
    shouldRetry: (err) => {
      // 只重试 5xx 和网络错误，不重试 4xx
      if (err instanceof Error && err.message.startsWith("HTTP 4")) {
        return false;
      }
      return true;
    },
    onRetry: (err, attempt, delayMs) => {
      console.warn(`Retry #${attempt} in ${delayMs}ms:`, err);
    },
  },
);

// 带取消支持
const controller = new AbortController();
setTimeout(() => controller.abort(), 10_000); // 10s 超时

try {
  await retry(() => fetch("https://slow-api.example.com"), {
    maxRetries: 10,
    signal: controller.signal,
  });
} catch (err) {
  if (err instanceof RetryExhaustedError) {
    console.error("所有重试已耗尽:", err.lastError);
  }
  // RetryAbortedError 会在信号触发时抛出
}
```

## 配置项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRetries` | `number` | `3` | 最大重试次数（不含首次调用） |
| `baseDelayMs` | `number` | `200` | 首次重试的基础延迟（毫秒） |
| `maxDelayMs` | `number` | `10000` | 单次延迟上限（毫秒） |
| `jitter` | `"full" \| "equal" \| "none"` | `"full"` | 抖动策略 |
| `shouldRetry` | `(error: unknown) => boolean` | `() => true` | 判断错误是否应重试 |
| `onRetry` | `(error, attempt, delayMs) => void` | `undefined` | 重试前回调，用于日志/监控 |
| `signal` | `AbortSignal` | `undefined` | 取消信号 |

### 返回值 `RetryResult<T>`

| 字段 | 类型 | 说明 |
|------|------|------|
| `data` | `T` | 操作成功的返回值 |
| `attempts` | `number` | 总尝试次数（1 = 首次就成功） |
| `totalTimeMs` | `number` | 从首次调用到成功的总耗时（毫秒） |

### 错误类型

| 错误 | 何时抛出 |
|------|----------|
| `RetryExhaustedError` | 所有重试次数耗尽 |
| `RetryAbortedError` | AbortSignal 触发 |
| 原始错误 | `shouldRetry` 返回 `false` 时 |

## 延迟计算公式

```
attempt 0: delay ∈ [0, base]                    // e.g. [0, 200]
attempt 1: delay ∈ [0, base × 2]                // e.g. [0, 400]
attempt 2: delay ∈ [0, base × 4]                // e.g. [0, 800]
attempt n: delay ∈ [0, min(cap, base × 2^n)]
```

## 来源 & 致谢

- [AWS Architecture Blog — Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — Full jitter 策略的理论基础和模拟数据
- [sindresorhus/p-retry](https://github.com/sindresorhus/p-retry) — API 设计参考，特别是 abort signal 的集成方式

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-13 | 初始版本 | 从 AWS 架构最佳实践和 p-retry 模式综合提炼，提供零依赖的 TypeScript 实现 |
