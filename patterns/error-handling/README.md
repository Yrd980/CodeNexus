# Error Handling — Result Type & Structured Error Hierarchy

## 解决什么问题

JavaScript/TypeScript 的 `try/catch` 有三个根本问题：

1. **类型不可见** — 函数签名不告诉你它会抛出什么错误，调用者不知道要 catch 什么
2. **容易遗漏** — 忘了 `try/catch` 编译器不会报错，运行时才炸
3. **错误不规范** — 每个开发者的错误格式不同，API 响应不一致，日志难以分析

这个模块提供两个互补的解决方案：

- **Result\<T, E\>** — 让函数的失败路径在类型系统中显式可见，编译器强制你处理
- **AppError 层级** — 标准化的错误类型，自带 HTTP 状态码映射和序列化

## 为什么这样设计

### Result\<T, E\>：判别联合而非类

| 选项 | 优点 | 缺点 |
|------|------|------|
| **判别联合 (本模块)** | 零运行时开销、tree-shaking 友好、原生 `switch` 穷举 | 链式调用需要辅助函数 |
| 类 (如 neverthrow) | `.map().flatMap()` 链式调用 | 原型链开销、无法 tree-shake 未用方法 |
| Effect-TS | 完整的效果系统 | 学习曲线陡峭，对 Startup 过重 |

**我们选判别联合**，因为 Startup 需要的是轻量、零依赖、学了就能用的方案。链式调用通过 `map(result, fn)` 函数式风格实现。

### AppError 层级：结构化对象而非 Error 子类

- `Error` 子类的 `instanceof` 检查在跨包/跨 realm 时不可靠
- 结构化对象可以直接 JSON 序列化，不需要自定义 `toJSON`
- `code` 字段做判别联合，TypeScript 可以穷举检查

### Error Handler：工厂模式

框架（Express → Fastify → Hono）在变，但错误语义不变。把 AppError → HTTP Response 的映射抽成独立函数，换框架只需要换调用位置。

## 快速使用

### 安装

```bash
cd patterns/error-handling
npm install
npm run build
```

### Result 类型

```typescript
import { ok, err, map, flatMap, fromPromise, unwrapOr } from "@codenexus/error-handling";
import type { Result } from "@codenexus/error-handling";

// 显式返回 Result，调用者必须处理两种情况
function parseAge(input: string): Result<number, string> {
  const n = Number(input);
  if (Number.isNaN(n)) return err("Not a number");
  if (n < 0 || n > 150) return err("Age out of range");
  return ok(n);
}

// 链式变换
const doubled = map(parseAge("21"), (age) => age * 2);
// Ok(42)

// flatMap 用于可能失败的变换
const result = flatMap(parseAge("21"), (age) =>
  age >= 18 ? ok(age) : err("Must be 18+"),
);

// 安全地获取值
const age = unwrapOr(parseAge("invalid"), 0); // 0

// 包装 async 操作
const data = await fromPromise(
  fetch("/api/users").then((r) => r.json()),
  (e) => `Fetch failed: ${e}`,
);
```

### 结构化错误

```typescript
import {
  validationError,
  notFoundError,
  isErrorType,
  httpStatusFromCode,
  serializeError,
} from "@codenexus/error-handling";

// 创建错误
const error = validationError("Invalid email", {
  fields: { email: "must contain @" },
  context: { requestId: "req-abc" },
});

// 类型匹配
if (isErrorType(error, "VALIDATION_ERROR")) {
  console.log(error.fields); // TypeScript 知道 fields 存在
}

// HTTP 状态码
httpStatusFromCode(error.code); // 400

// 序列化（生产模式 — 隐藏内部细节）
serializeError(error, false);
// { code: "VALIDATION_ERROR", message: "Invalid email", fields: { email: "must contain @" } }
```

### Error Handler

```typescript
import { createErrorHandler } from "@codenexus/error-handling";

const handleError = createErrorHandler({
  isDevelopment: process.env.NODE_ENV !== "production",
  onError: (err) => console.error("[ERROR]", err.code, err.message),
  fallbackMessage: "Something went wrong, please try again",
});

// 在你的框架 error middleware 中：
app.use((err, req, res, next) => {
  const { status, body } = handleError(err);
  res.status(status).json(body);
});
```

## 配置项

### ErrorHandlerConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `isDevelopment` | `boolean` | `false` | 开发模式下暴露 stack trace 和 context |
| `onError` | `(error: AppError, raw?: unknown) => void` | — | 自定义日志钩子 |
| `fallbackMessage` | `string` | `"An unexpected error occurred"` | 未知错误的兜底消息 |

### 错误类型 → HTTP 状态码

| ErrorCode | HTTP Status | 说明 |
|-----------|-------------|------|
| `VALIDATION_ERROR` | 400 | 请求参数校验失败 |
| `AUTHENTICATION_ERROR` | 401 | 未认证 |
| `AUTHORIZATION_ERROR` | 403 | 无权限 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 写冲突 |
| `RATE_LIMIT_ERROR` | 429 | 限流 |
| `INTERNAL_ERROR` | 500 | 内部错误 |
| `EXTERNAL_SERVICE_ERROR` | 502 | 外部服务故障 |

## 来源 & 致谢

- **Rust `std::result`** — Result 类型的鼻祖，证明了类型安全错误处理的价值
- **[neverthrow](https://github.com/supermacro/neverthrow)** — 判别联合比类更轻量的启发
- **[Effect-TS](https://effect.website/)** — 完整效果系统的参考，但我们选择了更轻量的子集

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-13 | 初始版本 | 从 Rust Result 模式、neverthrow、Effect-TS 综合提炼，选择判别联合 + 函数式 API 作为 Startup 最佳实践 |
