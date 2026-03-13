/**
 * AI Integration — Type Definitions
 *
 * Core types for the LLM provider abstraction layer.
 * Designed to be SDK-agnostic: these types map cleanly onto
 * OpenAI, Anthropic, or any custom provider's native types.
 */

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

/** Built-in provider names. Use 'custom' for self-hosted or niche APIs. */
export type ProviderName = "openai" | "anthropic" | "custom";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for an LLM provider instance. */
export interface LLMConfig {
  /** Which provider this config targets. */
  provider: ProviderName;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
  model: string;
  /** Sampling temperature (0–2 for most providers). */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** API key — prefer env vars over hardcoding. */
  apiKey?: string;
  /** Base URL override (useful for proxies or self-hosted models). */
  baseUrl?: string;
  /** Arbitrary provider-specific options. */
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Roles following the OpenAI/Anthropic convention. */
export type MessageRole = "system" | "user" | "assistant";

/** A single message in a conversation. */
export interface Message {
  role: MessageRole;
  content: string;
}

// ---------------------------------------------------------------------------
// Chat responses
// ---------------------------------------------------------------------------

/** Token usage breakdown for a single request. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Reason the model stopped generating. */
export type FinishReason = "stop" | "length" | "content_filter" | "error" | "unknown";

/** Non-streaming chat completion response. */
export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  finishReason: FinishReason;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** A single chunk emitted during streaming. */
export interface StreamChunk {
  /** Incremental text delta (may be empty on the final chunk). */
  delta: string;
  /** Set on the final chunk. */
  finishReason?: FinishReason;
  /** Partial usage info — some providers only send this on the last chunk. */
  usage?: Partial<TokenUsage>;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** Response from an embedding request. */
export interface EmbeddingResponse {
  /** One embedding vector per input string. */
  embeddings: number[][];
  usage: Pick<TokenUsage, "promptTokens" | "totalTokens">;
  model: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * The core abstraction every provider must implement.
 *
 * Consumers code against this interface; the concrete provider
 * handles HTTP calls, auth, and response mapping.
 */
export interface LLMProvider {
  /** Provider identifier for logging/routing. */
  readonly name: ProviderName;

  /** Non-streaming chat completion. */
  chat(messages: Message[], config?: Partial<LLMConfig>): Promise<ChatResponse>;

  /**
   * Streaming chat completion.
   * Returns an async iterable of chunks so callers can `for await` over it.
   */
  stream(
    messages: Message[],
    config?: Partial<LLMConfig>,
  ): Promise<AsyncIterable<StreamChunk>>;

  /**
   * Generate embeddings for one or more input strings.
   * Optional — not all providers support embeddings.
   */
  embed?(inputs: string[], config?: Partial<LLMConfig>): Promise<EmbeddingResponse>;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Categorised error codes for retry/fallback logic. */
export type LLMErrorCode =
  | "rate_limit"      // 429
  | "server_error"    // 500-503
  | "auth_error"      // 401/403
  | "context_length"  // input too long
  | "content_filter"  // safety filter triggered
  | "timeout"         // request or stream timed out
  | "unknown";

/** Structured error thrown by providers and utilities. */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: LLMErrorCode,
    public readonly provider?: ProviderName,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
