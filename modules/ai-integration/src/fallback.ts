/**
 * AI Integration — Reliability Patterns
 *
 * LLM APIs are not as reliable as you'd hope:
 *   - OpenAI: ~99.5% uptime → ~4 hours downtime per month
 *   - Rate limits (429) hit during traffic spikes
 *   - Occasional 500/503 during deployments
 *
 * This module provides:
 *   1. Retry with exponential backoff for transient errors
 *   2. Provider/model fallback chains
 *   3. Circuit breaker to stop hammering a dead service
 *   4. Cost-aware routing
 */

import type {
  ChatResponse,
  LLMConfig,
  LLMProvider,
  Message,
  StreamChunk,
} from "./types.js";
import { LLMError } from "./types.js";

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

/** Options for retry behaviour. */
export interface RetryOptions {
  /** Maximum number of attempts (including the initial one). */
  maxAttempts: number;
  /** Base delay in ms (doubles on each retry). */
  baseDelayMs: number;
  /** Maximum delay between retries. */
  maxDelayMs: number;
  /** Jitter factor (0–1): randomises delay to avoid thundering herd. */
  jitter: number;
  /** Which error codes should trigger a retry. */
  retryableCodes: Set<string>;
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: 0.2,
  retryableCodes: new Set(["rate_limit", "server_error", "timeout"]),
};

/**
 * Execute an async function with exponential backoff retry.
 *
 * Only retries errors that are LLMError with a retryable code.
 * Non-retryable errors (auth, content_filter) are thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isRetryable =
        err instanceof LLMError &&
        opts.retryableCodes.has(err.code);

      if (!isRetryable || attempt === opts.maxAttempts) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const expDelay = opts.baseDelayMs * 2 ** (attempt - 1);
      const jitter = 1 + (Math.random() * 2 - 1) * opts.jitter;
      const delay = Math.min(expDelay * jitter, opts.maxDelayMs);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Shouldn't reach here, but TypeScript needs it
  throw lastError ?? new Error("withRetry: exhausted attempts");
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/** Circuit breaker state. */
export type CircuitState = "closed" | "open" | "half-open";

/** Configuration for the circuit breaker. */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: number;
  /** How long to wait (ms) before trying half-open. */
  resetTimeoutMs: number;
  /** Number of successes needed in half-open to close the circuit. */
  halfOpenSuccesses: number;
}

const DEFAULT_CIRCUIT: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenSuccesses: 2,
};

/**
 * Circuit breaker to prevent hammering a failing provider.
 *
 * States:
 *   closed     → requests flow normally
 *   open       → requests are immediately rejected
 *   half-open  → a limited number of requests are allowed to test recovery
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly opts: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.opts = { ...DEFAULT_CIRCUIT, ...options };
  }

  /** Current state of the circuit. */
  getState(): CircuitState {
    // Check if open circuit should transition to half-open
    if (
      this.state === "open" &&
      Date.now() - this.lastFailureTime >= this.opts.resetTimeoutMs
    ) {
      this.state = "half-open";
      this.successes = 0;
    }
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws LLMError with code "server_error" if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === "open") {
      throw new LLMError(
        "Circuit breaker is open — provider is unavailable",
        "server_error",
        undefined,
        503,
        true,
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.successes++;
      if (this.successes >= this.opts.halfOpenSuccesses) {
        this.state = "closed";
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // Any failure in half-open goes straight back to open
      this.state = "open";
    } else if (this.failures >= this.opts.failureThreshold) {
      this.state = "open";
    }
  }

  /** Reset the circuit breaker to closed state. */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
  }
}

// ---------------------------------------------------------------------------
// Provider fallback chain
// ---------------------------------------------------------------------------

/** A provider entry with its associated circuit breaker. */
interface FallbackEntry {
  provider: LLMProvider;
  breaker: CircuitBreaker;
  config?: Partial<LLMConfig>;
}

