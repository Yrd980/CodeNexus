/**
 * @module foundation/auth - Auth Middleware
 *
 * Framework-agnostic authentication and authorization functions.
 *
 * Why framework-agnostic?
 * Express, Fastify, Hono, Koa — every framework has its own middleware signature.
 * Rather than coupling to one, we provide pure functions that take a simple
 * AuthRequest and return an AuthResult. You write a thin adapter for your framework.
 *
 * Example adapters are shown in the README.
 */

import type {
  AuthErrorCode,
  AuthRequest,
  AuthResult,
  ResolvedAuthConfig,
} from "./types.js";
import { AuthError } from "./types.js";
import { verifyAccessToken } from "./tokens.js";

/**
 * Authenticate a request by verifying its access token.
 *
 * Token extraction priority:
 * 1. Authorization header ("Bearer <token>")
 * 2. Cookie token (for browser-based auth)
 *
 * @returns AuthResult with the authenticated user and token payload
 * @throws AuthError with code TOKEN_MISSING, TOKEN_INVALID, or TOKEN_EXPIRED
 */
export async function authenticate(
  request: AuthRequest,
  config: ResolvedAuthConfig,
): Promise<AuthResult> {
  const token = extractToken(request);

  if (!token) {
    throw new AuthError("No authentication token provided", "TOKEN_MISSING");
  }

  const payload = await verifyAccessToken(token, config);

  return {
    user: {
      id: payload.sub,
      roles: payload.roles,
    },
    payload,
  };
}

/**
 * Require specific roles for access.
 *
 * Call this after authenticate() to enforce role-based access control.
 * Uses "any of" logic — the user needs at least one of the required roles.
 *
 * @param result - The AuthResult from authenticate()
 * @param requiredRoles - Roles the user must have (at least one)
 * @throws AuthError with code INSUFFICIENT_PERMISSIONS
 */
export function requireRoles(
  result: AuthResult,
  requiredRoles: string[],
): void {
  if (requiredRoles.length === 0) return;

  const hasRole = requiredRoles.some((role) =>
    result.user.roles.includes(role),
  );

  if (!hasRole) {
    throw new AuthError(
      `Insufficient permissions. Required one of: ${requiredRoles.join(", ")}`,
      "INSUFFICIENT_PERMISSIONS",
    );
  }
}

/**
 * Convenience: authenticate and check roles in one call.
 *
 * @param request - The incoming request
 * @param config - Auth configuration
 * @param requiredRoles - Optional roles to require (at least one must match)
 */
export async function authenticateAndAuthorize(
  request: AuthRequest,
  config: ResolvedAuthConfig,
  requiredRoles?: string[],
): Promise<AuthResult> {
  const result = await authenticate(request, config);

  if (requiredRoles && requiredRoles.length > 0) {
    requireRoles(result, requiredRoles);
  }

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the bearer token from the request.
 * Checks Authorization header first, then falls back to cookie.
 */
function extractToken(request: AuthRequest): string | null {
  // 1. Try Authorization header
  if (request.authorizationHeader) {
    const parts = request.authorizationHeader.split(" ");
    if (parts.length === 2 && parts[0]?.toLowerCase() === "bearer" && parts[1]) {
      return parts[1];
    }
  }

  // 2. Fall back to cookie
  if (request.cookieToken) {
    return request.cookieToken;
  }

  return null;
}
