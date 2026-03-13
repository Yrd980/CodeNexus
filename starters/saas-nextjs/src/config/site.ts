/**
 * Site configuration pattern for a SaaS application.
 *
 * Why a centralized config?
 * - Single source of truth for branding, URLs, and feature flags
 * - Environment-specific overrides without scattering process.env everywhere
 * - Type-safe access — typos in config keys are compile-time errors
 *
 * Pattern: Define a base config, then override per environment.
 */

import type { Plan } from "../types/index.js";

// ─── Types ──────────────────────────────────────────────────

export interface SiteConfig {
  name: string;
  description: string;
  url: string;
  ogImage: string;
  social: {
    twitter?: string;
    github?: string;
    discord?: string;
  };
  support: {
    email: string;
    docsUrl: string;
  };
}

export type Environment = "development" | "staging" | "production";

// ─── Base Config ────────────────────────────────────────────

const baseConfig: SiteConfig = {
  name: "YourSaaS",
  description: "The platform that helps teams ship faster",
  url: "https://yoursaas.com",
  ogImage: "https://yoursaas.com/og.png",
  social: {
    twitter: "https://twitter.com/yoursaas",
    github: "https://github.com/yoursaas",
  },
  support: {
    email: "support@yoursaas.com",
    docsUrl: "https://docs.yoursaas.com",
  },
};

// ─── Environment Overrides ──────────────────────────────────

/**
 * Override config values per environment.
 * Only specify the fields that differ — the rest inherit from base.
 */
const environmentOverrides: Record<Environment, Partial<SiteConfig>> = {
  development: {
    url: "http://localhost:3000",
    ogImage: "http://localhost:3000/og.png",
  },
  staging: {
    url: "https://staging.yoursaas.com",
    ogImage: "https://staging.yoursaas.com/og.png",
  },
  production: {
    // production uses base config as-is
  },
};

/**
 * Resolve the current environment from NODE_ENV or a custom env var.
 * Defaults to "development" for safety.
 */
export function resolveEnvironment(
  nodeEnv?: string
): Environment {
  const envMap: Record<string, Environment> = {
    production: "production",
    staging: "staging",
    development: "development",
    test: "development",
  };
  return envMap[nodeEnv ?? ""] ?? "development";
}

/**
 * Build the site config for a given environment.
 * Deep-merges the base config with environment-specific overrides.
 */
export function getSiteConfig(env?: Environment): SiteConfig {
  const resolved = env ?? resolveEnvironment(process.env["NODE_ENV"]);
  const overrides = environmentOverrides[resolved];

  return {
    ...baseConfig,
    ...overrides,
    social: {
      ...baseConfig.social,
      ...(overrides.social ?? {}),
    },
    support: {
      ...baseConfig.support,
      ...(overrides.support ?? {}),
    },
  };
}

// ─── Pricing Plans ──────────────────────────────────────────

/**
 * Define your pricing plans here.
 * These are the source of truth — your billing logic references these IDs.
 *
 * Why hardcode plans instead of fetching from Stripe?
 * - Plans rarely change, and your UI needs them at build time
 * - Stripe is the billing engine, not the product catalog owner
 * - Keep plan IDs in sync with Stripe via your deploy process
 */
export const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    description: "For side projects and experimentation",
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      { name: "Up to 2 team members", included: true, limit: 2 },
      { name: "3 projects", included: true, limit: 3 },
      { name: "100 MB storage", included: true },
      { name: "Community support", included: true },
      { name: "Custom domains", included: false },
      { name: "API access", included: false },
    ],
    limits: {
      maxMembers: 2,
      maxProjects: 3,
      maxStorageMb: 100,
      maxApiRequestsPerDay: 100,
    },
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing teams that need more power",
    priceMonthly: 29,
    priceYearly: 290,
    isPopular: true,
    features: [
      { name: "Up to 10 team members", included: true, limit: 10 },
      { name: "Unlimited projects", included: true },
      { name: "10 GB storage", included: true },
      { name: "Priority support", included: true },
      { name: "Custom domains", included: true },
      { name: "API access", included: true },
    ],
    limits: {
      maxMembers: 10,
      maxProjects: -1, // unlimited
      maxStorageMb: 10_240,
      maxApiRequestsPerDay: 10_000,
    },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For organizations with advanced needs",
    priceMonthly: 99,
    priceYearly: 990,
    features: [
      { name: "Unlimited members", included: true },
      { name: "Unlimited projects", included: true },
      { name: "100 GB storage", included: true },
      { name: "24/7 support + SLA", included: true },
      { name: "Custom domains", included: true },
      { name: "API access + webhooks", included: true },
    ],
    limits: {
      maxMembers: -1, // unlimited
      maxProjects: -1,
      maxStorageMb: 102_400,
      maxApiRequestsPerDay: 100_000,
    },
  },
];

/**
 * Look up a plan by ID. Returns undefined if not found.
 */
export function getPlanById(planId: string): Plan | undefined {
  return plans.find((p) => p.id === planId);
}

/**
 * Calculate the effective price for a plan + interval.
 * Returns monthly cost (yearly is divided by 12 for comparison).
 */
export function getEffectiveMonthlyPrice(
  plan: Plan,
  interval: "month" | "year"
): number {
  if (interval === "year") {
    return Math.round((plan.priceYearly / 12) * 100) / 100;
  }
  return plan.priceMonthly;
}
