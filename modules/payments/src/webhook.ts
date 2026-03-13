import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent, WebhookEventType } from "./types.js";
import { IdempotencyStore } from "./idempotency.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WebhookHandlerOptions {
  /** Secret used for HMAC-SHA256 signature verification. */
  readonly secret: string;
  /**
   * Maximum allowed age for a webhook event in milliseconds.
   * Events older than this are rejected to prevent replay attacks.
   * Default: 5 minutes.
   */
  readonly toleranceMs?: number;
  /**
   * TTL for idempotency tracking of processed webhook IDs.
   * Default: 24 hours.
   */
  readonly idempotencyTtlMs?: number;
}

export type WebhookHandlerFn = (event: WebhookEvent) => Promise<void>;

export interface WebhookProcessor {
  /** Register a handler for a specific event type. */
  on(eventType: WebhookEventType, handler: WebhookHandlerFn): void;
  /** Verify, parse, and dispatch a webhook. Returns the parsed event. */
  process(payload: string, signature: string): Promise<WebhookEvent>;
  /** Check if a webhook event ID has already been processed. */
  isProcessed(eventId: string): boolean;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export class WebhookDuplicateError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(`Webhook event ${eventId} has already been processed`);
    this.name = "WebhookDuplicateError";
    this.eventId = eventId;
  }
}

// ─── Signature Helpers ───────────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for a webhook payload.
 *
 * The signature format is `ts=<timestamp>,v1=<hex-digest>` where the
 * signed content is `<timestamp>.<payload>`. This follows the Stripe
 * signature scheme which is the de-facto standard.
 */
export function computeWebhookSignature(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  const signedContent = `${timestamp}.${payload}`;
  const digest = createHmac("sha256", secret)
    .update(signedContent)
    .digest("hex");
  return `ts=${timestamp},v1=${digest}`;
}

/**
 * Verify a webhook signature.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  toleranceMs: number,
): { valid: boolean; timestamp: number } {
  // Parse signature: ts=<timestamp>,v1=<hex>
  const parts = new Map<string, string>();
  for (const part of signature.split(",")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);
    if (key && value) {
      parts.set(key, value);
    }
  }

  const tsStr = parts.get("ts");
  const v1 = parts.get("v1");

  if (!tsStr || !v1) {
    return { valid: false, timestamp: 0 };
  }

  const timestamp = parseInt(tsStr, 10);
  if (Number.isNaN(timestamp)) {
    return { valid: false, timestamp: 0 };
  }

  // Check freshness
  const age = Math.abs(Date.now() - timestamp);
  if (age > toleranceMs) {
    return { valid: false, timestamp };
  }

  // Compute expected signature
  const signedContent = `${timestamp}.${payload}`;
  const expectedDigest = createHmac("sha256", secret)
    .update(signedContent)
    .digest("hex");

  // Timing-safe comparison
  const expected = Buffer.from(expectedDigest, "utf8");
  const received = Buffer.from(v1, "utf8");

  if (expected.length !== received.length) {
    return { valid: false, timestamp };
  }

  const valid = timingSafeEqual(expected, received);
  return { valid, timestamp };
}

// ─── Webhook Processor ──────────────────────────────────────────────────────

/**
 * Create a webhook processor that verifies signatures, deduplicates,
 * and dispatches events to registered handlers.
 */
export function createWebhookProcessor(
  options: WebhookHandlerOptions,
): WebhookProcessor {
  const { secret, toleranceMs = 5 * 60 * 1000 } = options;
  const processedEvents = new IdempotencyStore<true>({
    ttlMs: options.idempotencyTtlMs ?? 24 * 60 * 60 * 1000,
  });
  const handlers = new Map<WebhookEventType, WebhookHandlerFn[]>();

  return {
    on(eventType: WebhookEventType, handler: WebhookHandlerFn): void {
      const existing = handlers.get(eventType) ?? [];
      existing.push(handler);
      handlers.set(eventType, existing);
    },

    isProcessed(eventId: string): boolean {
      return processedEvents.has(eventId);
    },

    async process(payload: string, signature: string): Promise<WebhookEvent> {
      // 1. Verify signature
      const verification = verifyWebhookSignature(
        payload,
        signature,
        secret,
        toleranceMs,
      );

      if (!verification.valid) {
        throw new WebhookVerificationError(
          "Invalid webhook signature or event too old",
        );
      }

      // 2. Parse payload
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        throw new WebhookVerificationError("Invalid JSON payload");
      }

      const event: WebhookEvent = {
        id: parsed["id"] as string,
        type: parsed["type"] as WebhookEventType,
        data: (parsed["data"] as Record<string, unknown>) ?? {},
        signature,
        timestamp: verification.timestamp,
      };

      // 3. Idempotency check
      if (processedEvents.has(event.id)) {
        throw new WebhookDuplicateError(event.id);
      }

      // 4. Dispatch to handlers
      const eventHandlers = handlers.get(event.type) ?? [];
      for (const handler of eventHandlers) {
        await handler(event);
      }

      // 5. Mark as processed (only after successful handling)
      processedEvents.set(event.id, true);

      return event;
    },
  };
}
