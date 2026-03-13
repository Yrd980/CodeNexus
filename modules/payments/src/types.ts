// ─── Status Types ────────────────────────────────────────────────────────────

export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded"
  | "disputed";

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing"
  | "unpaid";

export type PlanInterval = "monthly" | "yearly";

// ─── Core Entities ───────────────────────────────────────────────────────────

export interface Plan {
  readonly id: string;
  readonly name: string;
  /** Amount in smallest currency unit (e.g. cents for USD) */
  readonly amount: number;
  readonly currency: string;
  readonly interval: PlanInterval;
}

export interface Charge {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly customerId: string;
  readonly description?: string;
  readonly metadata: Record<string, string>;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
}

export interface Refund {
  readonly id: string;
  readonly chargeId: string;
  readonly amount: number;
  readonly currency: string;
  readonly reason?: string;
  readonly createdAt: Date;
}

export interface Subscription {
  readonly id: string;
  readonly customerId: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly trialEnd?: Date;
  readonly metadata: Record<string, string>;
  readonly createdAt: Date;
}

// ─── Webhook Types ───────────────────────────────────────────────────────────

export type WebhookEventType =
  | "charge.succeeded"
  | "charge.failed"
  | "charge.refunded"
  | "charge.disputed"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.deleted"
  | "invoice.paid"
  | "invoice.payment_failed";

export interface WebhookEvent {
  readonly id: string;
  readonly type: WebhookEventType;
  readonly data: Record<string, unknown>;
  readonly signature: string;
  readonly timestamp: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

export interface PaymentConfig {
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly currency: string;
  readonly testMode: boolean;
}

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface CreateChargeParams {
  readonly amount: number;
  readonly currency?: string;
  readonly customerId: string;
  readonly description?: string;
  readonly metadata?: Record<string, string>;
  readonly idempotencyKey?: string;
}

export interface CreateSubscriptionParams {
  readonly customerId: string;
  readonly planId: string;
  readonly trialDays?: number;
  readonly metadata?: Record<string, string>;
}

export interface UpdateSubscriptionParams {
  readonly planId?: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly metadata?: Record<string, string>;
}

export interface RefundChargeParams {
  readonly chargeId: string;
  readonly amount?: number;
  readonly reason?: string;
}

/**
 * Payment provider abstraction.
 *
 * Implement this interface once per payment gateway (Stripe, Paddle, etc.).
 * The mock provider is included for testing; swap it for a real
 * implementation in production.
 */
export interface PaymentProvider {
  // ── Charges ──────────────────────────────────────────────────
  createCharge(params: CreateChargeParams): Promise<Charge>;
  getCharge(chargeId: string): Promise<Charge | null>;
  refundCharge(params: RefundChargeParams): Promise<Refund>;

  // ── Subscriptions ────────────────────────────────────────────
  createSubscription(params: CreateSubscriptionParams): Promise<Subscription>;
  getSubscription(subscriptionId: string): Promise<Subscription | null>;
  updateSubscription(
    subscriptionId: string,
    params: UpdateSubscriptionParams,
  ): Promise<Subscription>;
  cancelSubscription(
    subscriptionId: string,
    immediate: boolean,
  ): Promise<Subscription>;

  // ── Webhooks ─────────────────────────────────────────────────
  handleWebhook(payload: string, signature: string): Promise<WebhookEvent>;
}
