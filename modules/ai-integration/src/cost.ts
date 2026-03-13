/**
 * AI Integration — Cost Tracking
 *
 * "Why is our OpenAI bill $50k?" is a real startup question.
 * You need to know:
 *   - Which feature/endpoint is burning tokens
 *   - How much each request costs
 *   - When you're approaching budget limits
 *
 * This module tracks token usage, calculates costs, and enforces
 * budget limits.  It's in-memory by default — persist to your DB
 * of choice for production dashboards.
 */

import type { TokenUsage } from "./types.js";
import { LLMError } from "./types.js";

// ---------------------------------------------------------------------------
// Pricing table
// ---------------------------------------------------------------------------

/** Cost per token for a specific model. */
export interface ModelPricing {
  /** Model identifier (must match what comes back in ChatResponse.model). */
  model: string;
  /** Cost per prompt token in USD. */
  promptTokenCost: number;
  /** Cost per completion token in USD. */
  completionTokenCost: number;
}

/**
 * Default pricing as of early 2026.  Override with your own table.
 * Prices are per token, not per 1K tokens (easier math).
 */
export const DEFAULT_PRICING: ModelPricing[] = [
  // OpenAI
  { model: "gpt-4o", promptTokenCost: 2.5e-6, completionTokenCost: 10e-6 },
  { model: "gpt-4o-mini", promptTokenCost: 0.15e-6, completionTokenCost: 0.6e-6 },
  { model: "gpt-4-turbo", promptTokenCost: 10e-6, completionTokenCost: 30e-6 },
  { model: "o1", promptTokenCost: 15e-6, completionTokenCost: 60e-6 },
  // Anthropic
  { model: "claude-sonnet-4-20250514", promptTokenCost: 3e-6, completionTokenCost: 15e-6 },
  { model: "claude-opus-4-20250514", promptTokenCost: 15e-6, completionTokenCost: 75e-6 },
  { model: "claude-haiku-3-20250414", promptTokenCost: 0.25e-6, completionTokenCost: 1.25e-6 },
];

// ---------------------------------------------------------------------------
// Usage record
// ---------------------------------------------------------------------------

/** A single usage event. */
export interface UsageRecord {
  timestamp: number;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  /** Optional tag for grouping (e.g. feature name, endpoint). */
  tag?: string;
}

// ---------------------------------------------------------------------------
// Cost tracker
// ---------------------------------------------------------------------------

/** Budget alert callback. */
export type BudgetAlertFn = (currentCost: number, budgetUsd: number, percent: number) => void;

/** Options for the cost tracker. */
export interface CostTrackerOptions {
  /** Custom pricing table (merged with defaults). */
  pricing?: ModelPricing[];
  /** Monthly budget in USD. Set to 0 for no limit. */
  budgetUsd?: number;
  /** Alert thresholds as percentages (e.g. [50, 80, 100]). */
  alertThresholds?: number[];
  /** Callback when a threshold is crossed. */
  onAlert?: BudgetAlertFn;
}

/**
 * Tracks token usage and costs across all LLM calls.
 *
 * Usage:
 * ```ts
 * const tracker = new CostTracker({ budgetUsd: 100 });
 * // After each LLM call:
 * tracker.record("gpt-4o", response.usage);
 * // Check totals:
 * console.log(tracker.getTotalCost());
 * ```
 */
export class CostTracker {
  private readonly records: UsageRecord[] = [];
  private readonly pricingMap: Map<string, ModelPricing>;
  private readonly budgetUsd: number;
  private readonly alertThresholds: number[];
  private readonly onAlert?: BudgetAlertFn;
  private readonly alertedThresholds = new Set<number>();

  constructor(options: CostTrackerOptions = {}) {
    // Merge custom pricing with defaults (custom takes precedence)
    const allPricing = [...DEFAULT_PRICING, ...(options.pricing ?? [])];
    this.pricingMap = new Map(allPricing.map((p) => [p.model, p]));

    this.budgetUsd = options.budgetUsd ?? 0;
    this.alertThresholds = options.alertThresholds ?? [50, 80, 100];
    this.onAlert = options.onAlert;
  }

