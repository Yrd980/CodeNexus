import { describe, it, expect, beforeEach } from "vitest";
import {
  computeWebhookSignature,
  verifyWebhookSignature,
  createWebhookProcessor,
  WebhookVerificationError,
  WebhookDuplicateError,
} from "../src/webhook.js";
import type { WebhookEvent } from "../src/types.js";

const SECRET = "whsec_test_secret_key_12345";

function makePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "evt_test_001",
    type: "charge.succeeded",
    data: { chargeId: "ch_123", amount: 2999 },
    ...overrides,
  });
}

function signPayload(payload: string, timestamp?: number): string {
  const ts = timestamp ?? Date.now();
  return computeWebhookSignature(payload, SECRET, ts);
}

describe("Webhook Signature", () => {
  it("should compute a valid signature", () => {
    const payload = makePayload();
    const ts = Date.now();
    const sig = computeWebhookSignature(payload, SECRET, ts);

    expect(sig).toMatch(/^ts=\d+,v1=[a-f0-9]{64}$/);
  });

  it("should verify a valid signature", () => {
    const payload = makePayload();
    const ts = Date.now();
    const sig = computeWebhookSignature(payload, SECRET, ts);

    const result = verifyWebhookSignature(payload, sig, SECRET, 5 * 60 * 1000);
    expect(result.valid).toBe(true);
    expect(result.timestamp).toBe(ts);
  });

  it("should reject a tampered payload", () => {
    const payload = makePayload();
    const sig = signPayload(payload);

    const tampered = payload.replace("2999", "1");
    const result = verifyWebhookSignature(tampered, sig, SECRET, 5 * 60 * 1000);
    expect(result.valid).toBe(false);
  });

  it("should reject an invalid signature format", () => {
    const payload = makePayload();
    const result = verifyWebhookSignature(payload, "invalid", SECRET, 5 * 60 * 1000);
    expect(result.valid).toBe(false);
  });

  it("should reject a signature with wrong secret", () => {
    const payload = makePayload();
    const sig = signPayload(payload);

    const result = verifyWebhookSignature(payload, sig, "wrong_secret", 5 * 60 * 1000);
    expect(result.valid).toBe(false);
  });

  it("should reject an expired signature", () => {
    const payload = makePayload();
    const oldTs = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const sig = computeWebhookSignature(payload, SECRET, oldTs);

    const result = verifyWebhookSignature(payload, sig, SECRET, 5 * 60 * 1000);
    expect(result.valid).toBe(false);
  });
});

describe("WebhookProcessor", () => {
  let processor: ReturnType<typeof createWebhookProcessor>;

  beforeEach(() => {
    processor = createWebhookProcessor({
      secret: SECRET,
      toleranceMs: 5 * 60 * 1000,
    });
  });

  it("should process a valid webhook event", async () => {
    const payload = makePayload();
    const sig = signPayload(payload);

    const event = await processor.process(payload, sig);
    expect(event.id).toBe("evt_test_001");
    expect(event.type).toBe("charge.succeeded");
    expect(event.data).toEqual({ chargeId: "ch_123", amount: 2999 });
  });

  it("should throw WebhookVerificationError for invalid signature", async () => {
    const payload = makePayload();
    await expect(
      processor.process(payload, "ts=0,v1=bad"),
    ).rejects.toThrow(WebhookVerificationError);
  });

  it("should dispatch to registered handlers", async () => {
    const events: WebhookEvent[] = [];
    processor.on("charge.succeeded", async (event) => {
      events.push(event);
    });

    const payload = makePayload();
    const sig = signPayload(payload);

    await processor.process(payload, sig);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("charge.succeeded");
  });

  it("should not dispatch to handlers for other event types", async () => {
    const events: WebhookEvent[] = [];
    processor.on("charge.failed", async (event) => {
      events.push(event);
    });

    const payload = makePayload({ type: "charge.succeeded" });
    const sig = signPayload(payload);

    await processor.process(payload, sig);
    expect(events).toHaveLength(0);
  });

  it("should support multiple handlers for the same event type", async () => {
    let count = 0;
    processor.on("charge.succeeded", async () => { count++; });
    processor.on("charge.succeeded", async () => { count++; });

    const payload = makePayload();
    const sig = signPayload(payload);

    await processor.process(payload, sig);
    expect(count).toBe(2);
  });

  it("should reject duplicate webhook events (idempotency)", async () => {
    const payload = makePayload({ id: "evt_dup_001" });
    const sig = signPayload(payload);

    await processor.process(payload, sig);

    // Second delivery of the same event
    const sig2 = signPayload(payload);
    await expect(
      processor.process(payload, sig2),
    ).rejects.toThrow(WebhookDuplicateError);
  });

  it("should track processed events", async () => {
    const payload = makePayload({ id: "evt_track_001" });
    const sig = signPayload(payload);

    expect(processor.isProcessed("evt_track_001")).toBe(false);
    await processor.process(payload, sig);
    expect(processor.isProcessed("evt_track_001")).toBe(true);
  });

  it("should throw WebhookVerificationError for invalid JSON", async () => {
    const payload = "not json";
    const ts = Date.now();
    const sig = computeWebhookSignature(payload, SECRET, ts);

    await expect(
      processor.process(payload, sig),
    ).rejects.toThrow(WebhookVerificationError);
  });
});