/** Options for the fallback chain. */
export interface FallbackChainOptions {
  /** Retry options applied to each provider before moving to the next. */
  retry?: Partial<RetryOptions>;
  /** Circuit breaker options for each provider. */
  circuitBreaker?: Partial<CircuitBreakerOptions>;
}

/**
 * A chain of LLM providers with automatic fallback.
 *
 * Tries the primary provider first.  If it fails with a retryable error
 * (after exhausting retries), moves to the next provider in the chain.
 *
 * Each provider has its own circuit breaker, so a provider that's been
 * consistently failing gets skipped quickly.
 */
export class FallbackChain implements LLMProvider {
  readonly name = "custom" as const;
  private readonly entries: FallbackEntry[];
  private readonly retryOpts: Partial<RetryOptions>;

  constructor(
    providers: Array<{ provider: LLMProvider; config?: Partial<LLMConfig> }>,
    options: FallbackChainOptions = {},
  ) {
    if (providers.length === 0) {
      throw new Error("FallbackChain requires at least one provider");
    }

    this.retryOpts = options.retry ?? {};
    this.entries = providers.map((p) => ({
      provider: p.provider,
      breaker: new CircuitBreaker(options.circuitBreaker),
      config: p.config,
    }));
  }

  async chat(messages: Message[], config?: Partial<LLMConfig>): Promise<ChatResponse> {
    return this.executeWithFallback((entry) =>
      entry.breaker.execute(() =>
        withRetry(
          () => entry.provider.chat(messages, { ...entry.config, ...config }),
          this.retryOpts,
        ),
      ),
    );
  }

  async stream(
    messages: Message[],
    config?: Partial<LLMConfig>,
  ): Promise<AsyncIterable<StreamChunk>> {
    return this.executeWithFallback((entry) =>
      entry.breaker.execute(() =>
        withRetry(
          () => entry.provider.stream(messages, { ...entry.config, ...config }),
          this.retryOpts,
        ),
      ),
    );
  }

  private async executeWithFallback<T>(
    fn: (entry: FallbackEntry) => Promise<T>,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (const entry of this.entries) {
      try {
        return await fn(entry);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Non-retryable errors should not trigger fallback
        if (err instanceof LLMError && !err.retryable) {
          throw err;
        }
        // Otherwise, try the next provider
      }
    }

    throw new LLMError(
      `All providers in fallback chain failed. Last error: ${lastError?.message}`,
      "server_error",
      undefined,
      undefined,
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// Cost-aware routing
// ---------------------------------------------------------------------------

/** Model tier classification for cost-aware routing. */
export type ModelTier = "premium" | "standard" | "economy";

/** Route configuration for cost-aware model selection. */
export interface CostRoute {
  /** Provider to use for this tier. */
  provider: LLMProvider;
  /** Model config override (e.g. specific model name). */
  config: Partial<LLMConfig>;
  /** Approximate cost per 1K tokens (for logging/comparison). */
  costPer1kTokens: number;
}

/**
 * Route requests to different models based on task complexity.
 *
 * The idea: not every request needs GPT-4.  Classification tasks,
 * simple summaries, and boilerplate generation can use a cheaper model.
 * Save the expensive model for complex reasoning, code generation, etc.
 */
export class CostAwareRouter {
  private readonly routes: Map<ModelTier, CostRoute>;

  constructor(routes: Record<ModelTier, CostRoute>) {
    this.routes = new Map(Object.entries(routes) as [ModelTier, CostRoute][]);
  }

  /** Get the provider and config for a given tier. */
  getRoute(tier: ModelTier): CostRoute {
    const route = this.routes.get(tier);
    if (!route) {
      throw new Error(`CostAwareRouter: no route for tier "${tier}"`);
    }
    return route;
  }

  /** Convenience: chat using a specific tier. */
  async chat(
    tier: ModelTier,
    messages: Message[],
    config?: Partial<LLMConfig>,
  ): Promise<ChatResponse> {
    const route = this.getRoute(tier);
    return route.provider.chat(messages, { ...route.config, ...config });
  }
}
