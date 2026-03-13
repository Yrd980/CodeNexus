/**
 * Billing utility functions for a SaaS application.
 *
 * Design decisions:
 * - Billing logic is separate from UI — testable without rendering
 * - Webhook handlers are the source of truth for subscription state
 *   (never trust client-side billing state)
 * - Usage tracking is limit-based — check before allowing actions
 * - Plan comparison helpers make upgrade/downgrade flows simple
 *
 * Pattern: Pure functions for billing calculations + webhook handler pattern.
 */

import type {
  Plan,
  PlanLimits,
  Subscription,
  UsageRecord,
  WebhookEvent,
  WebhookEventType,
} from "../types/index.js";
import { getPlanById } from "../config/site.js";

// ─── Usage Tracking ─────────────────────────────────────────

/**
 * Check if a team has exceeded a specific usage limit.
 *
 * Why check limits proactively?
 * - Better UX: warn before they hit the wall
 * - Prevents over-usage that's hard to charge for retroactively
 * - Limit of -1 means unlimited (convention from plan definitions)
 */
export function isOverLimit(usage: UsageRecord): boolean {
  if (usage.limit === -1) return false; // unlimited
  return usage.value >= usage.limit;
}

/**
 * Calculate usage percentage (0-100).
 * Returns 0 for unlimited limits.
 */
export function usagePercentage(usage: UsageRecord): number {
  if (usage.limit === -1) return 0;
  if (usage.limit === 0) return 100;
  return Math.min(100, Math.round((usage.value / usage.limit) * 100));
}

/**
 * Get the applicable limits for a team based on their plan.
 * Returns null if the plan doesn't exist (defensive — should never happen).
 */
export function getLimitsForPlan(planId: string): PlanLimits | null {
  const plan = getPlanById(planId);
  return plan?.limits ?? null;
}

// ─── Subscription Helpers ───────────────────────────────────

/**
 * Check if a subscription is in a usable state.
 *
 * "Usable" means the team can access features. This includes:
 * - active: normal paid state
 * - trialing: free trial period
 *
 * NOT usable: past_due, canceled, unpaid, incomplete
 * Why exclude past_due? Teams on past_due still have a grace period
 * from Stripe, but we want to show a warning and limit new usage.
 */
export function isSubscriptionActive(subscription: Subscription): boolean {
  return (
    subscription.status === "active" || subscription.status === "trialing"
  );
}

/**
 * Check if a subscription is in a grace period (past_due but not canceled).
 * Use this to show a "please update payment" banner.
 */
export function isInGracePeriod(subscription: Subscription): boolean {
  return subscription.status === "past_due";
}

/**
 * Calculate days remaining in the current billing period.
 */
export function daysRemainingInPeriod(subscription: Subscription): number {
  const now = new Date();
  const end = subscription.currentPeriodEnd;
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Calculate days remaining in a trial.
 * Returns 0 if not trialing or trial has ended.
 */
export function trialDaysRemaining(subscription: Subscription): number {
  if (subscription.status !== "trialing" || !subscription.trialEnd) {
    return 0;
  }
  const now = new Date();
  const diffMs = subscription.trialEnd.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// ─── Plan Comparison ────────────────────────────────────────

/**
 * Determine if switching from one plan to another is an upgrade or downgrade.
 *
 * Simple heuristic: compare monthly prices.
 * In practice, you might also compare feature sets.
 */
export function planChangeDirection(
  currentPlan: Plan,
  targetPlan: Plan
): "upgrade" | "downgrade" | "same" {
  if (targetPlan.priceMonthly > currentPlan.priceMonthly) return "upgrade";
  if (targetPlan.priceMonthly < currentPlan.priceMonthly) return "downgrade";
  return "same";
}

/**
 * Calculate the prorated amount for a plan change.
 *
 * This is a simplified calculation — Stripe handles the real proration.
 * Use this for displaying an estimate to the user before they confirm.
 */
export function estimateProration(
  currentPlan: Plan,
  targetPlan: Plan,
  daysRemaining: number,
  totalDaysInPeriod: number
): number {
  if (totalDaysInPeriod <= 0) return 0;

  const currentDaily = currentPlan.priceMonthly / totalDaysInPeriod;
  const targetDaily = targetPlan.priceMonthly / totalDaysInPeriod;

  const credit = currentDaily * daysRemaining;
  const charge = targetDaily * daysRemaining;

  // Round to 2 decimal places
  return Math.round((charge - credit) * 100) / 100;
}

// ─── Webhook Processing ─────────────────────────────────────

/**
 * Webhook event handler type.
 * Each handler receives the event data and returns a processing result.
 */
export type WebhookHandler = (
  event: WebhookEvent
) => Promise<WebhookHandlerResult>;

export interface WebhookHandlerResult {
  processed: boolean;
  action?: string;
  error?: string;
}

/**
 * Registry of webhook handlers by event type.
 *
 * Why a registry pattern?
 * - Clean separation of concerns — each event type has its own handler
 * - Easy to add new event types without modifying a giant switch statement
 * - Testable — each handler can be tested independently
 */
export type WebhookHandlerRegistry = Partial<
  Record<WebhookEventType, WebhookHandler>
>;

/**
 * Process a webhook event using the handler registry.
 *
 * Pattern: Look up the handler, execute it, return the result.
 * Unknown event types are acknowledged but not processed.
 *
 * Why acknowledge unknown events?
 * - Stripe sends many event types — you don't need to handle all of them
 * - Returning an error for unknown events causes Stripe to retry unnecessarily
 */
export async function processWebhookEvent(
  event: WebhookEvent,
  handlers: WebhookHandlerRegistry
): Promise<WebhookHandlerResult> {
  const handler = handlers[event.type];

  if (!handler) {
    return {
      processed: false,
      action: `ignored_unhandled_event_type:${event.type}`,
    };
  }

  try {
    return await handler(event);
  } catch (err) {
    return {
      processed: false,
      error:
        err instanceof Error ? err.message : "Unknown webhook handler error",
    };
  }
}

/**
 * Create a default set of webhook handlers for common Stripe events.
 *
 * These are stubs — replace the callbacks with your actual business logic.
 * The pattern shows how to structure webhook processing.
 */
export interface WebhookCallbacks {
  onSubscriptionCreated: (data: Record<string, unknown>) => Promise<void>;
  onSubscriptionUpdated: (data: Record<string, unknown>) => Promise<void>;
  onSubscriptionDeleted: (data: Record<string, unknown>) => Promise<void>;
  onPaymentSucceeded: (data: Record<string, unknown>) => Promise<void>;
  onPaymentFailed: (data: Record<string, unknown>) => Promise<void>;
}

export function createWebhookHandlers(
  callbacks: WebhookCallbacks
): WebhookHandlerRegistry {
  return {
    "customer.subscription.created": async (event) => {
      await callbacks.onSubscriptionCreated(event.data);
      return { processed: true, action: "subscription_created" };
    },
    "customer.subscription.updated": async (event) => {
      await callbacks.onSubscriptionUpdated(event.data);
      return { processed: true, action: "subscription_updated" };
    },
    "customer.subscription.deleted": async (event) => {
      await callbacks.onSubscriptionDeleted(event.data);
      return { processed: true, action: "subscription_deleted" };
    },
    "invoice.payment_succeeded": async (event) => {
      await callbacks.onPaymentSucceeded(event.data);
      return { processed: true, action: "payment_succeeded" };
    },
    "invoice.payment_failed": async (event) => {
      await callbacks.onPaymentFailed(event.data);
      return { processed: true, action: "payment_failed" };
    },
  };
}
