import { randomUUID } from "node:crypto";
import type {
  Charge,
  CreateChargeParams,
  CreateSubscriptionParams,
  PaymentConfig,
  PaymentProvider,
  Refund,
  RefundChargeParams,
  Subscription,
  UpdateSubscriptionParams,
  WebhookEvent,
  WebhookEventType,
} from "./types.js";
import { IdempotencyStore } from "./idempotency.js";
import {
  createSubscriptionRecord,
  transitionSubscription,
  cancelSubscription as cancelSub,
  changePlan,
} from "./subscription.js";
import { verifyWebhookSignature } from "./webhook.js";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class PaymentError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

export class ChargeNotFoundError extends PaymentError {
  constructor(chargeId: string) {
    super(`Charge not found: ${chargeId}`, "charge_not_found");
  }
}

export class SubscriptionNotFoundError extends PaymentError {
  constructor(subscriptionId: string) {
    super(
      `Subscription not found: ${subscriptionId}`,
      "subscription_not_found",
    );
  }
}

// ─── Mock Provider ──────────────────────────────────────────────────────────

/**
 * In-memory mock payment provider for testing and development.
 *
 * Simulates all payment flows without hitting any external API.
 * Use this in tests and local development; swap for a real provider
 * (Stripe, Paddle, etc.) in production.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly charges = new Map<string, Charge>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly refunds = new Map<string, Refund>();
  private readonly plans = new Map<string, { id: string; name: string; amount: number; currency: string; interval: "monthly" | "yearly" }>();
  private readonly chargeIdempotency = new IdempotencyStore<Charge>();
  private readonly config: PaymentConfig;

  constructor(config: PaymentConfig) {
    this.config = config;

    // Seed some default plans
    this.addPlan({ id: "plan_basic", name: "Basic", amount: 999, currency: config.currency, interval: "monthly" });
    this.addPlan({ id: "plan_pro", name: "Pro", amount: 2999, currency: config.currency, interval: "monthly" });
    this.addPlan({ id: "plan_enterprise", name: "Enterprise", amount: 9999, currency: config.currency, interval: "monthly" });
    this.addPlan({ id: "plan_basic_yearly", name: "Basic Yearly", amount: 9990, currency: config.currency, interval: "yearly" });
  }

  /** Add or update a plan in the mock store. */
  addPlan(plan: { id: string; name: string; amount: number; currency: string; interval: "monthly" | "yearly" }): void {
    this.plans.set(plan.id, plan);
  }

  // ── Charges ────────────────────────────────────────────────────

  async createCharge(params: CreateChargeParams): Promise<Charge> {
    // Check idempotency
    if (params.idempotencyKey) {
      const existing = this.chargeIdempotency.get(params.idempotencyKey);
      if (existing) return existing;
    }

    const charge: Charge = {
      id: `ch_${randomUUID().slice(0, 16)}`,
      amount: params.amount,
      currency: params.currency ?? this.config.currency,
      status: "succeeded",
      customerId: params.customerId,
      description: params.description,
      metadata: params.metadata ?? {},
      idempotencyKey: params.idempotencyKey,
      createdAt: new Date(),
    };

    this.charges.set(charge.id, charge);

    if (params.idempotencyKey) {
      this.chargeIdempotency.set(params.idempotencyKey, charge);
    }

    return charge;
  }

  async getCharge(chargeId: string): Promise<Charge | null> {
    return this.charges.get(chargeId) ?? null;
  }

  async refundCharge(params: RefundChargeParams): Promise<Refund> {
    const charge = this.charges.get(params.chargeId);
    if (!charge) throw new ChargeNotFoundError(params.chargeId);

    const refundAmount = params.amount ?? charge.amount;
    const refund: Refund = {
      id: `re_${randomUUID().slice(0, 16)}`,
      chargeId: charge.id,
      amount: refundAmount,
      currency: charge.currency,
      reason: params.reason,
      createdAt: new Date(),
    };

    // Update charge status
    const updatedCharge: Charge = { ...charge, status: "refunded" };
    this.charges.set(charge.id, updatedCharge);
    this.refunds.set(refund.id, refund);

    return refund;
  }

  // ── Subscriptions ──────────────────────────────────────────────

  async createSubscription(
    params: CreateSubscriptionParams,
  ): Promise<Subscription> {
    const plan = this.plans.get(params.planId);
    if (!plan) {
      throw new PaymentError(
        `Plan not found: ${params.planId}`,
        "plan_not_found",
      );
    }

    const subscription = createSubscriptionRecord({
      id: `sub_${randomUUID().slice(0, 16)}`,
      customerId: params.customerId,
      plan,
      trialDays: params.trialDays,
      metadata: params.metadata,
    });

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  async getSubscription(subscriptionId: string): Promise<Subscription | null> {
    return this.subscriptions.get(subscriptionId) ?? null;
  }

  async updateSubscription(
    subscriptionId: string,
    params: UpdateSubscriptionParams,
  ): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new SubscriptionNotFoundError(subscriptionId);

    let updated = subscription;

    if (params.planId && params.planId !== subscription.planId) {
      const newPlan = this.plans.get(params.planId);
      if (!newPlan) {
        throw new PaymentError(
          `Plan not found: ${params.planId}`,
          "plan_not_found",
        );
      }
      updated = changePlan(updated, newPlan);
    }

    if (params.cancelAtPeriodEnd !== undefined) {
      updated = { ...updated, cancelAtPeriodEnd: params.cancelAtPeriodEnd };
    }

    if (params.metadata) {
      updated = {
        ...updated,
        metadata: { ...updated.metadata, ...params.metadata },
      };
    }

    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }

  async cancelSubscription(
    subscriptionId: string,
    immediate: boolean,
  ): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new SubscriptionNotFoundError(subscriptionId);

    const updated = cancelSub(subscription, immediate);
    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }

  // ── Webhooks ───────────────────────────────────────────────────

  async handleWebhook(
    payload: string,
    signature: string,
  ): Promise<WebhookEvent> {
    const verification = verifyWebhookSignature(
      payload,
      signature,
      this.config.webhookSecret,
      5 * 60 * 1000,
    );

    if (!verification.valid) {
      throw new PaymentError("Invalid webhook signature", "webhook_invalid");
    }

    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      id: parsed["id"] as string,
      type: parsed["type"] as WebhookEventType,
      data: (parsed["data"] as Record<string, unknown>) ?? {},
      signature,
      timestamp: verification.timestamp,
    };
  }

  // ── Test Helpers ───────────────────────────────────────────────

  /** Simulate a failed charge (for testing error flows). */
  async simulateFailedCharge(params: CreateChargeParams): Promise<Charge> {
    const charge: Charge = {
      id: `ch_${randomUUID().slice(0, 16)}`,
      amount: params.amount,
      currency: params.currency ?? this.config.currency,
      status: "failed",
      customerId: params.customerId,
      description: params.description,
      metadata: params.metadata ?? {},
      idempotencyKey: params.idempotencyKey,
      createdAt: new Date(),
    };

    this.charges.set(charge.id, charge);
    return charge;
  }

  /** Simulate a subscription payment failure and transition to past_due. */
  async simulatePaymentFailure(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new SubscriptionNotFoundError(subscriptionId);

    const updated = transitionSubscription(subscription, "past_due");
    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a payment provider instance.
 *
 * In this reference implementation only the mock provider is available.
 * In production code, add cases for "stripe", "paddle", etc.
 */
export function createPaymentProvider(config: PaymentConfig): PaymentProvider {
  // In a real project you would switch on a `provider` field in config.
  // For this pattern module we always return the mock.
  return new MockPaymentProvider(config);
}
