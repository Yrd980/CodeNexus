/**
 * Auth guard component pattern for a SaaS application.
 *
 * This file demonstrates the PATTERN for protecting routes and components
 * based on authentication state and user roles.
 *
 * In Next.js App Router, you have multiple layers of auth protection:
 * 1. Middleware (src/middleware.ts) — redirects before the page loads
 * 2. Server Component checks — verify auth in the layout/page
 * 3. Client Component guards — this pattern, for dynamic UI switching
 *
 * Why all three layers?
 * - Middleware: fastest, but can't access database in Edge Runtime
 * - Server Component: has full DB access, runs once on server
 * - Client guard: handles client-side navigation and loading states
 *
 * You should use middleware for the primary auth gate and
 * client guards for role-based UI within authenticated pages.
 */

import type { AuthGuardProps, UserRole } from "../../types/index.js";
import { hasMinimumRole } from "../../lib/auth.js";

// ─── Guard Logic (framework-agnostic) ───────────────────────

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  userRole: UserRole | null;
}

export interface GuardDecision {
  action: "allow" | "redirect" | "show_fallback" | "loading";
  redirectTo?: string;
  reason?: string;
}

/**
 * Determine what the auth guard should do based on current auth state.
 *
 * This is the pure logic — no React, no side effects.
 * Your component calls this and acts on the decision.
 */
export function evaluateGuard(
  authState: AuthState,
  props: Pick<AuthGuardProps, "requiredRole" | "redirectTo">
): GuardDecision {
  // Still loading auth state — show loading indicator
  if (authState.isLoading) {
    return { action: "loading" };
  }

  // Not authenticated — redirect to login
  if (!authState.isAuthenticated) {
    return {
      action: "redirect",
      redirectTo: props.redirectTo ?? "/login",
      reason: "Not authenticated",
    };
  }

  // Authenticated but wrong role — show fallback or redirect
  if (props.requiredRole && authState.userRole) {
    if (!hasMinimumRole(authState.userRole, props.requiredRole)) {
      return {
        action: "show_fallback",
        reason: `Requires ${props.requiredRole} role`,
      };
    }
  }

  // All checks passed
  return { action: "allow" };
}

/**
 * Component Pattern (pseudo-code):
 *
 * ```tsx
 * "use client";
 *
 * import { useSession } from "@/hooks/use-session";
 * import { evaluateGuard } from "@/components/auth/auth-guard";
 * import { redirect } from "next/navigation";
 *
 * export function AuthGuard({ requiredRole, redirectTo, fallback, children }) {
 *   const { user, isLoading } = useSession();
 *
 *   const decision = evaluateGuard(
 *     {
 *       isAuthenticated: !!user,
 *       isLoading,
 *       userRole: user?.role ?? null,
 *     },
 *     { requiredRole, redirectTo }
 *   );
 *
 *   switch (decision.action) {
 *     case "loading":
 *       return <LoadingSpinner />;
 *     case "redirect":
 *       redirect(decision.redirectTo!);
 *     case "show_fallback":
 *       return fallback ?? <AccessDenied reason={decision.reason} />;
 *     case "allow":
 *       return children;
 *   }
 * }
 * ```
 */
