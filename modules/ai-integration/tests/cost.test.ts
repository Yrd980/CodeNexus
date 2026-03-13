import { describe, it, expect, beforeEach, vi } from "vitest";
import { CostTracker, DEFAULT_PRICING } from "../src/cost.js";
import { LLMError } from "../src/types.js";
import type { TokenUsage } from "../src/types.js";

function makeUsage(prompt: number, completion: number): TokenUsage {
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
  };
}

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it("calculates cost for known model", () => {
    const usage = makeUsage(1000, 500);
    const cost = tracker.calculateCost("gpt-4o", usage);
    // gpt-4o: prompt=2.5e-6, completion=10e-6
    // 1000 * 2.5e-6 + 500 * 10e-6 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it("returns 0 cost for unknown model", () => {
    const usage = makeUsage(100, 50);
    const cost = tracker.calculateCost("unknown-model", usage);
    expect(cost).toBe(0);
  });

  it("records usage and tracks total cost", () => {
    const usage = makeUsage(1000, 500);
    tracker.record("gpt-4o", usage);
    tracker.record("gpt-4o", usage);

    expect(tracker.getTotalCost()).toBeCloseTo(0.015, 6);
    expect(tracker.getRecords()).toHaveLength(2);
  });

  it("tracks total tokens", () => {
    tracker.record("gpt-4o", makeUsage(100, 50));
    tracker.record("gpt-4o", makeUsage(200, 100));

    const totals = tracker.getTotalTokens();
    expect(totals.promptTokens).toBe(300);
    expect(totals.completionTokens).toBe(150);
    expect(totals.totalTokens).toBe(450);
  });

  it("breaks down cost by model", () => {
    tracker.record("gpt-4o", makeUsage(1000, 500));
    tracker.record("gpt-4o-mini", makeUsage(1000, 500));

    const byModel = tracker.getCostByModel();
    expect(byModel.size).toBe(2);
    expect(byModel.get("gpt-4o")!.requests).toBe(1);
    expect(byModel.get("gpt-4o-mini")!.requests).toBe(1);
    // gpt-4o should be more expensive than gpt-4o-mini
    expect(byModel.get("gpt-4o")!.cost).toBeGreaterThan(byModel.get("gpt-4o-mini")!.cost);
  });

  it("breaks down cost by tag", () => {
    tracker.record("gpt-4o", makeUsage(100, 50), "search");
    tracker.record("gpt-4o", makeUsage(100, 50), "search");
    tracker.record("gpt-4o", makeUsage(100, 50), "chat");

    const byTag = tracker.getCostByTag();
    expect(byTag.get("search")!.requests).toBe(2);
    expect(byTag.get("chat")!.requests).toBe(1);
  });

  it("uses '(untagged)' for records without tag", () => {
    tracker.record("gpt-4o", makeUsage(100, 50));
    const byTag = tracker.getCostByTag();
    expect(byTag.has("(untagged)")).toBe(true);
  });

  it("returns record cost from record()", () => {
    const cost = tracker.record("gpt-4o", makeUsage(1000, 500));
    expect(cost).toBeCloseTo(0.0075, 6);
  });
});

describe("CostTracker — budget limits", () => {
  it("fires alert at threshold", () => {
    const thresholdsCrossed: number[] = [];
    const tracker = new CostTracker({
      budgetUsd: 0.01,
      alertThresholds: [50, 100],
      onAlert: (cost, _budget, percent) => {
        thresholdsCrossed.push(Math.round(percent));
      },
    });

    // This should be ~0.0075 → 75% of 0.01 → crosses the 50% threshold
    tracker.record("gpt-4o", makeUsage(1000, 500));
    // Alert fires once — the actual percent (75) is above the 50% threshold
    expect(thresholdsCrossed.length).toBeGreaterThanOrEqual(1);
    expect(thresholdsCrossed[0]).toBeGreaterThanOrEqual(50);
  });

  it("fires each threshold only once", () => {
    const alertCount: Record<number, number> = {};
    const tracker = new CostTracker({
      budgetUsd: 0.02,
      alertThresholds: [50],
      onAlert: (_cost, _budget, _percent) => {
        alertCount[50] = (alertCount[50] ?? 0) + 1;
      },
    });

    tracker.record("gpt-4o", makeUsage(1000, 500)); // ~0.0075 = 37.5%
    tracker.record("gpt-4o", makeUsage(1000, 500)); // ~0.015 = 75% → fires 50%

    expect(alertCount[50]).toBe(1);

    // Another record should not fire 50% again
    try {
      tracker.record("gpt-4o", makeUsage(1000, 500));
    } catch {
      // may exceed budget, that's fine
    }
    expect(alertCount[50]).toBe(1);
  });

  it("throws when budget is exceeded", () => {
    const tracker = new CostTracker({ budgetUsd: 0.001 });

    // gpt-4o: 1000 prompt + 500 completion = $0.0075
    expect(() => {
      tracker.record("gpt-4o", makeUsage(1000, 500));
    }).toThrow(LLMError);
  });

  it("reports remaining budget", () => {
    const tracker = new CostTracker({ budgetUsd: 1.0 });
    tracker.record("gpt-4o", makeUsage(1000, 500));
    const remaining = tracker.getRemainingBudget();
    expect(remaining).toBeCloseTo(1.0 - 0.0075, 4);
  });

  it("returns Infinity when no budget is set", () => {
    const tracker = new CostTracker();
    expect(tracker.getRemainingBudget()).toBe(Infinity);
  });

  it("resets all tracked data", () => {
    const tracker = new CostTracker({ budgetUsd: 1.0 });
    tracker.record("gpt-4o", makeUsage(1000, 500));
    tracker.reset();
    expect(tracker.getTotalCost()).toBe(0);
    expect(tracker.getRecords()).toHaveLength(0);
  });
});

describe("CostTracker — custom pricing", () => {
  it("accepts custom pricing table", () => {
    const tracker = new CostTracker({
      pricing: [
        { model: "my-model", promptTokenCost: 1e-6, completionTokenCost: 2e-6 },
      ],
    });

    const cost = tracker.calculateCost("my-model", makeUsage(1000, 500));
    // 1000 * 1e-6 + 500 * 2e-6 = 0.001 + 0.001 = 0.002
    expect(cost).toBeCloseTo(0.002, 6);
  });

  it("custom pricing overrides defaults for same model", () => {
    const tracker = new CostTracker({
      pricing: [
        { model: "gpt-4o", promptTokenCost: 0, completionTokenCost: 0 },
      ],
    });

    const cost = tracker.calculateCost("gpt-4o", makeUsage(1000, 500));
    expect(cost).toBe(0);
  });
});

describe("DEFAULT_PRICING", () => {
  it("includes major models", () => {
    const models = DEFAULT_PRICING.map((p) => p.model);
    expect(models).toContain("gpt-4o");
    expect(models).toContain("gpt-4o-mini");
    expect(models).toContain("claude-sonnet-4-20250514");
  });
});
