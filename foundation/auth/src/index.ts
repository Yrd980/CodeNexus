/**
 * @codenexus/auth — JWT Authentication with Refresh Token Rotation
 *
 * A minimal, secure, framework-agnostic auth module for startups.
 *
 * Features:
 * - Stateless JWT access tokens (short-lived, no DB lookup)
 * - Rotating refresh tokens with reuse detection (OWASP best practice)
 * - Framework-agnostic middleware (bring your own Express/Fastify/Hono adapter)
 * - Secure password hashing with scrypt (zero native dependencies)
 * - Pluggable token storage (in-memory for dev, Redis/DB for production)
 *
 * @example Quick Start
 * ```typescript
 * import {
 *   createAuthConfig,
 *   createSession,
 *   refreshSession,
 *   authenticate,
 *   hashPassword,
 *   verifyPassword,
 *   MemoryTokenStore,
 * } from "@codenexus/auth";
 *
 * const config = createAuthConfig({ issuer: "myapp", secret: process.env.AUTH_SECRET! });
 * const store = new MemoryTokenStore();
 *
 * // Create a session after login
 * const session = await createSession({ id: "user-1", roles: ["user"] }, config, store);
 *
 * // Authenticate a request
 * const result = await authenticate({ authorizationHeader: `Bearer ${session.accessToken.token}` }, config);
 * ```
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  AuthConfig,
  ResolvedAuthConfig,
  TokenPayload,
  AccessToken,
  RefreshToken,
  AuthUser,
  Session,
  TokenStore,
  AuthRequest,
  AuthResult,
  AuthErrorCode,
} from "./types.js";

export { AuthError } from "./types.js";

// ─── Tokens ─────────────────────────────────────────────────────────────────
export {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  detectFamilyReuse,
} from "./tokens.js";

// ─── Sessions ───────────────────────────────────────────────────────────────
export {
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions,
} from "./session.js";

// ─── Middleware ──────────────────────────────────────────────────────────────
export {
  authenticate,
  requireRoles,
  authenticateAndAuthorize,
} from "./middleware.js";

// ─── Password ───────────────────────────────────────────────────────────────
export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "./password.js";
export type { PasswordStrengthResult } from "./password.js";

// ─── Stores ─────────────────────────────────────────────────────────────────
export { MemoryTokenStore } from "./store/memory-store.js";

// ─── Config Helper ──────────────────────────────────────────────────────────

import type { AuthConfig, ResolvedAuthConfig } from "./types.js";

/** Default configuration values */
const DEFAULTS = {
  accessTokenTTL: 900, // 15 minutes
  refreshTokenTTL: 2_592_000, // 30 days
  algorithm: "HS256" as const,
  audience: "default",
  clockTolerance: 5,
} satisfies Partial<ResolvedAuthConfig>;

/**
 * Create a resolved auth configuration with sensible defaults.
 *
 * Only `issuer` and `secret` are required. Everything else has secure defaults.
 */
export function createAuthConfig(
  config: Pick<AuthConfig, "issuer" | "secret"> & Partial<AuthConfig>,
): ResolvedAuthConfig {
  if (!config.secret || config.secret.length < 32) {
    throw new Error(
      "Auth secret must be at least 32 characters. Generate one with: openssl rand -base64 48",
    );
  }

  return {
    issuer: config.issuer,
    secret: config.secret,
    audience: config.audience ?? DEFAULTS.audience,
    accessTokenTTL: config.accessTokenTTL ?? DEFAULTS.accessTokenTTL,
    refreshTokenTTL: config.refreshTokenTTL ?? DEFAULTS.refreshTokenTTL,
    algorithm: config.algorithm ?? DEFAULTS.algorithm,
    clockTolerance: config.clockTolerance ?? DEFAULTS.clockTolerance,
  };
}
