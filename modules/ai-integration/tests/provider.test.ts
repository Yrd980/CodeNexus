import { describe, it, expect, beforeEach } from "vitest";
import {
  MockProvider,
  createProvider,
  registerProvider,
  estimateTokens,
} from "../src/provider.js";
import { LLMError } from "../src/types.js";
import type { LLMConfig, LLMProvider } from "../src/types.js";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello")).toBe(2); // 5 chars → ceil(5/4) = 2
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2); // 8 chars → 2 tokens
  });
});

describe("MockProvider", () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider({ chatResponse: "Hello from mock" });
  });

  it("returns canned chat response", async () => {
    const result = await provider.chat([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("Hello from mock");
    expect(result.finishReason).toBe("stop");
    expect(result.model).toBe("mock-model");
  });

  it("tracks token usage in chat response", async () => {
    const result = await provider.chat([{ role: "user", content: "test input" }]);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBe(
      result.usage.promptTokens + result.usage.completionTokens,
    );
  });

  it("records calls for assertion", async () => {
    const messages = [{ role: "user" as const, content: "test" }];
    await provider.chat(messages);
    await provider.chat(messages);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].method).toBe("chat");
    expect(provider.calls[0].messages).toEqual(messages);
  });

  it("resets call history", async () => {
    await provider.chat([{ role: "user", content: "test" }]);
    expect(provider.calls).toHaveLength(1);
    provider.reset();
    expect(provider.calls).toHaveLength(0);
  });

  it("uses config model when provided", async () => {
    const result = await provider.chat(
      [{ role: "user", content: "hi" }],
      { model: "custom-model" },
    );
    expect(result.model).toBe("custom-model");
  });

  it("throws configured error", async () => {
    const errorProvider = new MockProvider({
      chatError: new LLMError("Rate limited", "rate_limit", "openai", 429, true),
    });

    await expect(
      errorProvider.chat([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(LLMError);
  });

  it("streams response word by word", async () => {
    const stream = await provider.stream([{ role: "user", content: "hi" }]);
    const chunks: string[] = [];
    let lastFinishReason: string | undefined;

    for await (const chunk of stream) {
      chunks.push(chunk.delta);
      if (chunk.finishReason) {
        lastFinishReason = chunk.finishReason;
      }
    }

    expect(chunks.join("")).toBe("Hello from mock");
    expect(lastFinishReason).toBe("stop");
  });

  it("records stream calls", async () => {
    await provider.stream([{ role: "user", content: "hi" }]);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].method).toBe("stream");
  });

  it("generates embeddings", async () => {
    const result = await provider.embed!(["hello", "world"]);
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
  });

  it("applies simulated latency", async () => {
    const slowProvider = new MockProvider({ latencyMs: 50 });
    const start = Date.now();
    await slowProvider.chat([{ role: "user", content: "hi" }]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow some timing slack
  });
});

describe("createProvider", () => {
  it("returns MockProvider for 'custom' provider type", () => {
    const config: LLMConfig = { provider: "custom", model: "test" };
    const provider = createProvider(config);
    expect(provider.name).toBe("custom");
  });

  it("throws for unregistered provider", () => {
    const config: LLMConfig = { provider: "openai", model: "gpt-4o" };
    expect(() => createProvider(config)).toThrow(LLMError);
  });

  it("uses registered factory", () => {
    const mockFactory = (config: LLMConfig): LLMProvider => {
      return new MockProvider({ model: config.model });
    };

    registerProvider("openai", mockFactory);
    const config: LLMConfig = { provider: "openai", model: "gpt-4o" };
    const provider = createProvider(config);
    expect(provider).toBeDefined();

    // Clean up — re-registering will just overwrite, but let's be explicit
    registerProvider("openai", () => {
      throw new Error("cleaned up");
    });
  });
});
