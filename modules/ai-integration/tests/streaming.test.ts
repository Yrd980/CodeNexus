import { describe, it, expect } from "vitest";
import {
  collectStream,
  transformStream,
  forkStream,
  withTimeout,
  createStream,
} from "../src/streaming.js";
import { LLMError } from "../src/types.js";

describe("createStream", () => {
  it("creates an async iterable from string array", async () => {
    const stream = createStream(["Hello", " ", "world"]);
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(["Hello", " ", "world"]);
  });

  it("sets finishReason on last chunk", async () => {
    const stream = createStream(["a", "b"]);
    const reasons: Array<string | undefined> = [];
    for await (const chunk of stream) {
      reasons.push(chunk.finishReason);
    }
    expect(reasons).toEqual([undefined, "stop"]);
  });
});

describe("collectStream", () => {
  it("concatenates all deltas into a single string", async () => {
    const stream = createStream(["Hello", " ", "world"]);
    const result = await collectStream(stream);
    expect(result.content).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
    expect(result.chunks).toBe(3);
  });

  it("handles single-chunk stream", async () => {
    const stream = createStream(["Only chunk"]);
    const result = await collectStream(stream);
    expect(result.content).toBe("Only chunk");
    expect(result.chunks).toBe(1);
  });

  it("handles empty stream", async () => {
    const stream = createStream([]);
    const result = await collectStream(stream);
    expect(result.content).toBe("");
    expect(result.finishReason).toBe("unknown");
    expect(result.chunks).toBe(0);
  });
});

describe("transformStream", () => {
  it("transforms each chunk's delta", async () => {
    const stream = createStream(["hello", " world"]);
    const upper = transformStream(stream, (d) => d.toUpperCase());
    const result = await collectStream(upper);
    expect(result.content).toBe("HELLO WORLD");
  });

  it("provides chunk index to transform function", async () => {
    const stream = createStream(["a", "b", "c"]);
    const indices: number[] = [];
    const indexed = transformStream(stream, (d, i) => {
      indices.push(i);
      return d;
    });
    await collectStream(indexed);
    expect(indices).toEqual([0, 1, 2]);
  });

  it("preserves finishReason through transform", async () => {
    const stream = createStream(["done"]);
    const transformed = transformStream(stream, (d) => d);
    const chunks: Array<string | undefined> = [];
    for await (const chunk of transformed) {
      chunks.push(chunk.finishReason);
    }
    expect(chunks).toEqual(["stop"]);
  });
});

describe("forkStream", () => {
  it("delivers all chunks to all consumers", async () => {
    const stream = createStream(["a", "b", "c"]);
    const [s1, s2] = forkStream(stream, 2);

    const [r1, r2] = await Promise.all([
      collectStream(s1),
      collectStream(s2),
    ]);

    expect(r1.content).toBe("abc");
    expect(r2.content).toBe("abc");
  });

  it("works with a single fork", async () => {
    const stream = createStream(["hello"]);
    const [s1] = forkStream(stream, 1);
    const result = await collectStream(s1);
    expect(result.content).toBe("hello");
  });

  it("throws on count < 1", () => {
    const stream = createStream(["x"]);
    expect(() => forkStream(stream, 0)).toThrow("count must be >= 1");
  });

  it("supports three-way fork", async () => {
    const stream = createStream(["x", "y"]);
    const forks = forkStream(stream, 3);
    const results = await Promise.all(forks.map((f) => collectStream(f)));
    for (const r of results) {
      expect(r.content).toBe("xy");
    }
  });
});

describe("withTimeout", () => {
  it("passes through chunks when stream is fast enough", async () => {
    const stream = createStream(["a", "b"], { delayMs: 5 });
    const timed = withTimeout(stream, 500);
    const result = await collectStream(timed);
    expect(result.content).toBe("ab");
  });

  it("throws LLMError on timeout", async () => {
    const stream = createStream(["a", "b"], { delayMs: 200 });
    const timed = withTimeout(stream, 10);

    await expect(collectStream(timed)).rejects.toThrow(LLMError);
    await expect(
      collectStream(withTimeout(createStream(["a", "b"], { delayMs: 200 }), 10)),
    ).rejects.toThrow("timed out");
  });
});
