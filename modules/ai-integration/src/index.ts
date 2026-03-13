/**
 * AI Integration — Public API
 *
 * Re-exports everything consumers need.  Import from "ai-integration"
 * rather than reaching into individual files.
 */

// Types
export type {
  ProviderName,
  LLMConfig,
  MessageRole,
  Message,
  TokenUsage,
  FinishReason,
  ChatResponse,
  StreamChunk,
  EmbeddingResponse,
  LLMProvider,
  LLMErrorCode,
} from "./types.js";

export { LLMError } from "./types.js";

// Provider
export type { MockProviderOptions, MockCall } from "./provider.js";
export {
  MockProvider,
  createProvider,
  registerProvider,
  estimateTokens,
} from "./provider.js";

// Prompt management
export {
  PromptTemplate,
  MessageBuilder,
  PromptRegistry,
} from "./prompt.js";
export type { PromptMeta } from "./prompt.js";

// Streaming utilities
export type { CollectedStream } from "./streaming.js";
export {
  collectStream,
  transformStream,
  forkStream,
  withTimeout,
  withBackpressure,
  createStream,
} from "./streaming.js";

// Fallback & reliability
export type {
  RetryOptions,
  CircuitState,
  CircuitBreakerOptions,
  FallbackChainOptions,
  ModelTier,
  CostRoute,
} from "./fallback.js";
export {
  withRetry,
  CircuitBreaker,
  FallbackChain,
  CostAwareRouter,
} from "./fallback.js";

// Cost tracking
export type {
  ModelPricing,
  UsageRecord,
  BudgetAlertFn,
  CostTrackerOptions,
} from "./cost.js";
export { DEFAULT_PRICING, CostTracker } from "./cost.js";
