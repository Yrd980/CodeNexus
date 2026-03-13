import type {
  Plan,
  Subscription,
  SubscriptionStatus,
} from "./types.js";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  readonly from: SubscriptionStatus;
  readonly to: SubscriptionStatus;

  constructor(from: SubscriptionStatus, to: SubscriptionStatus) {
    super(
      `Invalid subscription transition: ${from} → ${to}`,
    );
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

// ─── State Machine ──────────────────────────────────────────────────────────

/**
 * Valid subscription status transitions.
 *
 * This is the single source of truth for which transitions are allowed.
 * Any attempt to move a subscription to a state not listed here for its
 * current state will throw `InvalidTransitionError`.
 */
const VALID_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trialing: ["active", "canceled", "unpaid"],
  active: ["past_due", "canceled"],
  past_due: ["active", "canceled", "unpaid"],
  unpaid: ["active", "canceled"],
  canceled: ["active"], // reactivation
};

/** Check whether a status transition is valid. */
export function isValidTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** Assert a transition is valid, or throw. */
export function assertValidTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

// ─── Subscription Operations ─────────────────────────────────────────────────

export interface CreateSubscriptionOptions {
  readonly id: string;
  readonly customerId: string;
  readonly plan: Plan;
  readonly trialDays?: number;
  readonly metadata?: Record<string, string>;
}

/** Create a new subscription, optionally with a trial period. */
export function createSubscriptionRecord(
  options: CreateSubscriptionOptions,
): Subscription {
  const now = new Date();
  const periodEnd = new Date(now);

  const hasTrialDays =
    options.trialDays !== undefined && options.trialDays > 0;

  if (hasTrialDays) {
    periodEnd.setDate(periodEnd.getDate() + options.trialDays);
  } else if (options.plan.interval === "monthly") {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }

  return {
    id: options.id,
    customerId: options.customerId,
    planId: options.plan.id,
    status: hasTrialDays ? "trialing" : "active",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    trialEnd: hasTrialDays ? periodEnd : undefined,
    metadata: options.metadata ?? {},
    createdAt: now,
  };
}

// ─── Proration ───────────────────────────────────────────────────────────────

export interface ProrationResult {
  /** Credit for unused time on the old plan (positive number). */
  readonly credit: number;
  /** Cost of the new plan for the remaining period. */
  readonly cost: number;
  /** Net amount: positive means customer pays, negative means refund. */
  readonly netAmount: number;
  /** Days remaining in the current billing period. */
  readonly daysRemaining: number;
  /** Total days in the current billing period. */
  readonly totalDays: number;
}

/**
 * Calculate proration when switching between plans mid-cycle.
 *
 * Uses day-based proration: the credit/cost is proportional to the
 * number of days remaining in the current billing period.
 */
export function calculateProration(
  subscription: Subscription,
  currentPlan: Plan,
  newPlan: Plan,
  now: Date = new Date(),
): ProrationResult {
  const periodStartMs = subscription.currentPeriodStart.getTime();
  const periodEndMs = subscription.currentPeriodEnd.getTime();
  const nowMs = now.getTime();

  const totalMs = periodEndMs - periodStartMs;
  const elapsedMs = nowMs - periodStartMs;
  const remainingMs = periodEndMs - nowMs;

  // Use days for cleaner proration math
  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.round(totalMs / msPerDay));
  const daysRemaining = Math.max(0, Math.round(remainingMs / msPerDay));
  // daysElapsed available for logging/debugging if needed
  void elapsedMs;

  // Credit = unused portion of old plan
  const dailyRateOld = currentPlan.amount / totalDays;
  const credit = Math.round(dailyRateOld * daysRemaining);

  // Cost = new plan for remaining period
  const dailyRateNew = newPlan.amount / totalDays;
  const cost = Math.round(dailyRateNew * daysRemaining);

  return {
    credit,
    cost,
    netAmount: cost - credit,
    daysRemaining,
    totalDays,
  };
}

// ─── Lifecycle Transitions ───────────────────────────────────────────────────

/** Cancel a subscription immediately or at period end. */
export function cancelSubscription(
  subscription: Subscription,
  immediate: boolean,
): Subscription {
  if (immediate) {
    assertValidTransition(subscription.status, "canceled");
    return {
      ...subscription,
      status: "canceled",
      cancelAtPeriodEnd: false,
    };
  }

  // Schedule cancellation at period end — status stays the same for now
  return {
    ...subscription,
    cancelAtPeriodEnd: true,
  };
}

/** Reactivate a canceled subscription (before the period actually ends). */
export function reactivateSubscription(
  subscription: Subscription,
): Subscription {
  // If it was scheduled for cancellation but not yet canceled
  if (subscription.cancelAtPeriodEnd && subscription.status !== "canceled") {
    return {
      ...subscription,
      cancelAtPeriodEnd: false,
    };
  }

  // If fully canceled, transition back to active
  assertValidTransition(subscription.status, "active");
  return {
    ...subscription,
    status: "active",
    cancelAtPeriodEnd: false,
  };
}

/** Transition a subscription to a new status (with validation). */
export function transitionSubscription(
  subscription: Subscription,
  newStatus: SubscriptionStatus,
): Subscription {
  assertValidTransition(subscription.status, newStatus);
  return {
    ...subscription,
    status: newStatus,
  };
}

/**
 * Apply a grace period for failed payments.
 *
 * Moves the subscription to `past_due` and extends the period end
 * by the specified number of grace days.
 */
export function applyGracePeriod(
  subscription: Subscription,
  graceDays: number,
): Subscription {
  assertValidTransition(subscription.status, "past_due");

  const extendedEnd = new Date(subscription.currentPeriodEnd);
  extendedEnd.setDate(extendedEnd.getDate() + graceDays);

  return {
    ...subscription,
    status: "past_due",
    currentPeriodEnd: extendedEnd,
  };
}

/** Upgrade or downgrade a subscription to a different plan. */
export function changePlan(
  subscription: Subscription,
  newPlan: Plan,
): Subscription {
  return {
    ...subscription,
    planId: newPlan.id,
  };
}
