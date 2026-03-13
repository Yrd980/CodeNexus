import { describe, it, expect, beforeEach } from "vitest";
import {
  MockPaymentProvider,
  ChargeNotFoundError,
  SubscriptionNotFoundError,
  PaymentError,
  createPaymentProvider,
} from "../src/provider.js";
import { computeWebhookSignature } from "../src/webhook.js";
import type { PaymentConfig } from "../src/types.js";

const TEST_CONFIG: PaymentConfig = {
  apiKey: "sk_test_12345",
  webhookSecret: "whsec_test_secret",
  currency: "usd",
  testMode: true,
};

describe("MockPaymentProvider", () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider(TEST_CONFIG);
  });

  // ── Charges ──────────────────────────────────────────────────

  describe("Charges", () => {
    it("should create a charge", async () => {
      const charge = await provider.createCharge({
        amount: 2999,
        customerId: "cus_001",
        description: "Test charge",
      });

      expect(charge.id).toMatch(/^ch_/);
      expect(charge.amount).toBe(2999);
      expect(charge.currency).toBe("usd");
      expect(charge.status).toBe("succeeded");
      expect(charge.customerId).toBe("cus_001");
    });

    it("should get a charge by ID", async () => {
      const created = await provider.createCharge({
        amount: 1000,
        customerId: "cus_002",
      });

      const fetched = await provider.getCharge(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    it("should return null for nonexistent charge", async () => {
      const result = await provider.getCharge("ch_nonexistent");
      expect(result).toBeNull();
    });

    it("should support idempotent charges", async () => {
      const key = "idem_test_001";

      const charge1 = await provider.createCharge({
        amount: 5000,
        customerId: "cus_003",
        idempotencyKey: key,
      });

      const charge2 = await provider.createCharge({
        amount: 5000,
        customerId: "cus_003",
        idempotencyKey: key,
      });

      // Same charge returned
      expect(charge1.id).toBe(charge2.id);
    });

    it("should create distinct charges without idempotency key", async () => {
      const charge1 = await provider.createCharge({
        amount: 100,
        customerId: "cus_004",
      });

      const charge2 = await provider.createCharge({
        amount: 100,
        customerId: "cus_004",
      });

      expect(charge1.id).not.toBe(charge2.id);
    });

    it("should use custom currency when specified", async () => {
      const charge = await provider.createCharge({
        amount: 1000,
        currency: "eur",
        customerId: "cus_005",
      });

      expect(charge.currency).toBe("eur");
    });

    it("should include metadata", async () => {
      const charge = await provider.createCharge({
        amount: 1000,
        customerId: "cus_006",
        metadata: { orderId: "ord_123" },
      });

      expect(charge.metadata).toEqual({ orderId: "ord_123" });
    });
  });

  // ── Refunds ────────────────────────────────────────────────────

  describe("Refunds", () => {
    it("should refund a charge fully", async () => {
      const charge = await provider.createCharge({
        amount: 2999,
        customerId: "cus_010",
      });

      const refund = await provider.refundCharge({
        chargeId: charge.id,
      });

      expect(refund.id).toMatch(/^re_/);
      expect(refund.chargeId).toBe(charge.id);
      expect(refund.amount).toBe(2999);

      // Charge status should be updated
      const updated = await provider.getCharge(charge.id);
      expect(updated!.status).toBe("refunded");
    });

    it("should refund a charge partially", async () => {
      const charge = await provider.createCharge({
        amount: 2999,
        customerId: "cus_011",
      });

      const refund = await provider.refundCharge({
        chargeId: charge.id,
        amount: 1000,
        reason: "Customer request",
      });

      expect(refund.amount).toBe(1000);
      expect(refund.reason).toBe("Customer request");
    });

    it("should throw ChargeNotFoundError for nonexistent charge", async () => {
      await expect(
        provider.refundCharge({ chargeId: "ch_nonexistent" }),
      ).rejects.toThrow(ChargeNotFoundError);
    });
  });

  // ── Subscriptions ──────────────────────────────────────────────

  describe("Subscriptions", () => {
    it("should create a subscription", async () => {
      const sub = await provider.createSubscription({
        customerId: "cus_020",
        planId: "plan_basic",
      });

      expect(sub.id).toMatch(/^sub_/);
      expect(sub.customerId).toBe("cus_020");
      expect(sub.planId).toBe("plan_basic");
      expect(sub.status).toBe("active");
    });

    it("should create a subscription with trial", async () => {
      const sub = await provider.createSubscription({
        customerId: "cus_021",
        planId: "plan_pro",
        trialDays: 14,
      });

      expect(sub.status).toBe("trialing");
      expect(sub.trialEnd).toBeDefined();
    });

    it("should throw for nonexistent plan", async () => {
      await expect(
        provider.createSubscription({
          customerId: "cus_022",
          planId: "plan_nonexistent",
        }),
      ).rejects.toThrow(PaymentError);
    });

    it("should get a subscription by ID", async () => {
      const created = await provider.createSubscription({
        customerId: "cus_023",
        planId: "plan_basic",
      });

      const fetched = await provider.getSubscription(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    it("should return null for nonexistent subscription", async () => {
      const result = await provider.getSubscription("sub_nonexistent");
      expect(result).toBeNull();
    });

    it("should update a subscription plan", async () => {
      const sub = await provider.createSubscription({
        customerId: "cus_024",
        planId: "plan_basic",
      });

      const updated = await provider.updateSubscription(sub.id, {
        planId: "plan_pro",
      });

      expect(updated.planId).toBe("plan_pro");
    });

    it("should update subscription metadata", async () => {
      const sub = await provider.createSubscription({
        customerId: "cus_025",
        planId: "plan_basic",
      });

      const updated = await provider.updateSubscription(sub.id, {
        metadata: { tier: "pro" },
      });

      expect(updated.metadata).toEqual({ tier: "pro" });
    });

    it("should cancel a subscription immediately", async () => {
      const sub = await provider.createSubscription({
        customerId: "cus_026",
        planId: "plan_basic",
      });

      const canceled = await provider.cancelSubscription(sub.id, true);
      expect(canceled.status).toBe("canceled");
    });

    it("should cancel a subscription at period end", async () => {
      const sub = await provider.createSubscription({
        customerId: "cus_027",
        planId: "plan_basic",
      });

      const canceled = await provider.cancelSubscription(sub.id, false);
      expect(canceled.status).toBe("active");
      expect(canceled.cancelAtPeriodEnd).toBe(true);
    });

    it("should throw SubscriptionNotFoundError for update on nonexistent", async () => {
      await expect(
        provider.updateSubscription("sub_nonexistent", { planId: "plan_pro" }),
      ).rejects.toThrow(SubscriptionNotFoundError);
    });

    it("should throw SubscriptionNotFoundError for cancel on nonexistent", async () => {
      await expect(
        provider.cancelSubscription("sub_nonexistent", true),
      ).rejects.toThrow(SubscriptionNotFoundError);
    });
  });

  // ── Test Helpers ───────────────────────────────────────────────

  describe("Test Helpers", () => {
    it("should simulate a failed charge", async () => {
      const charge = await provider.simulateFailedCharge({
        amount: 1000,
        customerId: "cus_030",
      });

      expect(charge.status).toBe("failed");
    });

    it("should simulate a payment failure on subscription", async () => {
      const sub = await provider.createSubscription({
        customerId: "cus_031",
        planId: "plan_basic",
      });

      const failed = await provider.simulatePaymentFailure(sub.id);
      expect(failed.status).toBe("past_due");
    });
  });

  // ── Webhooks ───────────────────────────────────────────────────

  describe("Webhook handling", () => {
    it("should verify and parse a valid webhook", async () => {
      const payload = JSON.stringify({
        id: "evt_001",
        type: "charge.succeeded",
        data: { amount: 2999 },
      });
      const ts = Date.now();
      const sig = computeWebhookSignature(payload, TEST_CONFIG.webhookSecret, ts);

      const event = await provider.handleWebhook(payload, sig);
      expect(event.id).toBe("evt_001");
      expect(event.type).toBe("charge.succeeded");
    });

    it("should reject invalid webhook signature", async () => {
      const payload = JSON.stringify({ id: "evt_002", type: "charge.failed" });
      await expect(
        provider.handleWebhook(payload, "ts=0,v1=invalid"),
      ).rejects.toThrow(PaymentError);
    });
  });
});

describe("createPaymentProvider factory", () => {
  it("should create a provider instance", () => {
    const provider = createPaymentProvider(TEST_CONFIG);
    expect(provider).toBeDefined();
    expect(typeof provider.createCharge).toBe("function");
    expect(typeof provider.createSubscription).toBe("function");
    expect(typeof provider.handleWebhook).toBe("function");
  });
});
