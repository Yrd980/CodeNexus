/**
 * @module foundation/auth - Session Management
 *
 * High-level session operations that compose token primitives.
 *
 * A "session" in this module = access token + refresh token pair.
 * The access token is stateless (JWT), the refresh token is stateful (stored).
 * This hybrid approach gives you:
 * - Fast auth checks (no DB hit for most requests)
 * - Revocation capability (via refresh token store)
 * - Smooth token rotation (no forced re-login)
 */

import type {
  AuthUser,
  ResolvedAuthConfig,
  Session,
  TokenPayload,
  TokenStore,
} from "./types.js";
import { generateAccessToken, generateRefreshToken, rotateRefreshToken } from "./tokens.js";

/**
 * Create a new session for a user.
 *
 * Call this after successful login (password verification, OAuth callback, etc.).
 * Returns both an access token and a refresh token.
 */
export async function createSession(
  user: AuthUser,
  config: ResolvedAuthConfig,
  store: TokenStore,
  customClaims?: Record<string, unknown>,
): Promise<Session> {
  const payload: TokenPayload = {
    sub: user.id,
    roles: user.roles,
    ...customClaims,
  };

  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(payload, config),
    generateRefreshToken(user.id, config, store),
  ]);

  return { accessToken, refreshToken };
}

/**
 * Refresh a session using a refresh token.
 *
 * This implements the core rotation flow:
 * 1. Validate the current refresh token
 * 2. Invalidate it (single-use)
 * 3. Issue a new refresh token in the same family
 * 4. Issue a new access token
 *
 * If the refresh token has already been used (reuse detection),
 * the entire token family is invalidated and an error is thrown.
 *
 * @param currentRefreshToken - The refresh token string from the client
 * @param roles - User's current roles (re-fetch from DB for freshness)
 * @param customClaims - Optional custom claims to include in the new access token
 */
export async function refreshSession(
  currentRefreshToken: string,
  roles: string[],
  config: ResolvedAuthConfig,
  store: TokenStore,
  customClaims?: Record<string, unknown>,
): Promise<Session> {
  const { refreshToken, userId } = await rotateRefreshToken(
    currentRefreshToken,
    config,
    store,
  );

  const payload: TokenPayload = {
    sub: userId,
    roles,
    ...customClaims,
  };

  const accessToken = await generateAccessToken(payload, config);

  return { accessToken, refreshToken };
}

/**
 * Revoke a specific session by its refresh token.
 *
 * Use this for single-device logout.
 */
export async function revokeSession(
  refreshToken: string,
  store: TokenStore,
): Promise<void> {
  await store.delete(refreshToken);
}

/**
 * Revoke all sessions for a user.
 *
 * Use this for:
 * - "Log out everywhere" feature
 * - Password change (force re-authentication on all devices)
 * - Account compromise response
 */
export async function revokeAllSessions(
  userId: string,
  store: TokenStore,
): Promise<void> {
  await store.deleteByUserId(userId);
}
