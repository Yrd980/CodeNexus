# foundation/api

Framework-agnostic API patterns: request validation, response formatting, routing, CORS, and pagination.

## 解决什么问题

Every API needs the same handful of primitives — validate input, format responses consistently, match routes, handle CORS, paginate lists.  Teams reinvent these on every project, producing inconsistent error formats, ad-hoc validation, and pagination that breaks under real-time inserts.  This module provides production-quality implementations of all five concerns with **zero runtime dependencies**.

## 为什么这样设计

| 决策 | 选择 | 权衡 |
|------|------|------|
| **内置 validator 而非 Zod** | 自建轻量 schema DSL | Zod 是 13 kB，验证是最底层的基础设施，不应依赖第三方库。牺牲了 Zod 的部分高级功能（transform、refine 链式），换来零依赖和完全可控。 |
| **框架无关** | 纯函数 + 类型定义 | Startup 经常换框架（Express → Fastify → Hono → Bun），路由和验证不应绑定框架。代价是需要写一层薄薄的适配器。 |
| **标准化响应信封** | `{ ok, data/error, meta }` | 前端团队不需要猜测 API 返回格式。`ok` 字段是 TypeScript 的判别联合（discriminated union），类型收窄极其方便。 |
| **默认游标分页** | Cursor-based pagination | Offset 分页在数据实时插入/删除时会跳过或重复数据。Cursor 分页稳定且可扩展到大数据集。仍保留 offset 分页用于后台管理等简单场景。 |
| **中间件链模式** | 洋葱模型（onion model） | 与 Koa / Hono 一致的中间件执行模型，每个中间件可以在 `next()` 前后执行逻辑。 |

## 快速使用

### 请求验证

```typescript
import { object, string, number, optional, validate } from "@codenexus/api";

const createUserSchema = object({
  name: string({ minLength: 1, maxLength: 100 }),
  email: string({ pattern: /^[^@]+@[^@]+\.[^@]+$/ }),
  age: optional(number({ min: 0, max: 150, integer: true })),
});

const result = validate(requestBody, createUserSchema);
if (!result.success) {
  // result.errors: Array<{ path: string; message: string }>
  return badRequest("Validation failed", result.errors);
}
// result.data is typed and safe to use
```

### 标准化响应

```typescript
import { ok, created, notFound, badRequest, paginated } from "@codenexus/api";

// 成功响应
return ok({ user: { id: 1, name: "Alice" } });
// → { status: 200, body: { ok: true, data: { user: { id: 1, name: "Alice" } } } }

// 创建响应
return created({ id: 42 });
// → { status: 201, body: { ok: true, data: { id: 42 } } }

// 错误响应
return notFound("User not found");
// → { status: 404, body: { ok: false, error: { code: "NOT_FOUND", message: "User not found" } } }

// 带详情的错误
return badRequest("Validation failed", [{ field: "email", message: "Invalid" }]);
```

### 路由

```typescript
import { Router } from "@codenexus/api";

const router = new Router();

// 简单路由
router.get("/users", listUsers);
router.post("/users", createUser);
router.get("/users/:id", getUser);

// 路由分组 + 中间件
router.group({
  prefix: "/api/v1",
  middleware: [authMiddleware, corsMiddleware],
  routes: [
    { method: "GET", path: "/me", handler: getProfile },
    { method: "PUT", path: "/me", handler: updateProfile },
  ],
});

// 处理请求
const response = await router.handle(request);
```

### CORS

```typescript
import { createCorsMiddleware } from "@codenexus/api";

const cors = createCorsMiddleware({
  origins: ["https://app.example.com", "*.staging.example.com"],
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
});
```

### 分页

```typescript
import { cursorPage, encodeCursor, decodeCursor, clampLimit } from "@codenexus/api";

// 游标分页（推荐）
const limit = clampLimit(req.query.limit);  // 默认 20，最大 100
const items = await db.query("SELECT * FROM posts WHERE id > ? LIMIT ?", [
  cursor ? decodeCursor(cursor) : 0,
  limit + 1,  // 多取一条用来判断是否有下一页
]);

const { data, pageInfo } = cursorPage({
  items,
  limit,
  getCursor: (item) => item.id,
  hasPreviousPage: !!cursor,
});
```

## 配置项

### ApiConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `basePath` | `string` | — | API 基础路径，如 `/api` |
| `version` | `string` | — | API 版本，如 `v1` |
| `cors` | `CorsConfig` | — | CORS 配置 |
| `pagination` | `PaginationDefaults` | `{ defaultLimit: 20, maxLimit: 100 }` | 分页默认值 |

### CorsConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `origins` | `string[]` | — | 允许的来源列表，支持 `*` 和 `*.example.com` |
| `methods` | `HttpMethod[]` | `GET, POST, PUT, PATCH, DELETE, OPTIONS` | 允许的 HTTP 方法 |
| `allowHeaders` | `string[]` | `Content-Type, Authorization` | 允许的请求头 |
| `exposeHeaders` | `string[]` | `[]` | 暴露给前端的响应头 |
| `credentials` | `boolean` | `false` | 是否允许携带凭证 |
| `maxAge` | `number` | `86400` | 预检请求缓存时间（秒） |

### Validator Schema DSL

| 函数 | 说明 | 选项 |
|------|------|------|
| `string()` | 字符串验证 | `minLength`, `maxLength`, `pattern` |
| `number()` | 数字验证 | `min`, `max`, `integer` |
| `boolean()` | 布尔验证 | — |
| `object()` | 对象验证 | `properties` |
| `array()` | 数组验证 | `items`, `minItems`, `maxItems` |
| `enumType()` | 枚举验证 | `values` |
| `optional()` | 标记字段可选 | — |
| `withRule()` | 添加自定义规则 | `name`, `validate`, `message` |

## 来源 & 致谢

- [Hono](https://github.com/honojs/hono) — 轻量路由 + 类型推导的最佳 DX
- [tRPC](https://github.com/trpc/trpc) — 验证 schema 到 handler 的端到端类型安全
- 内部实践总结

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 Hono/tRPC/Zod 模式中提炼出框架无关的 API 基础设施，零运行时依赖 |
