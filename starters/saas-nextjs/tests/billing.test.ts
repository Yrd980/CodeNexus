import { describe, it, expect, vi } from "vitest";
import {
  isOverLimit,
  usagePercentage,
  getLimitsForPlan,
  isSubscriptionActive,
  isInGracePeriod,
  daysRemainingInPeriod,
  trialDaysRemaining,
  planChangeDirection,
  estimateProration,
  processWebhookEvent,
  createWebhookHandlers,
} from "../src/lib/billing.js";
import type { Subscription, UsageRecord, WebhookEvent } from "../src/types/index.js";

// ─── Test Fixtures ──────────────────────────────────────────

function makeUsageRecord(overrides?: Partial<UsageRecord>): UsageRecord {
  return {
    teamId: "team-1",
    metric: "api_requests",
    value: 50,
    limit: 100,
    period: "2024-01",
    ...overrides,
  };
}

function makeSubscription(overrides?: Partial<Subscription>): Subscription {
  return {
    id: "sub-1",
    teamId: "team-1",
    planId: "pro",
    status: "active",
    interval: "month",
    currentPeriodStart: new Date("2024-01-01"),
    currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
    cancelAtPeriodEnd: false,
    trialEnd: null,
    ...overrides,
  };
}

// ─── Usage Tracking ─────────────────────────────────────────

describe("isOverLimit", () => {
  it("returns false when under limit", () => {
    expect(isOverLimit(makeUsageRecord({ value: 50, limit: 100 }))).toBe(false);
  });

  it("returns true when at limit", () => {
    expect(isOverLimit(makeUsageRecord({ value: 100, limit: 100 }))).toBe(true);
  });

  it("returns true when over limit", () => {
    expect(isOverLimit(makeUsageRecord({ value: 150, limit: 100 }))).toBe(true);
  });

  it("returns false for unlimited (-1)", () => {
    expect(isOverLimit(makeUsageRecord({ value: 999999, limit: -1 }))).toBe(
      false
    );
  });
});

describe("usagePercentage", () => {
  it("calculates percentage correctly", () => {
    expect(usagePercentage(makeUsageRecord({ value: 50, limit: 100 }))).toBe(
      50
    );
  });

  it("caps at 100%", () => {
    expect(usagePercentage(makeUsageRecord({ value: 200, limit: 100 }))).toBe(
      100
    );
  });

  it("returns 0 for unlimited", () => {
    expect(usagePercentage(makeUsageRecord({ value: 50, limit: -1 }))).toBe(0);
  });

  it("returns 100 for zero limit", () => {
    expect(usagePercentage(makeUsageRecord({ value: 0, limit: 0 }))).toBe(100);
  });
});

describe("getLimitsForPlan", () => {
  it("returns limits for pro plan", () => {
    const limits = getLimitsForPlan("pro");
    expect(limits).toBeDefined();
    expect(limits?.maxMembers).toBe(10);
  });

  it("returns limits for free plan", () => {
    const limits = getLimitsForPlan("free");
    expect(limits).toBeDefined();
    expect(limits?.maxMembers).toBe(2);
    expect(limits?.maxProjects).toBe(3);
  });

  it("returns null for non-existent plan", () => {
    expect(getLimitsForPlan("nonexistent")).toBeNull();
  });
});

// ─── Subscription Helpers ───────────────────────────────────

describe("isSubscriptionActive", () => {
  it("returns true for active subscription", () => {
    expect(isSubscriptionActive(makeSubscription({ status: "active" }))).toBe(
      true
    );
  });

  it("returns true for trialing subscription", () => {
    expect(
      isSubscriptionActive(makeSubscription({ status: "trialing" }))
    ).toBe(true);
  });

  it("returns false for past_due subscription", () => {
    expect(
      isSubscriptionActive(makeSubscription({ status: "past_due" }))
    ).toBe(false);
  });

  it("returns false for canceled subscription", () => {
    expect(
      isSubscriptionActive(makeSubscription({ status: "canceled" }))
    ).toBe(false);
  });
});

describe("isInGracePeriod", () => {
  it("returns true for past_due status", () => {
    expect(isInGracePeriod(makeSubscription({ status: "past_due" }))).toBe(
      true
    );
  });

  it("returns false for active status", () => {
    expect(isInGracePeriod(makeSubscription({ status: "active" }))).toBe(false);
  });
});

