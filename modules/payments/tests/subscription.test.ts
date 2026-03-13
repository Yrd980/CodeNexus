import { describe, it, expect } from "vitest";
import {
  createSubscriptionRecord,
  calculateProration,
  cancelSubscription,
  reactivateSubscription,
  transitionSubscription,
  applyGracePeriod,
  changePlan,
  isValidTransition,
  InvalidTransitionError,
} from "../src/subscription.js";
import type { Plan, Subscription } from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const basicPlan: Plan = {
  id: "plan_basic",
  name: "Basic",
  amount: 999,
  currency: "usd",
  interval: "monthly",
};

const proPlan: Plan = {
  id: "plan_pro",
  name: "Pro",
  amount: 2999,
  currency: "usd",
  interval: "monthly",
};

const yearlyPlan: Plan = {
  id: "plan_yearly",
  name: "Basic Yearly",
  amount: 9990,
  currency: "usd",
  interval: "yearly",
};

function makeSubscription(
  overrides: Partial<Subscription> = {},
): Subscription {
  const now = new Date("2026-03-01T00:00:00Z");
  const periodEnd = new Date("2026-04-01T00:00:00Z");
  return {
    id: "sub_test_001",
    customerId: "cus_test_001",
    planId: "plan_basic",
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    metadata: {},
    createdAt: now,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createSubscriptionRecord", () => {
  it("should create an active subscription without trial", () => {
    const sub = createSubscriptionRecord({
      id: "sub_001",
      customerId: "cus_001",
      plan: basicPlan,
    });

    expect(sub.id).toBe("sub_001");
    expect(sub.customerId).toBe("cus_001");
    expect(sub.planId).toBe("plan_basic");
    expect(sub.status).toBe("active");
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect(sub.trialEnd).toBeUndefined();
  });

  it("should create a trialing subscription with trial days", () => {
    const sub = createSubscriptionRecord({
      id: "sub_002",
      customerId: "cus_002",
      plan: basicPlan,
      trialDays: 14,
    });

    expect(sub.status).toBe("trialing");
    expect(sub.trialEnd).toBeDefined();

    // Period end should be 14 days from now
    const daysDiff =
      (sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime()) /
      (1000 * 60 * 60 * 24);
    expect(Math.round(daysDiff)).toBe(14);
  });

  it("should set correct period end for monthly plans", () => {
    const sub = createSubscriptionRecord({
      id: "sub_003",
      customerId: "cus_003",
      plan: basicPlan,
    });

    const startMonth = sub.currentPeriodStart.getMonth();
    const endMonth = sub.currentPeriodEnd.getMonth();
    // Should be approximately 1 month later
    expect((endMonth - startMonth + 12) % 12).toBe(1);
  });

  it("should set correct period end for yearly plans", () => {
    const sub = createSubscriptionRecord({
      id: "sub_004",
      customerId: "cus_004",
      plan: yearlyPlan,
    });

    const startYear = sub.currentPeriodStart.getFullYear();
    const endYear = sub.currentPeriodEnd.getFullYear();
    expect(endYear - startYear).toBe(1);
  });

  it("should include metadata", () => {
    const sub = createSubscriptionRecord({
      id: "sub_005",
      customerId: "cus_005",
      plan: basicPlan,
      metadata: { source: "signup" },
    });

    expect(sub.metadata).toEqual({ source: "signup" });
  });
});

describe("State Machine Transitions", () => {
  it("should allow active → past_due", () => {
    expect(isValidTransition("active", "past_due")).toBe(true);
  });

  it("should allow active → canceled", () => {
    expect(isValidTransition("active", "canceled")).toBe(true);
  });

  it("should allow past_due → active", () => {
    expect(isValidTransition("past_due", "active")).toBe(true);
  });

  it("should allow past_due → canceled", () => {
    expect(isValidTransition("past_due", "canceled")).toBe(true);
  });

  it("should allow canceled → active (reactivation)", () => {
    expect(isValidTransition("canceled", "active")).toBe(true);
  });

  it("should reject active → trialing", () => {
    expect(isValidTransition("active", "trialing")).toBe(false);
  });

  it("should reject canceled → past_due", () => {
    expect(isValidTransition("canceled", "past_due")).toBe(false);
  });

  it("should throw InvalidTransitionError for invalid transitions", () => {
    const sub = makeSubscription({ status: "canceled" });
    expect(() => transitionSubscription(sub, "past_due")).toThrow(
      InvalidTransitionError,
    );
  });

  it("should perform valid transition", () => {
    const sub = makeSubscription({ status: "active" });
    const updated = transitionSubscription(sub, "past_due");
    expect(updated.status).toBe("past_due");
  });
});

