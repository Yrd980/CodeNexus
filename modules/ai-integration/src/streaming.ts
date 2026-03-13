/**
 * AI Integration — Streaming Utilities
 *
 * LLM responses are inherently streamed — the model generates token-by-token.
 * Exposing this as an AsyncIterable<StreamChunk> lets callers:
 *   1. Show partial results instantly (UX win)
 *   2. Cancel early if the response is off-track
 *   3. Pipe into downstream transforms without buffering the whole response
 *
 * Patterns here: collect, transform, fork, timeout, backpressure.
 */

import type { StreamChunk, FinishReason, TokenUsage } from "./types.js";
import { LLMError } from "./types.js";

// ---------------------------------------------------------------------------
// Collect — consume entire stream into a single string
// ---------------------------------------------------------------------------

/** Result of collecting a full stream. */
export interface CollectedStream {
  content: string;
  finishReason: FinishReason;
  usage?: Partial<TokenUsage>;
  chunks: number;
}

/**
 * Consume an entire stream and return the concatenated content.
 * Useful when you don't need progressive rendering.
 */
export async function collectStream(
  stream: AsyncIterable<StreamChunk>,
): Promise<CollectedStream> {
  let content = "";
  let finishReason: FinishReason = "unknown";
  let usage: Partial<TokenUsage> | undefined;
  let chunks = 0;

  for await (const chunk of stream) {
    content += chunk.delta;
    chunks++;
    if (chunk.finishReason) {
      finishReason = chunk.finishReason;
    }
    if (chunk.usage) {
      usage = chunk.usage;
    }
  }

  return { content, finishReason, usage, chunks };
}

// ---------------------------------------------------------------------------
// Transform — map over stream chunks
// ---------------------------------------------------------------------------

/**
 * Apply a transformation function to each chunk's delta.
 *
 * Example: strip markdown, uppercase, translate, etc.
 */
export async function* transformStream(
  stream: AsyncIterable<StreamChunk>,
  fn: (delta: string, index: number) => string,
): AsyncGenerator<StreamChunk> {
  let index = 0;
  for await (const chunk of stream) {
    yield {
      ...chunk,
      delta: fn(chunk.delta, index),
    };
    index++;
  }
}

// ---------------------------------------------------------------------------
// Fork — send one stream to multiple consumers
// ---------------------------------------------------------------------------

/**
 * Fork a stream into N independent async iterables.
 *
 * All consumers see every chunk.  The source is consumed once;
 * chunks are buffered per-consumer so each can read at its own pace.
 *
 * Typical use: pipe the same LLM stream to both "render to UI"
 * and "save to database" without double-requesting.
 */
export function forkStream(
  stream: AsyncIterable<StreamChunk>,
  count: number,
): AsyncIterable<StreamChunk>[] {
  if (count < 1) {
    throw new Error("forkStream: count must be >= 1");
  }

  // Per-consumer state
  interface ConsumerState {
    buffer: StreamChunk[];
    resolve: ((value: IteratorResult<StreamChunk>) => void) | null;
  }

  const consumers: ConsumerState[] = Array.from({ length: count }, () => ({
    buffer: [],
    resolve: null,
  }));

  let done = false;
  let started = false;

  // Start consuming the source stream in the background
  function startConsuming(): void {
    if (started) return;
    started = true;

    (async () => {
      try {
        for await (const chunk of stream) {
          for (const consumer of consumers) {
            if (consumer.resolve) {
              // Consumer is waiting — deliver immediately
              const resolve = consumer.resolve;
              consumer.resolve = null;
              resolve({ value: chunk, done: false });
            } else {
              // Consumer hasn't asked yet — buffer
              consumer.buffer.push(chunk);
            }
          }
        }
      } finally {
        done = true;
        // Signal all waiting consumers that we're done
        for (const consumer of consumers) {
          if (consumer.resolve) {
            const resolve = consumer.resolve;
            consumer.resolve = null;
            resolve({ value: undefined as unknown as StreamChunk, done: true });
          }
        }
      }
    })();
  }

  // Create an async iterable for each consumer
  return consumers.map((state) => ({
    [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
      startConsuming();
      return {
        next(): Promise<IteratorResult<StreamChunk>> {
          // If there's a buffered chunk, return it immediately
          if (state.buffer.length > 0) {
            return Promise.resolve({
              value: state.buffer.shift()!,
              done: false,
            });
          }
          // If the source is done, we're done
          if (done) {
            return Promise.resolve({
              value: undefined as unknown as StreamChunk,
              done: true,
            });
          }
          // Otherwise, wait for the next chunk
          return new Promise((resolve) => {
            state.resolve = resolve;
          });
        },
      };
    },
  }));
}

// ---------------------------------------------------------------------------
// Timeout — abort stalled streams
// ---------------------------------------------------------------------------

/**
 * Wrap a stream with a per-chunk timeout.
 *
 * If no new chunk arrives within `timeoutMs`, throws an LLMError
 * with code "timeout".  Protects against hung connections.
 */
export async function* withTimeout(
  stream: AsyncIterable<StreamChunk>,
  timeoutMs: number,
): AsyncGenerator<StreamChunk> {
  const iterator = stream[Symbol.asyncIterator]();

  while (true) {
    const result = await Promise.race([
      iterator.next(),
      rejectAfter(timeoutMs),
    ]);

    if (result.done) {
      return;
    }

    yield result.value;
  }
}

/** Helper: create a promise that rejects after `ms` milliseconds. */
function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(
        new LLMError(
          `Stream timed out: no chunk received within ${ms}ms`,
          "timeout",
          undefined,
          undefined,
          true, // retryable
        ),
      );
    }, ms);
  });
}

// ---------------------------------------------------------------------------
// Backpressure — rate-limit chunk delivery
// ---------------------------------------------------------------------------

/**
 * Throttle stream delivery to at most one chunk per `intervalMs`.
 *
 * Useful when rendering to a UI that can't keep up with the raw
 * token generation rate, or when writing to a slow downstream.
 */
export async function* withBackpressure(
  stream: AsyncIterable<StreamChunk>,
  intervalMs: number,
): AsyncGenerator<StreamChunk> {
  let lastEmit = 0;

  for await (const chunk of stream) {
    const now = Date.now();
    const elapsed = now - lastEmit;
    if (elapsed < intervalMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs - elapsed));
    }
    lastEmit = Date.now();
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// Create stream from array — useful for testing
// ---------------------------------------------------------------------------

/**
 * Turn an array of strings into an AsyncIterable<StreamChunk>.
 * Handy for testing streaming consumers without a real provider.
 */
export async function* createStream(
  deltas: string[],
  options?: { delayMs?: number },
): AsyncGenerator<StreamChunk> {
  for (let i = 0; i < deltas.length; i++) {
    const delayMs = options?.delayMs;
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const isLast = i === deltas.length - 1;
    yield {
      delta: deltas[i]!,
      finishReason: isLast ? "stop" : undefined,
    };
  }
}
