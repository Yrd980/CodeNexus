/**
 * AI Integration — Provider Abstraction
 *
 * Unified interface for LLM providers.  The key idea: your application code
 * calls `provider.chat(messages)` and never knows whether it's hitting
 * OpenAI, Anthropic, or a mock.  When you switch models (and you will),
 * you change one line of config — not fifty call-sites.
 *
 * This module ships a MockProvider for testing.  Real providers are thin
 * wrappers that map SDK responses → our ChatResponse/StreamChunk types.
 * We don't bundle any SDK — you bring your own.
 */

import type {
  ChatResponse,
  EmbeddingResponse,
  FinishReason,
  LLMConfig,
  LLMProvider,
  Message,
  ProviderName,
  StreamChunk,
  TokenUsage,
} from "./types.js";
import { LLMError } from "./types.js";

// ---------------------------------------------------------------------------
// MockProvider — deterministic provider for tests & demos
// ---------------------------------------------------------------------------

/** Options to customise MockProvider behaviour. */
export interface MockProviderOptions {
  /** Fixed response content for chat(). */
  chatResponse?: string;
  /** If set, chat() will throw this error. */
  chatError?: LLMError;
  /** Fixed embeddings for embed(). */
  embeddings?: number[][];
  /** Simulated latency in ms per chat call. */
  latencyMs?: number;
  /** Model name to report. */
  model?: string;
}

/** Record of a single call made to the MockProvider. */
export interface MockCall {
  method: "chat" | "stream" | "embed";
  messages?: Message[];
  inputs?: string[];
  config?: Partial<LLMConfig>;
  timestamp: number;
}

/**
 * A fully deterministic LLM provider for unit tests.
 *
 * - Returns canned responses (configurable).
 * - Records every call for assertions.
 * - Supports simulated latency and errors.
 */
export class MockProvider implements LLMProvider {
  readonly name: ProviderName = "custom";
  readonly calls: MockCall[] = [];

  private readonly opts: Required<MockProviderOptions>;

  constructor(options: MockProviderOptions = {}) {
    this.opts = {
      chatResponse: options.chatResponse ?? "Mock response",
      chatError: options.chatError as LLMError,
      embeddings: options.embeddings ?? [[0.1, 0.2, 0.3]],
      latencyMs: options.latencyMs ?? 0,
      model: options.model ?? "mock-model",
    };
  }

  async chat(messages: Message[], config?: Partial<LLMConfig>): Promise<ChatResponse> {
    this.calls.push({ method: "chat", messages, config, timestamp: Date.now() });

    if (this.opts.latencyMs > 0) {
      await delay(this.opts.latencyMs);
    }
    if (this.opts.chatError) {
      throw this.opts.chatError;
    }

    const content = this.opts.chatResponse;
    const usage: TokenUsage = {
      promptTokens: estimateTokens(messages.map((m) => m.content).join("")),
      completionTokens: estimateTokens(content),
      totalTokens: 0,
    };
    usage.totalTokens = usage.promptTokens + usage.completionTokens;

    return {
      content,
      usage,
      model: config?.model ?? this.opts.model,
      finishReason: "stop" as FinishReason,
    };
  }

  async stream(
    messages: Message[],
    config?: Partial<LLMConfig>,
  ): Promise<AsyncIterable<StreamChunk>> {
    this.calls.push({ method: "stream", messages, config, timestamp: Date.now() });

    if (this.opts.chatError) {
      throw this.opts.chatError;
    }

    const content = this.opts.chatResponse;
    const words = content.split(" ");
    const latency = this.opts.latencyMs;

    async function* generate(): AsyncGenerator<StreamChunk> {
      for (let i = 0; i < words.length; i++) {
        if (latency > 0) {
          await delay(latency / words.length);
        }
        const isLast = i === words.length - 1;
        const word = words[i]!;
        const delta = i === 0 ? word : ` ${word}`;
        yield {
          delta,
          finishReason: isLast ? "stop" : undefined,
          usage: isLast
            ? {
                promptTokens: estimateTokens(messages.map((m) => m.content).join("")),
                completionTokens: estimateTokens(content),
              }
            : undefined,
        };
      }
    }

    return generate();
  }

  async embed(
    inputs: string[],
    config?: Partial<LLMConfig>,
  ): Promise<EmbeddingResponse> {
    this.calls.push({ method: "embed", inputs, config, timestamp: Date.now() });

    // Return one embedding per input — repeat the fixed vector
    const baseEmbedding = this.opts.embeddings[0] ?? [];
    const embeddings = inputs.map(() => [...baseEmbedding]);
    return {
      embeddings,
      usage: {
        promptTokens: estimateTokens(inputs.join("")),
        totalTokens: estimateTokens(inputs.join("")),
      },
      model: config?.model ?? this.opts.model,
    };
  }

  /** Reset recorded calls. */
  reset(): void {
    this.calls.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Registry of provider constructors.
 * In a real app you'd register OpenAI/Anthropic adapters here.
 * Ships with "mock" out of the box for testing.
 */
type ProviderFactory = (config: LLMConfig) => LLMProvider;

const registry = new Map<string, ProviderFactory>();

/** Register a custom provider factory under a name. */
export function registerProvider(name: string, factory: ProviderFactory): void {
  registry.set(name, factory);
}

/**
 * Create a provider instance from config.
 *
 * If the provider name has been registered via `registerProvider`,
 * it uses that factory.  Otherwise it falls back to MockProvider
 * (handy during development).
 */
export function createProvider(config: LLMConfig): LLMProvider {
  const factory = registry.get(config.provider);
  if (factory) {
    return factory(config);
  }

  // Unregistered provider — surface a clear error in production,
  // but for "custom" we return a mock so tests/demos work out of the box.
  if (config.provider === "custom") {
    return new MockProvider({ model: config.model });
  }

  throw new LLMError(
    `Provider "${config.provider}" is not registered. ` +
      `Call registerProvider("${config.provider}", factory) first, ` +
      `or use provider: "custom" for testing.`,
    "unknown",
    config.provider,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token (English). No tokenizer dep. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