describe("cancelSubscription", () => {
  it("should cancel immediately", () => {
    const sub = makeSubscription({ status: "active" });
    const canceled = cancelSubscription(sub, true);

    expect(canceled.status).toBe("canceled");
    expect(canceled.cancelAtPeriodEnd).toBe(false);
  });

  it("should schedule cancellation at period end", () => {
    const sub = makeSubscription({ status: "active" });
    const canceled = cancelSubscription(sub, false);

    expect(canceled.status).toBe("active"); // still active until period end
    expect(canceled.cancelAtPeriodEnd).toBe(true);
  });

  it("should throw for invalid immediate cancellation", () => {
    const sub = makeSubscription({ status: "canceled" });
    // canceled → canceled is not in valid transitions
    expect(() => cancelSubscription(sub, true)).toThrow(
      InvalidTransitionError,
    );
  });
});

describe("reactivateSubscription", () => {
  it("should reactivate a subscription scheduled for cancellation", () => {
    const sub = makeSubscription({ cancelAtPeriodEnd: true });
    const reactivated = reactivateSubscription(sub);

    expect(reactivated.cancelAtPeriodEnd).toBe(false);
    expect(reactivated.status).toBe("active");
  });

  it("should reactivate a fully canceled subscription", () => {
    const sub = makeSubscription({ status: "canceled" });
    const reactivated = reactivateSubscription(sub);

    expect(reactivated.status).toBe("active");
    expect(reactivated.cancelAtPeriodEnd).toBe(false);
  });
});

describe("calculateProration", () => {
  it("should calculate upgrade proration correctly", () => {
    const sub = makeSubscription();
    // 15 days into a 31-day period
    const now = new Date("2026-03-16T00:00:00Z");
    const proration = calculateProration(sub, basicPlan, proPlan, now);

    // 16 days remaining out of 31
    expect(proration.daysRemaining).toBeGreaterThan(0);
    expect(proration.totalDays).toBeGreaterThan(0);
    // Upgrading costs more, so netAmount should be positive
    expect(proration.netAmount).toBeGreaterThan(0);
    // Credit should be less than cost for an upgrade
    expect(proration.credit).toBeLessThan(proration.cost);
  });

  it("should calculate downgrade proration correctly", () => {
    const sub = makeSubscription({ planId: "plan_pro" });
    const now = new Date("2026-03-16T00:00:00Z");
    const proration = calculateProration(sub, proPlan, basicPlan, now);

    // Downgrading gives credit, so netAmount should be negative
    expect(proration.netAmount).toBeLessThan(0);
    expect(proration.credit).toBeGreaterThan(proration.cost);
  });

  it("should return zero proration for same plan", () => {
    const sub = makeSubscription();
    const now = new Date("2026-03-16T00:00:00Z");
    const proration = calculateProration(sub, basicPlan, basicPlan, now);

    expect(proration.netAmount).toBe(0);
    expect(proration.credit).toBe(proration.cost);
  });
});

describe("applyGracePeriod", () => {
  it("should transition to past_due and extend period", () => {
    const sub = makeSubscription({ status: "active" });
    const graced = applyGracePeriod(sub, 7);

    expect(graced.status).toBe("past_due");
    // Period end should be 7 days later than original
    const diff =
      graced.currentPeriodEnd.getTime() -
      sub.currentPeriodEnd.getTime();
    const graceDays = diff / (1000 * 60 * 60 * 24);
    expect(graceDays).toBe(7);
  });

  it("should throw for invalid transition (e.g., canceled → past_due)", () => {
    const sub = makeSubscription({ status: "canceled" });
    expect(() => applyGracePeriod(sub, 7)).toThrow(InvalidTransitionError);
  });
});

describe("changePlan", () => {
  it("should update the plan ID", () => {
    const sub = makeSubscription({ planId: "plan_basic" });
    const updated = changePlan(sub, proPlan);

    expect(updated.planId).toBe("plan_pro");
    // Everything else stays the same
    expect(updated.id).toBe(sub.id);
    expect(updated.customerId).toBe(sub.customerId);
    expect(updated.status).toBe(sub.status);
  });
});
