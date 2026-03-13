# Payments

## 解决什么问题

Payment integration is the highest-stakes code in most startups: bugs mean lost revenue, duplicate charges, or security breaches. The most common and costly mistakes are:

- **Webhook double-processing** — payment providers deliver webhooks at-least-once, so your handler runs the same event multiple times, charging customers twice or creating duplicate records.
- **Missing idempotency** — retried requests without idempotency keys create duplicate charges.
- **Incorrect subscription state management** — ad-hoc status checks lead to impossible states (e.g., a subscription that's both "active" and "canceled").
- **Unverified webhooks** — accepting webhooks without signature verification is a security vulnerability that lets attackers forge payment events.

This module provides the **patterns** for handling all of these correctly, without coupling to any specific payment provider.

## 为什么这样设计

### Provider Abstraction

You might start with Stripe and switch to Paddle (or add LemonSqueezy for certain markets). The `PaymentProvider` interface captures the essential operations — charges, subscriptions, webhooks — so your business logic never imports a specific SDK. The `MockPaymentProvider` included here gives you a complete test double for free.

### Webhook Signature Verification

The module uses the Stripe-style signature scheme (`ts=<timestamp>,v1=<hmac-sha256>`) because it's the de-facto standard. The implementation uses `timingSafeEqual` to prevent timing attacks, and rejects events older than a configurable tolerance to prevent replay attacks.

### Built-in Idempotency

The `IdempotencyStore` and `idempotent()` wrapper make it trivial to ensure that the same operation (identified by key) only executes once. The in-memory store works for single-process deployments; swap it for Redis in production with the same interface.

### Subscription State Machine

Instead of scattering `if (subscription.status === 'active')` checks throughout the codebase, all valid transitions are defined in one place. The `transitionSubscription` function throws `InvalidTransitionError` if you try an illegal move (e.g., `canceled -> past_due`). This eliminates an entire class of bugs.

### No Stripe SDK Dependency

Zero runtime dependencies. The patterns work with any payment provider. The `MockPaymentProvider` simulates all flows for testing.

### Trade-offs

- **In-memory idempotency store**: Simple but doesn't survive restarts. Use Redis in production.
- **No actual provider integration**: This is intentional — the value is the pattern, not the Stripe SDK wrapper.
- **Day-based proration**: Simple and predictable, but less precise than second-based proration for very short billing periods.

## 快速使用

### Installation

```bash
cd modules/payments
npm install
```

### Creating a Payment Provider

```typescript
import { createPaymentProvider } from "./src/index.js";

const provider = createPaymentProvider({
  apiKey: process.env.PAYMENT_API_KEY!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  currency: "usd",
  testMode: process.env.NODE_ENV !== "production",
});
```

### Charging a Customer

```typescript
import { generateIdempotencyKey } from "./src/index.js";

const charge = await provider.createCharge({
  amount: 2999, // $29.99 in cents
  customerId: "cus_abc123",
  description: "Pro plan — March 2026",
  idempotencyKey: generateIdempotencyKey(),
});
```

### Handling Webhooks

```typescript
import { createWebhookProcessor } from "./src/index.js";

const processor = createWebhookProcessor({
  secret: process.env.WEBHOOK_SECRET!,
  toleranceMs: 5 * 60 * 1000, // 5 minutes
});

processor.on("charge.succeeded", async (event) => {
  console.log("Payment received:", event.data);
});

processor.on("invoice.payment_failed", async (event) => {
  console.log("Payment failed, sending dunning email:", event.data);
});

// In your HTTP handler:
const event = await processor.process(requestBody, signatureHeader);
```

### Managing Subscriptions

```typescript
// Create
const sub = await provider.createSubscription({
  customerId: "cus_abc123",
  planId: "plan_pro",
  trialDays: 14,
});

// Upgrade
const upgraded = await provider.updateSubscription(sub.id, {
  planId: "plan_enterprise",
});

// Cancel at period end
const canceled = await provider.cancelSubscription(sub.id, false);

// Cancel immediately
const canceledNow = await provider.cancelSubscription(sub.id, true);
```

### Calculating Proration

```typescript
import { calculateProration } from "./src/index.js";

const proration = calculateProration(subscription, basicPlan, proPlan);
console.log(`Upgrade cost: $${(proration.netAmount / 100).toFixed(2)}`);
// "Upgrade cost: $12.50"
```

### Idempotent Operations

```typescript
import { IdempotencyStore, idempotent } from "./src/index.js";

const store = new IdempotencyStore<Charge>();

// Same key = same result, operation only runs once
const charge = await idempotent(store, "order_123_charge", () =>
  provider.createCharge({ amount: 2999, customerId: "cus_abc123" }),
);
```

## 配置项

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | Payment provider API key |
| `webhookSecret` | `string` | — | Secret for webhook signature verification |
| `currency` | `string` | — | Default currency code (e.g., `"usd"`) |
| `testMode` | `boolean` | — | Enable test/sandbox mode |

### Webhook Processor Options

| Parameter | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | — | HMAC-SHA256 signing secret |
| `toleranceMs` | `number` | `300000` (5 min) | Max age for webhook events |
| `idempotencyTtlMs` | `number` | `86400000` (24h) | TTL for deduplication tracking |

### Idempotency Store Options

| Parameter | Type | Default | Description |
|---|---|---|---|
| `ttlMs` | `number` | `86400000` (24h) | TTL for stored results |

## Running Tests

```bash
npm test          # run all tests
npm run typecheck # TypeScript strict mode check
```

## 来源 & 致谢

- **Stripe** — Idempotency keys, webhook signature scheme, subscription lifecycle model
- **Paddle** — Subscription state machine with explicit valid transitions

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 Stripe/Paddle 支付模式中提炼通用的支付处理模式：provider 抽象、webhook 签名验证、幂等性、订阅状态机 |