  /**
   * Record a usage event.
   *
   * @param model - Model identifier (must match pricing table).
   * @param usage - Token usage from the ChatResponse.
   * @param tag  - Optional grouping tag.
   * @returns The cost in USD for this request.
   * @throws LLMError if budget is exceeded and threshold >= 100%.
   */
  record(model: string, usage: TokenUsage, tag?: string): number {
    const cost = this.calculateCost(model, usage);

    this.records.push({
      timestamp: Date.now(),
      model,
      usage,
      costUsd: cost,
      tag,
    });

    // Check budget alerts
    if (this.budgetUsd > 0) {
      const total = this.getTotalCost();
      const percent = (total / this.budgetUsd) * 100;

      for (const threshold of this.alertThresholds) {
        if (percent >= threshold && !this.alertedThresholds.has(threshold)) {
          this.alertedThresholds.add(threshold);
          this.onAlert?.(total, this.budgetUsd, percent);
        }
      }

      // Hard stop at budget
      if (total > this.budgetUsd) {
        throw new LLMError(
          `Budget exceeded: $${total.toFixed(4)} / $${this.budgetUsd.toFixed(2)}. ` +
            `Increase budget or reduce usage.`,
          "rate_limit",
          undefined,
          429,
          false,
        );
      }
    }

    return cost;
  }

  /** Calculate cost for a single request without recording it. */
  calculateCost(model: string, usage: TokenUsage): number {
    const pricing = this.pricingMap.get(model);
    if (!pricing) {
      // Unknown model — return 0 cost but don't crash.
      // Log a warning in production.
      return 0;
    }

    return (
      usage.promptTokens * pricing.promptTokenCost +
      usage.completionTokens * pricing.completionTokenCost
    );
  }

  /** Total cost across all recorded usage. */
  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** Total tokens across all recorded usage. */
  getTotalTokens(): TokenUsage {
    return this.records.reduce(
      (acc, r) => ({
        promptTokens: acc.promptTokens + r.usage.promptTokens,
        completionTokens: acc.completionTokens + r.usage.completionTokens,
        totalTokens: acc.totalTokens + r.usage.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );
  }

  /** Get usage broken down by model. */
  getCostByModel(): Map<string, { cost: number; tokens: number; requests: number }> {
    const byModel = new Map<string, { cost: number; tokens: number; requests: number }>();

    for (const record of this.records) {
      const existing = byModel.get(record.model) ?? { cost: 0, tokens: 0, requests: 0 };
      existing.cost += record.costUsd;
      existing.tokens += record.usage.totalTokens;
      existing.requests += 1;
      byModel.set(record.model, existing);
    }

    return byModel;
  }

  /** Get usage broken down by tag. */
  getCostByTag(): Map<string, { cost: number; tokens: number; requests: number }> {
    const byTag = new Map<string, { cost: number; tokens: number; requests: number }>();

    for (const record of this.records) {
      const tag = record.tag ?? "(untagged)";
      const existing = byTag.get(tag) ?? { cost: 0, tokens: 0, requests: 0 };
      existing.cost += record.costUsd;
      existing.tokens += record.usage.totalTokens;
      existing.requests += 1;
      byTag.set(tag, existing);
    }

    return byTag;
  }

  /** Get all raw records (for export/persistence). */
  getRecords(): readonly UsageRecord[] {
    return this.records;
  }

  /** Get remaining budget. Returns Infinity if no budget is set. */
  getRemainingBudget(): number {
    if (this.budgetUsd <= 0) return Infinity;
    return Math.max(0, this.budgetUsd - this.getTotalCost());
  }

  /** Reset all tracked data. */
  reset(): void {
    this.records.length = 0;
    this.alertedThresholds.clear();
  }
}
