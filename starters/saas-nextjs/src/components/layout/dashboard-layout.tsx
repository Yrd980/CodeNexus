/**
 * Dashboard layout pattern for a SaaS application.
 *
 * This file demonstrates the STRUCTURE of a dashboard layout,
 * not a runnable component. It shows:
 * - How to organize navigation, sidebar, and content areas
 * - Type definitions for layout props
 * - Responsive layout considerations
 *
 * In your actual app, this would use React Server Components (RSC)
 * for the layout shell and Client Components for interactive parts.
 *
 * Why a layout component?
 * - Next.js App Router layouts persist across navigation (no re-renders)
 * - Sidebar + top bar is the standard SaaS pattern (proven UX)
 * - Centralizing layout means consistent nav across all dashboard pages
 */

import type { DashboardLayoutProps, NavItem } from "../../types/index.js";

// ─── Layout Configuration ───────────────────────────────────

/**
 * Default navigation items for a SaaS dashboard.
 * Customize this for your product.
 */
export const defaultNavigation: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "Projects", href: "/dashboard/projects", icon: "folder" },
  {
    label: "Team",
    href: "/dashboard/team",
    icon: "users",
    children: [
      { label: "Members", href: "/dashboard/team/members" },
      { label: "Invites", href: "/dashboard/team/invites" },
    ],
  },
  { label: "Analytics", href: "/dashboard/analytics", icon: "chart" },
  { label: "Settings", href: "/settings", icon: "gear" },
  { label: "Billing", href: "/billing", icon: "credit-card" },
];

/**
 * Default user menu items.
 */
export const defaultUserMenuItems: NavItem[] = [
  { label: "Profile", href: "/settings/profile" },
  { label: "Preferences", href: "/settings/preferences" },
  { label: "API Keys", href: "/settings/api-keys" },
  { label: "Sign Out", href: "/api/auth/signout" },
];

// ─── Layout Pattern (Pseudo-JSX for documentation) ──────────

/**
 * Dashboard Layout Structure:
 *
 * ┌──────────────────────────────────────────────────┐
 * │ Top Bar (fixed)                      [User Menu] │
 * ├──────────┬───────────────────────────────────────┤
 * │          │                                       │
 * │ Sidebar  │  Main Content Area                    │
 * │ (fixed)  │  (scrollable)                         │
 * │          │                                       │
 * │ - Nav 1  │  {children}                           │
 * │ - Nav 2  │                                       │
 * │ - Nav 3  │                                       │
 * │          │                                       │
 * └──────────┴───────────────────────────────────────┘
 *
 * Mobile: Sidebar becomes a hamburger menu overlay.
 *
 * Implementation notes for Next.js App Router:
 * - This is a Server Component layout (app/dashboard/layout.tsx)
 * - Sidebar state (open/closed) uses a Client Component wrapper
 * - Navigation highlighting uses usePathname() in a Client Component
 */

/**
 * Validate layout props at runtime.
 * Useful during development to catch config errors early.
 */
export function validateLayoutProps(
  props: DashboardLayoutProps
): string[] {
  const errors: string[] = [];

  if (!props.navigation.length) {
    errors.push("Navigation must have at least one item");
  }

  for (const item of props.navigation) {
    if (!item.href.startsWith("/")) {
      errors.push(`Navigation href must start with /: ${item.href}`);
    }
  }

  if (!props.userMenu.user.email) {
    errors.push("User menu requires user email");
  }

  return errors;
}

/**
 * Find the active navigation item based on the current path.
 *
 * Why custom logic instead of exact matching?
 * - /dashboard/projects/123 should highlight "Projects"
 * - Longest prefix match prevents the "Dashboard" item
 *   from matching everything under /dashboard/*
 */
export function findActiveNavItem(
  navigation: NavItem[],
  currentPath: string
): NavItem | undefined {
  // Flatten all items including children
  const allItems = navigation.flatMap((item) => [
    item,
    ...(item.children ?? []),
  ]);

  // Find the longest prefix match
  let bestMatch: NavItem | undefined;
  let bestLength = 0;

  for (const item of allItems) {
    if (
      currentPath === item.href ||
      currentPath.startsWith(item.href + "/")
    ) {
      if (item.href.length > bestLength) {
        bestMatch = item;
        bestLength = item.href.length;
      }
    }
  }

  return bestMatch;
}

/**
 * Generate breadcrumbs from a path.
 *
 * "/dashboard/projects/123" -> [
 *   { label: "Dashboard", href: "/dashboard" },
 *   { label: "Projects", href: "/dashboard/projects" },
 *   { label: "123", href: "/dashboard/projects/123" }
 * ]
 */
export function generateBreadcrumbs(
  path: string,
  navigation: NavItem[]
): Array<{ label: string; href: string }> {
  const segments = path.split("/").filter(Boolean);
  const breadcrumbs: Array<{ label: string; href: string }> = [];

  // Flatten navigation for lookup
  const allItems = navigation.flatMap((item) => [
    item,
    ...(item.children ?? []),
  ]);
  const navMap = new Map(allItems.map((item) => [item.href, item.label]));

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const label = navMap.get(currentPath) ?? segment;
    breadcrumbs.push({ label, href: currentPath });
  }

  return breadcrumbs;
}
