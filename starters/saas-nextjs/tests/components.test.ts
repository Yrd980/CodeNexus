import { describe, it, expect } from "vitest";
import {
  validateLayoutProps,
  findActiveNavItem,
  generateBreadcrumbs,
  defaultNavigation,
} from "../src/components/layout/dashboard-layout.js";
import { evaluateGuard } from "../src/components/auth/auth-guard.js";
import type { DashboardLayoutProps, NavItem } from "../src/types/index.js";

// ─── Dashboard Layout ───────────────────────────────────────

describe("validateLayoutProps", () => {
  it("returns no errors for valid props", () => {
    const props: DashboardLayoutProps = {
      navigation: defaultNavigation,
      userMenu: {
        user: { name: "Test", email: "test@test.com", avatarUrl: null },
        items: [],
      },
      children: null,
    };
    expect(validateLayoutProps(props)).toEqual([]);
  });

  it("errors when navigation is empty", () => {
    const props: DashboardLayoutProps = {
      navigation: [],
      userMenu: {
        user: { name: "Test", email: "test@test.com", avatarUrl: null },
        items: [],
      },
      children: null,
    };
    expect(validateLayoutProps(props)).toContainEqual(
      expect.stringContaining("at least one item")
    );
  });

  it("errors when href doesn't start with /", () => {
    const props: DashboardLayoutProps = {
      navigation: [{ label: "Bad", href: "dashboard" }],
      userMenu: {
        user: { name: "Test", email: "test@test.com", avatarUrl: null },
        items: [],
      },
      children: null,
    };
    expect(validateLayoutProps(props)).toContainEqual(
      expect.stringContaining("must start with /")
    );
  });

  it("errors when user email is empty", () => {
    const props: DashboardLayoutProps = {
      navigation: defaultNavigation,
      userMenu: {
        user: { name: "Test", email: "", avatarUrl: null },
        items: [],
      },
      children: null,
    };
    expect(validateLayoutProps(props)).toContainEqual(
      expect.stringContaining("email")
    );
  });
});

describe("findActiveNavItem", () => {
  const nav: NavItem[] = [
    { label: "Dashboard", href: "/dashboard" },
    {
      label: "Team",
      href: "/dashboard/team",
      children: [
        { label: "Members", href: "/dashboard/team/members" },
      ],
    },
    { label: "Settings", href: "/settings" },
  ];

  it("finds exact match", () => {
    const active = findActiveNavItem(nav, "/dashboard");
    expect(active?.label).toBe("Dashboard");
  });

  it("finds longest prefix match", () => {
    const active = findActiveNavItem(nav, "/dashboard/team/members/123");
    expect(active?.label).toBe("Members");
  });

  it("prefers child match over parent", () => {
    const active = findActiveNavItem(nav, "/dashboard/team/members");
    expect(active?.label).toBe("Members");
  });

  it("returns undefined for no match", () => {
    const active = findActiveNavItem(nav, "/unknown");
    expect(active).toBeUndefined();
  });
});

describe("generateBreadcrumbs", () => {
  const nav: NavItem[] = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Projects", href: "/dashboard/projects" },
  ];

  it("generates breadcrumbs from path", () => {
    const crumbs = generateBreadcrumbs("/dashboard/projects", nav);
    expect(crumbs).toEqual([
      { label: "Dashboard", href: "/dashboard" },
      { label: "Projects", href: "/dashboard/projects" },
    ]);
  });

  it("uses segment name for unknown paths", () => {
    const crumbs = generateBreadcrumbs("/dashboard/projects/123", nav);
    expect(crumbs[2]).toEqual({ label: "123", href: "/dashboard/projects/123" });
  });
});

// ─── Auth Guard ─────────────────────────────────────────────

describe("evaluateGuard", () => {
  it("returns loading when auth is loading", () => {
    const decision = evaluateGuard(
      { isAuthenticated: false, isLoading: true, userRole: null },
      {}
    );
    expect(decision.action).toBe("loading");
  });

  it("redirects when not authenticated", () => {
    const decision = evaluateGuard(
      { isAuthenticated: false, isLoading: false, userRole: null },
      {}
    );
    expect(decision.action).toBe("redirect");
    expect(decision.redirectTo).toBe("/login");
  });

  it("uses custom redirect path", () => {
    const decision = evaluateGuard(
      { isAuthenticated: false, isLoading: false, userRole: null },
      { redirectTo: "/auth/signin" }
    );
    expect(decision.redirectTo).toBe("/auth/signin");
  });

  it("allows authenticated users", () => {
    const decision = evaluateGuard(
      { isAuthenticated: true, isLoading: false, userRole: "member" },
      {}
    );
    expect(decision.action).toBe("allow");
  });

  it("shows fallback when role is insufficient", () => {
    const decision = evaluateGuard(
      { isAuthenticated: true, isLoading: false, userRole: "viewer" },
      { requiredRole: "admin" }
    );
    expect(decision.action).toBe("show_fallback");
    expect(decision.reason).toContain("admin");
  });

  it("allows when role is sufficient", () => {
    const decision = evaluateGuard(
      { isAuthenticated: true, isLoading: false, userRole: "owner" },
      { requiredRole: "admin" }
    );
    expect(decision.action).toBe("allow");
  });
});
