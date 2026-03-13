import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  withRetry,
  CircuitBreaker,
  FallbackChain,
  CostAwareRouter,
} from "../src/fallback.js";
import { MockProvider } from "../src/provider.js";
import { LLMError } from "../src/types.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const result = await withRetry(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("retries retryable LLMErrors", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) {
          throw new LLMError("429", "rate_limit", "openai", 429, true);
        }
        return Promise.resolve("recovered");
      },
      { maxAttempts: 3, baseDelayMs: 10 },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw new LLMError("Unauthorized", "auth_error", "openai", 401, false);
        },
        { maxAttempts: 3, baseDelayMs: 10 },
      ),
    ).rejects.toThrow("Unauthorized");

    expect(attempts).toBe(1);
  });

  it("throws after exhausting max attempts", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw new LLMError("Server error", "server_error", "openai", 500, true);
        },
        { maxAttempts: 2, baseDelayMs: 10 },
      ),
    ).rejects.toThrow("Server error");

    expect(attempts).toBe(2);
  });

  it("does not retry generic errors (non-LLMError)", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw new Error("random");
        },
        { maxAttempts: 3, baseDelayMs: 10 },
      ),
    ).rejects.toThrow("random");

    expect(attempts).toBe(1);
  });
});

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenSuccesses: 2,
    });
  });

  it("starts in closed state", () => {
    expect(breaker.getState()).toBe("closed");
  });

  it("stays closed on successes", async () => {
    await breaker.execute(() => Promise.resolve("ok"));
    await breaker.execute(() => Promise.resolve("ok"));
    expect(breaker.getState()).toBe("closed");
  });

  it("opens after threshold failures", async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }
    expect(breaker.getState()).toBe("open");
  });

  it("rejects immediately when open", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }

    await expect(
      breaker.execute(() => Promise.resolve("should not run")),
    ).rejects.toThrow("Circuit breaker is open");
  });

  it("transitions to half-open after timeout", async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }
    expect(breaker.getState()).toBe("open");

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 120));
    expect(breaker.getState()).toBe("half-open");
  });

  it("closes again after successes in half-open", async () => {
    // Trip → open
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }
    // Wait → half-open
    await new Promise((r) => setTimeout(r, 120));

    // Two successes → closed
    await breaker.execute(() => Promise.resolve("ok"));
    await breaker.execute(() => Promise.resolve("ok"));
    expect(breaker.getState()).toBe("closed");
  });

  it("goes back to open on failure in half-open", async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 120));
    expect(breaker.getState()).toBe("half-open");

    await breaker.execute(() => Promise.reject(new Error("fail again"))).catch(() => {});
    expect(breaker.getState()).toBe("open");
  });

  it("resets to initial state", async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }
    breaker.reset();
    expect(breaker.getState()).toBe("closed");
  });
});

describe("FallbackChain", () => {
  it("uses primary provider when healthy", async () => {
    const primary = new MockProvider({ chatResponse: "primary" });
    const secondary = new MockProvider({ chatResponse: "secondary" });

    const chain = new FallbackChain([
      { provider: primary },
      { provider: secondary },
    ]);

    const result = await chain.chat([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("primary");
    expect(primary.calls).toHaveLength(1);
    expect(secondary.calls).toHaveLength(0);
  });

  it("falls back to secondary on retryable error", async () => {
    const primary = new MockProvider({
      chatError: new LLMError("429", "rate_limit", "openai", 429, true),
    });
    const secondary = new MockProvider({ chatResponse: "fallback works" });

    const chain = new FallbackChain(
      [{ provider: primary }, { provider: secondary }],
      { retry: { maxAttempts: 1, baseDelayMs: 10 } },
    );

    const result = await chain.chat([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("fallback works");
  });

  it("does not fall back on non-retryable error", async () => {
    const primary = new MockProvider({
      chatError: new LLMError("Auth failed", "auth_error", "openai", 401, false),
    });
    const secondary = new MockProvider({ chatResponse: "shouldn't reach" });

    const chain = new FallbackChain([
      { provider: primary },
      { provider: secondary },
    ]);

    await expect(
      chain.chat([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Auth failed");
    expect(secondary.calls).toHaveLength(0);
  });

  it("throws when all providers fail", async () => {
    const p1 = new MockProvider({
      chatError: new LLMError("fail1", "server_error", "openai", 500, true),
    });
    const p2 = new MockProvider({
      chatError: new LLMError("fail2", "server_error", "anthropic", 500, true),
    });

    const chain = new FallbackChain(
      [{ provider: p1 }, { provider: p2 }],
      { retry: { maxAttempts: 1, baseDelayMs: 10 } },
    );

    await expect(
      chain.chat([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("All providers in fallback chain failed");
  });

  it("requires at least one provider", () => {
    expect(() => new FallbackChain([])).toThrow("at least one provider");
  });

  it("applies per-entry config overrides", async () => {
    const provider = new MockProvider({ chatResponse: "ok" });
    const chain = new FallbackChain([
      { provider, config: { model: "gpt-4o" } },
    ]);

    const result = await chain.chat([{ role: "user", content: "hi" }]);
    expect(result.model).toBe("gpt-4o");
  });
});

describe("CostAwareRouter", () => {
  it("routes to the correct tier", async () => {
    const premiumProvider = new MockProvider({ chatResponse: "premium answer" });
    const economyProvider = new MockProvider({ chatResponse: "economy answer" });

    const router = new CostAwareRouter({
      premium: {
        provider: premiumProvider,
        config: { model: "gpt-4o" },
        costPer1kTokens: 0.03,
      },
      standard: {
        provider: economyProvider,
        config: { model: "gpt-4o-mini" },
        costPer1kTokens: 0.001,
      },
      economy: {
        provider: economyProvider,
        config: { model: "gpt-4o-mini" },
        costPer1kTokens: 0.001,
      },
    });

    const premium = await router.chat("premium", [{ role: "user", content: "complex question" }]);
    expect(premium.content).toBe("premium answer");

    const economy = await router.chat("economy", [{ role: "user", content: "simple question" }]);
    expect(economy.content).toBe("economy answer");
  });

  it("throws on unknown tier", () => {
    const router = new CostAwareRouter({
      premium: {
        provider: new MockProvider(),
        config: { model: "gpt-4o" },
        costPer1kTokens: 0.03,
      },
      standard: {
        provider: new MockProvider(),
        config: { model: "gpt-4o-mini" },
        costPer1kTokens: 0.001,
      },
      economy: {
        provider: new MockProvider(),
        config: { model: "gpt-4o-mini" },
        costPer1kTokens: 0.001,
      },
    });

    expect(() => router.getRoute("nonexistent" as never)).toThrow("no route");
  });
});
