# SaaS Next.js Starter

## 解决什么问题

Starting a SaaS means wiring auth, billing, dashboard, API routes — and structuring them correctly in Next.js App Router. Most tutorials show toy apps, not production architecture. This module provides annotated, type-safe pattern files that demonstrate how to build a SaaS with Next.js — not a boilerplate to clone, but a reference to learn from and copy into your own project.

## 为什么这样设计

**App Router** because it's the future of Next.js. Server Components first because they're faster and simpler. Layout-based architecture because it maps naturally to SaaS navigation (dashboard shell, settings shell, etc.).

**Middleware-based auth** because it catches unauthorized requests before they hit your app. Lightweight cookie check at the edge, full session validation in Server Components. This two-layer approach balances speed and security.

**Billing patterns separated from UI** because payment logic needs to be testable. Webhook-driven sync (not polling) because it's more reliable — Stripe tells you when something changes, you don't need to ask. Idempotent webhook processing because Stripe retries on failure.

**TypeScript strict** because SaaS codebases grow fast and types prevent bugs at scale. No `any` anywhere — every function has explicit input and output types.

**Pattern files, not a runnable app** because every SaaS is different. You don't need our UI library, our database schema, or our auth provider. You need to understand the architecture patterns and adapt them to your stack.

## 快速使用

This is a pattern module — copy the patterns you need into your Next.js project.

```bash
# Browse the patterns
ls src/config/   # Site config, auth config
ls src/lib/      # Auth, API client, billing utilities
ls src/middleware.ts  # Request pipeline
ls src/components/   # Layout, auth guard patterns
ls src/app/      # API route patterns

# Run the tests to see how everything works
npm install
npm test
```

### Example: Add auth to your Next.js project

1. Copy `src/config/auth.ts` — define your protected/public routes
2. Copy `src/lib/auth.ts` — session management and role checks
3. Copy `src/middleware.ts` — wire up the request pipeline
4. Adapt to your auth provider (NextAuth, Clerk, Lucia, etc.)

### Example: Add billing

1. Copy `src/config/site.ts` — define your pricing plans
2. Copy `src/lib/billing.ts` — subscription helpers and webhook handlers
3. Copy `src/app/api/webhooks/stripe/route.ts` — webhook endpoint pattern
4. Wire up your Stripe SDK and database

## 配置项

### Site Config (`src/config/site.ts`)
| 配置 | 说明 | 默认值 |
|------|------|--------|
| `name` | 产品名称 | "YourSaaS" |
| `url` | 产品 URL | "https://yoursaas.com" |
| `social` | 社交链接 | Twitter, GitHub |
| `plans` | 定价方案 | Free, Pro, Enterprise |

### Auth Config (`src/config/auth.ts`)
| 配置 | 说明 | 默认值 |
|------|------|--------|
| `session.maxAge` | Session 有效期 | 30 天 |
| `session.updateAge` | Session 刷新间隔 | 24 小时 |
| `protectedRoutes` | 需要登录的路由前缀 | /dashboard, /settings, /api/v1, /billing |
| `publicRoutes` | 公开路由（优先级高于 protected） | /, /login, /signup, /api/webhooks |
| `providers` | OAuth 提供商配置 | Google, GitHub |

### Middleware (`src/middleware.ts`)
| 配置 | 说明 | 默认值 |
|------|------|--------|
| Rate Limiter | 请求频率限制 | 100 req/min per IP |
| CORS | 跨域配置 | localhost:3000 |

## 模块结构

```
starters/saas-nextjs/
├── src/
│   ├── config/
│   │   ├── site.ts         # 站点配置 + 定价方案
│   │   └── auth.ts         # 认证配置 + 路由保护规则
│   ├── lib/
│   │   ├── auth.ts         # Session 管理 + 角色权限
│   │   ├── api.ts          # 类型安全 API 客户端
│   │   └── billing.ts      # 订阅管理 + Webhook 处理
│   ├── components/
│   │   ├── layout/
│   │   │   └── dashboard-layout.tsx  # Dashboard 布局模式
│   │   └── auth/
│   │       └── auth-guard.tsx        # 认证守卫模式
│   ├── middleware.ts        # 请求管道（auth + rate limit + CORS）
│   ├── app/
│   │   └── api/
│   │       ├── webhooks/stripe/route.ts  # Stripe Webhook 处理
│   │       └── health/route.ts           # 健康检查端点
│   └── types/
│       └── index.ts         # 共享类型定义
├── tests/                   # Vitest 测试
├── .meta.yml
├── package.json
└── tsconfig.json
```

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 Vercel SaaS 模板和 Next.js App Router 模式中提炼 |
