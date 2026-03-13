import { describe, it, expect } from "vitest";
import {
  getSiteConfig,
  resolveEnvironment,
  getPlanById,
  getEffectiveMonthlyPrice,
  plans,
} from "../src/config/site.js";
import {
  getAuthConfig,
  isProtectedRoute,
  getProviderConfig,
} from "../src/config/auth.js";

// ─── Site Config ────────────────────────────────────────────

describe("resolveEnvironment", () => {
  it("resolves 'production' to production", () => {
    expect(resolveEnvironment("production")).toBe("production");
  });

  it("resolves 'staging' to staging", () => {
    expect(resolveEnvironment("staging")).toBe("staging");
  });

  it("resolves 'development' to development", () => {
    expect(resolveEnvironment("development")).toBe("development");
  });

  it("resolves 'test' to development", () => {
    expect(resolveEnvironment("test")).toBe("development");
  });

  it("defaults to development for unknown values", () => {
    expect(resolveEnvironment("unknown")).toBe("development");
    expect(resolveEnvironment(undefined)).toBe("development");
  });
});

describe("getSiteConfig", () => {
  it("returns production config with production URL", () => {
    const config = getSiteConfig("production");
    expect(config.url).toBe("https://yoursaas.com");
  });

  it("returns development config with localhost URL", () => {
    const config = getSiteConfig("development");
    expect(config.url).toBe("http://localhost:3000");
  });

  it("returns staging config with staging URL", () => {
    const config = getSiteConfig("staging");
    expect(config.url).toBe("https://staging.yoursaas.com");
  });

  it("preserves base social config in development", () => {
    const config = getSiteConfig("development");
    expect(config.social.twitter).toBe("https://twitter.com/yoursaas");
  });

  it("preserves support config across environments", () => {
    const config = getSiteConfig("development");
    expect(config.support.email).toBe("support@yoursaas.com");
  });
});

describe("getPlanById", () => {
  it("finds the free plan", () => {
    const plan = getPlanById("free");
    expect(plan).toBeDefined();
    expect(plan?.name).toBe("Free");
    expect(plan?.priceMonthly).toBe(0);
  });

  it("finds the pro plan", () => {
    const plan = getPlanById("pro");
    expect(plan).toBeDefined();
    expect(plan?.name).toBe("Pro");
    expect(plan?.isPopular).toBe(true);
  });

  it("returns undefined for non-existent plan", () => {
    expect(getPlanById("nonexistent")).toBeUndefined();
  });
});

describe("getEffectiveMonthlyPrice", () => {
  it("returns monthly price for monthly interval", () => {
    const pro = plans.find((p) => p.id === "pro")!;
    expect(getEffectiveMonthlyPrice(pro, "month")).toBe(29);
  });

  it("calculates yearly price divided by 12", () => {
    const pro = plans.find((p) => p.id === "pro")!;
    // 290 / 12 = 24.166... → rounded to 24.17
    expect(getEffectiveMonthlyPrice(pro, "year")).toBe(24.17);
  });

  it("returns 0 for free plan regardless of interval", () => {
    const free = plans.find((p) => p.id === "free")!;
    expect(getEffectiveMonthlyPrice(free, "month")).toBe(0);
    expect(getEffectiveMonthlyPrice(free, "year")).toBe(0);
  });
});

// ─── Auth Config ────────────────────────────────────────────

describe("getAuthConfig", () => {
  it("returns default config when no overrides", () => {
    const config = getAuthConfig();
    expect(config.loginPath).toBe("/login");
    expect(config.afterLoginPath).toBe("/dashboard");
    expect(config.session.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("merges overrides with defaults", () => {
    const config = getAuthConfig({ loginPath: "/auth/login" });
    expect(config.loginPath).toBe("/auth/login");
    expect(config.afterLoginPath).toBe("/dashboard"); // preserved
  });

  it("deep-merges session config", () => {
    const config = getAuthConfig({
      session: { maxAge: 7200, updateAge: 3600, cookieName: "custom", secure: false },
    });
    expect(config.session.maxAge).toBe(7200);
    expect(config.session.cookieName).toBe("custom");
  });
});

describe("isProtectedRoute", () => {
  it("returns true for dashboard routes", () => {
    expect(isProtectedRoute("/dashboard")).toBe(true);
    expect(isProtectedRoute("/dashboard/projects")).toBe(true);
  });

  it("returns true for settings routes", () => {
    expect(isProtectedRoute("/settings")).toBe(true);
    expect(isProtectedRoute("/settings/profile")).toBe(true);
  });

  it("returns false for public routes", () => {
    expect(isProtectedRoute("/")).toBe(false);
    expect(isProtectedRoute("/login")).toBe(false);
    expect(isProtectedRoute("/pricing")).toBe(false);
  });

  it("returns false for webhook routes even under /api", () => {
    expect(isProtectedRoute("/api/webhooks")).toBe(false);
    expect(isProtectedRoute("/api/webhooks/stripe")).toBe(false);
  });

  it("returns false for health check", () => {
    expect(isProtectedRoute("/api/health")).toBe(false);
  });

  it("public routes take precedence over protected prefixes", () => {
    // /api/v1 is protected, but /api/webhooks is explicitly public
    expect(isProtectedRoute("/api/v1/users")).toBe(true);
    expect(isProtectedRoute("/api/webhooks/stripe")).toBe(false);
  });
});

describe("getProviderConfig", () => {
  it("finds google provider", () => {
    const provider = getProviderConfig("google");
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("Google");
    expect(provider?.scopes).toContain("email");
  });

  it("finds github provider", () => {
    const provider = getProviderConfig("github");
    expect(provider).toBeDefined();
    expect(provider?.scopes).toContain("read:user");
  });

  it("returns undefined for unknown provider", () => {
    expect(getProviderConfig("unknown")).toBeUndefined();
  });
});
