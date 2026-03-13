/**
 * Auth utility functions for a SaaS application.
 *
 * These helpers wrap session management and role-based access control.
 *
 * Design decisions:
 * - getSession is async because real implementations hit a database or JWT verification
 * - requireAuth throws instead of returning null — fail-fast prevents auth bypass bugs
 * - Role hierarchy is explicit, not implied — "admin" doesn't magically include "member"
 *   permissions unless you define it that way
 */

import type { Session, User, UserRole } from "../types/index.js";

// ─── Role Hierarchy ─────────────────────────────────────────

/**
 * Role hierarchy: higher number = more permissions.
 *
 * Why a numeric hierarchy instead of a permission set?
 * - SaaS roles are almost always hierarchical (owner > admin > member > viewer)
 * - A simple comparison covers 90% of authorization checks
 * - For fine-grained permissions, layer a permission system on top
 */
const ROLE_LEVELS: Record<UserRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * Check if a user's role meets or exceeds the required role.
 */
export function hasMinimumRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  const userLevel = ROLE_LEVELS[userRole];
  const requiredLevel = ROLE_LEVELS[requiredRole];
  return userLevel >= requiredLevel;
}

// ─── Session Management ─────────────────────────────────────

/**
 * Session store interface — swap this for your actual session backend.
 *
 * Pattern: Dependency injection via interface.
 * In production, this talks to your database or JWT verifier.
 * In tests, provide a mock implementation.
 */
export interface SessionStore {
  getSession(token: string): Promise<Session | null>;
  createSession(user: User, teamId: string): Promise<Session>;
  deleteSession(token: string): Promise<void>;
}

/**
 * Extract session token from request headers.
 *
 * Checks both:
 * - Authorization: Bearer <token> header (API clients)
 * - Cookie header (browser clients)
 *
 * Why both? SaaS apps serve both a web dashboard and an API.
 */
export function extractSessionToken(
  headers: Record<string, string | undefined>,
  cookieName: string = "session-token"
): string | null {
  // Check Authorization header first (API clients)
  const authHeader = headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Fall back to cookie (browser clients)
  const cookieHeader = headers["cookie"];
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    return cookies[cookieName] ?? null;
  }

  return null;
}

/**
 * Simple cookie parser. In production, use a proper cookie library,
 * but this covers the pattern.
 */
export function parseCookies(
  cookieHeader: string
): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key) {
      cookies[key] = value;
    }
  }
  return cookies;
}

/**
 * Get the current session from a request.
 *
 * Returns null if no valid session exists.
 * In a real app, this would be called from Server Components or API routes.
 */
export async function getSession(
  headers: Record<string, string | undefined>,
  store: SessionStore
): Promise<Session | null> {
  const token = extractSessionToken(headers);
  if (!token) return null;

  const session = await store.getSession(token);
  if (!session) return null;

  // Check expiration
  if (session.expiresAt < new Date()) {
    await store.deleteSession(token);
    return null;
  }

  return session;
}

/**
 * Require authentication — throws if no valid session.
 *
 * Why throw instead of returning null?
 * - Callers don't need to check for null everywhere
 * - The error message is consistent
 * - In Next.js, you can catch this in error boundaries or middleware
 */
export async function requireAuth(
  headers: Record<string, string | undefined>,
  store: SessionStore,
  requiredRole?: UserRole
): Promise<Session> {
  const session = await getSession(headers, store);

  if (!session) {
    throw new AuthError("UNAUTHORIZED", "Authentication required");
  }

  if (requiredRole && !hasMinimumRole(session.user.role, requiredRole)) {
    throw new AuthError(
      "FORBIDDEN",
      `Requires ${requiredRole} role or higher`
    );
  }

  return session;
}

// ─── Auth Errors ────────────────────────────────────────────

export type AuthErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "SESSION_EXPIRED";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