describe("daysRemainingInPeriod", () => {
  it("calculates days remaining", () => {
    const sub = makeSubscription({
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    const days = daysRemainingInPeriod(sub);
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });

  it("returns 0 when period has ended", () => {
    const sub = makeSubscription({
      currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    expect(daysRemainingInPeriod(sub)).toBe(0);
  });
});

describe("trialDaysRemaining", () => {
  it("returns days remaining for trialing subscription", () => {
    const sub = makeSubscription({
      status: "trialing",
      trialEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const days = trialDaysRemaining(sub);
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThanOrEqual(8);
  });

  it("returns 0 for non-trialing subscription", () => {
    expect(trialDaysRemaining(makeSubscription({ status: "active" }))).toBe(0);
  });

  it("returns 0 when trial has ended", () => {
    const sub = makeSubscription({
      status: "trialing",
      trialEnd: new Date(Date.now() - 1000),
    });
    expect(trialDaysRemaining(sub)).toBe(0);
  });
});

// ─── Plan Comparison ────────────────────────────────────────

describe("planChangeDirection", () => {
  it("detects upgrade", () => {
    const free = { priceMonthly: 0 } as Parameters<typeof planChangeDirection>[0];
    const pro = { priceMonthly: 29 } as Parameters<typeof planChangeDirection>[1];
    expect(planChangeDirection(free, pro)).toBe("upgrade");
  });

  it("detects downgrade", () => {
    const pro = { priceMonthly: 29 } as Parameters<typeof planChangeDirection>[0];
    const free = { priceMonthly: 0 } as Parameters<typeof planChangeDirection>[1];
    expect(planChangeDirection(pro, free)).toBe("downgrade");
  });

  it("detects same plan", () => {
    const pro = { priceMonthly: 29 } as Parameters<typeof planChangeDirection>[0];
    expect(planChangeDirection(pro, pro)).toBe("same");
  });
});

describe("estimateProration", () => {
  it("calculates prorated upgrade cost", () => {
    const free = { priceMonthly: 0 } as Parameters<typeof estimateProration>[0];
    const pro = { priceMonthly: 30 } as Parameters<typeof estimateProration>[1];
    // 15 days remaining out of 30, upgrading from $0 to $30
    // credit = 0 * 15/30 = 0, charge = 30/30 * 15 = 15
    expect(estimateProration(free, pro, 15, 30)).toBe(15);
  });

  it("calculates prorated downgrade credit", () => {
    const pro = { priceMonthly: 30 } as Parameters<typeof estimateProration>[0];
    const free = { priceMonthly: 0 } as Parameters<typeof estimateProration>[1];
    // credit = 30/30 * 15 = 15, charge = 0
    expect(estimateProration(pro, free, 15, 30)).toBe(-15);
  });

  it("returns 0 for same plan", () => {
    const pro = { priceMonthly: 30 } as Parameters<typeof estimateProration>[0];
    expect(estimateProration(pro, pro, 15, 30)).toBe(0);
  });

  it("returns 0 when no days in period", () => {
    const free = { priceMonthly: 0 } as Parameters<typeof estimateProration>[0];
    const pro = { priceMonthly: 30 } as Parameters<typeof estimateProration>[1];
    expect(estimateProration(free, pro, 15, 0)).toBe(0);
  });
});

// ─── Webhook Processing ─────────────────────────────────────

describe("processWebhookEvent", () => {
  it("processes known event types", async () => {
    const event: WebhookEvent = {
      id: "evt-1",
      type: "customer.subscription.created",
      data: { subscriptionId: "sub-1" },
      createdAt: new Date(),
    };

    const callbacks = {
      onSubscriptionCreated: vi.fn(),
      onSubscriptionUpdated: vi.fn(),
      onSubscriptionDeleted: vi.fn(),
      onPaymentSucceeded: vi.fn(),
      onPaymentFailed: vi.fn(),
    };

    const handlers = createWebhookHandlers(callbacks);
    const result = await processWebhookEvent(event, handlers);

    expect(result.processed).toBe(true);
    expect(result.action).toBe("subscription_created");
    expect(callbacks.onSubscriptionCreated).toHaveBeenCalledWith(event.data);
  });

  it("ignores unknown event types", async () => {
    const event: WebhookEvent = {
      id: "evt-2",
      type: "checkout.session.completed",
      data: {},
      createdAt: new Date(),
    };

    const result = await processWebhookEvent(event, {});
    expect(result.processed).toBe(false);
    expect(result.action).toContain("ignored");
  });

  it("handles handler errors gracefully", async () => {
    const event: WebhookEvent = {
      id: "evt-3",
      type: "invoice.payment_failed",
      data: {},
      createdAt: new Date(),
    };

    const handlers = createWebhookHandlers({
      onSubscriptionCreated: vi.fn(),
      onSubscriptionUpdated: vi.fn(),
      onSubscriptionDeleted: vi.fn(),
      onPaymentSucceeded: vi.fn(),
      onPaymentFailed: vi.fn().mockRejectedValue(new Error("DB error")),
    });

    const result = await processWebhookEvent(event, handlers);
    expect(result.processed).toBe(false);
    expect(result.error).toBe("DB error");
  });
});
