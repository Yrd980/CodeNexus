# AI Integration

## 解决什么问题

Every startup adding AI ends up with spaghetti LLM code. Direct API calls scattered across the codebase, no error handling for the inevitable 429s and 500s, no cost tracking (until the $50k bill arrives), and prompt strings hardcoded inline where they can't be tested, versioned, or reviewed. When it's time to switch from GPT-4 to Claude (or to a local model), you're rewriting fifty call-sites instead of changing one config line.

This module provides production-grade patterns for LLM integration: provider abstraction, prompt management, streaming, retry/fallback, and cost tracking — all with zero runtime dependencies.

## 为什么这样设计

**Provider abstraction** because you will switch models. GPT-4 to Claude to a local model — cost, quality, and latency requirements change. Your application code should call `provider.chat(messages)` and never know which LLM is behind it.

**Prompt templates** because inline strings are untestable, unreviewable, and un-versionable. The `{{variable}}` interpolation scheme is intentionally simple — no template engine dependency, but enough to prevent injection bugs and enable A/B testing of prompts.

**Streaming-first** because LLM responses are inherently streamed token-by-token. `AsyncIterable<StreamChunk>` is the natural abstraction — it lets callers show partial results instantly, cancel early, and pipe into downstream transforms without buffering.

**Fallback chain** because LLM APIs have ~99.5% uptime, which means ~4 hours of downtime per month. The retry → circuit breaker → provider fallback chain keeps your product working when a single provider goes down.

**Cost tracking** because "why is our API bill $50k?" is a real startup question. You need per-feature, per-model cost breakdowns and budget limits before you're surprised.

**No SDK dependency** because SDKs change fast. The OpenAI SDK had 3 major versions in 2 years. This module defines the *pattern* — you bring your own SDK and write a thin adapter. The pattern outlives any specific SDK version.

## 快速使用

### Install

```bash
cd modules/ai-integration
npm install
```

### Provider + Chat

```typescript
import { MockProvider, createProvider } from "@codenexus/ai-integration";

// For testing / development
const provider = new MockProvider({ chatResponse: "Hello!" });
const response = await provider.chat([
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "What is 2+2?" },
]);
console.log(response.content); // "Hello!"
console.log(response.usage);  // { promptTokens: ..., completionTokens: ..., totalTokens: ... }

// Register a real provider (bring your own SDK)
import { registerProvider } from "@codenexus/ai-integration";
registerProvider("openai", (config) => {
  // Return an object implementing LLMProvider using the OpenAI SDK
  return new MyOpenAIAdapter(config);
});
const realProvider = createProvider({ provider: "openai", model: "gpt-4o" });
```

### Prompt Templates

```typescript
import { PromptTemplate, MessageBuilder, PromptRegistry } from "@codenexus/ai-integration";

// Simple template
const template = new PromptTemplate(
  "Summarise this article in {{language}}: {{text}}",
  "1.0.0"
);
const prompt = template.format({ language: "English", text: "..." });

// Message builder with few-shot examples
const messages = new MessageBuilder()
  .system("You are a translator. Translate English to French.")
  .fewShot([
    { input: "Hello", output: "Bonjour" },
    { input: "Goodbye", output: "Au revoir" },
  ])
  .user("Thank you")
  .build();

// Registry with versioning
const registry = new PromptRegistry();
registry.register("summarise", template);
const { text, meta } = registry.format("summarise", { language: "English", text: "..." });
console.log(meta.version);         // "1.0.0"
console.log(meta.estimatedTokens); // rough token count
```

### Streaming

```typescript
import { collectStream, transformStream, forkStream, withTimeout } from "@codenexus/ai-integration";

// Collect entire stream
const stream = await provider.stream(messages);
const result = await collectStream(stream);
console.log(result.content);

// Transform chunks
const upper = transformStream(stream, (delta) => delta.toUpperCase());

// Fork to multiple consumers
const [forUI, forDB] = forkStream(stream, 2);
// Render forUI to the user, save forDB to database — one API call

// Timeout stalled streams
const safe = withTimeout(stream, 30_000); // 30s per chunk
```

### Fallback Chain

```typescript
import { FallbackChain, withRetry } from "@codenexus/ai-integration";

const chain = new FallbackChain([
  { provider: openaiProvider, config: { model: "gpt-4o" } },
  { provider: anthropicProvider, config: { model: "claude-sonnet-4-20250514" } },
], {
  retry: { maxAttempts: 3, baseDelayMs: 1000 },
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
});

// Automatically retries, then falls back to Anthropic if OpenAI is down
const response = await chain.chat(messages);
```

### Cost Tracking

```typescript
import { CostTracker } from "@codenexus/ai-integration";

const tracker = new CostTracker({
  budgetUsd: 100,
  alertThresholds: [50, 80, 100],
  onAlert: (cost, budget, percent) => {
    console.warn(`LLM budget alert: ${percent.toFixed(0)}% used ($${cost.toFixed(2)}/$${budget})`);
  },
});

// After each LLM call
tracker.record("gpt-4o", response.usage, "search-feature");

// Check costs
console.log(tracker.getTotalCost());        // total USD spent
console.log(tracker.getCostByModel());      // breakdown by model
console.log(tracker.getCostByTag());        // breakdown by feature
console.log(tracker.getRemainingBudget());  // USD remaining
```

## 配置项

### LLMConfig

| 参数 | 类型 | 说明 |
|------|------|------|
| `provider` | `"openai" \| "anthropic" \| "custom"` | Provider type |
| `model` | `string` | Model identifier (e.g. `"gpt-4o"`) |
| `temperature` | `number?` | Sampling temperature (0-2) |
| `maxTokens` | `number?` | Max tokens to generate |
| `apiKey` | `string?` | API key (prefer env vars) |
| `baseUrl` | `string?` | Base URL override |

### RetryOptions

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxAttempts` | `3` | Max attempts including initial |
| `baseDelayMs` | `1000` | Base delay (doubles each retry) |
| `maxDelayMs` | `30000` | Maximum delay cap |
| `jitter` | `0.2` | Randomisation factor (0-1) |

### CircuitBreakerOptions

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `failureThreshold` | `5` | Consecutive failures to open |
| `resetTimeoutMs` | `30000` | Time before half-open |
| `halfOpenSuccesses` | `2` | Successes to close again |

### CostTrackerOptions

| 参数 | 说明 |
|------|------|
| `pricing` | Custom `ModelPricing[]` (merged with defaults) |
| `budgetUsd` | Monthly budget limit (0 = no limit) |
| `alertThresholds` | Percentage thresholds (e.g. `[50, 80, 100]`) |
| `onAlert` | Callback when threshold is crossed |

## 来源 & 致谢

- **vercel/ai** — Streaming-first design with AsyncIterator. The right abstraction for LLM responses.
- **langchain** — Provider abstraction and prompt templates are essential patterns, but LangChain itself is too heavy for most startups. We took the ideas, not the code.
- **OpenAI / Anthropic SDK patterns** — Error codes, retry semantics, and token usage reporting.

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | Initial creation | Startup AI integration is a mess. Every team reinvents the same patterns: provider switching, retries, cost tracking. Zero-dep patterns that outlive SDK versions. |
