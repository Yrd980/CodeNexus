/**
 * @module foundation/auth - Token Management
 *
 * Handles JWT access token creation/verification and refresh token lifecycle.
 *
 * Design decisions:
 * - jose over jsonwebtoken: Web Crypto API based, works on edge runtimes (Cloudflare Workers,
 *   Vercel Edge, Deno Deploy). jsonwebtoken uses Node.js crypto and won't work on edge.
 * - Access tokens are stateless JWTs — no DB lookup needed to verify.
 * - Refresh tokens are opaque random strings stored server-side — revocable.
 * - Token families enable reuse detection: if someone uses a rotated-out refresh token,
 *   it means the token was likely stolen, so we invalidate the entire family.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { randomBytes, randomUUID } from "node:crypto";

import type {
  AccessToken,
  AuthError,
  RefreshToken,
  ResolvedAuthConfig,
  TokenPayload,
  TokenStore,
} from "./types.js";

// ─── Access Tokens (Stateless JWT) ──────────────────────────────────────────

/**
 * Generate a short-lived access token as a signed JWT.
 *
 * The token contains the user's ID and roles, enabling stateless
 * authorization without hitting the database on every request.
 */
export async function generateAccessToken(
  payload: TokenPayload,
  config: ResolvedAuthConfig,
): Promise<AccessToken> {
  const secret = new TextEncoder().encode(config.secret);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + config.accessTokenTTL;

  const token = await new SignJWT({
    roles: payload.roles,
    ...filterCustomClaims(payload),
  })
    .setProtectedHeader({ alg: config.algorithm })
    .setSubject(payload.sub)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(randomUUID())
    .sign(secret);

  return { token, expiresAt };
}

/**
 * Verify and decode an access token.
 *
 * Returns the token payload if valid, or throws an AuthError with
 * a specific error code (TOKEN_EXPIRED, TOKEN_INVALID).
 */
export async function verifyAccessToken(
  token: string,
  config: ResolvedAuthConfig,
): Promise<TokenPayload> {
  const secret = new TextEncoder().encode(config.secret);

  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: [config.algorithm],
      clockTolerance: config.clockTolerance,
    });

    return {
      sub: payload.sub as string,
      roles: (payload["roles"] as string[]) ?? [],
      ...extractCustomClaims(payload),
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw createTokenError("Access token has expired", "TOKEN_EXPIRED");
    }
    throw createTokenError(
      "Access token is invalid",
      "TOKEN_INVALID",
    );
  }
}

// ─── Refresh Tokens (Opaque, Stored) ────────────────────────────────────────

/**
 * Generate a new refresh token and persist it to the store.
 *
 * Refresh tokens are opaque random strings (not JWTs) because:
 * 1. They must be revocable (stored server-side)
 * 2. They don't need to carry claims (we look up the user from the store)
 * 3. Opaque tokens can't be decoded client-side, reducing attack surface
 *
 * @param family - Token family for rotation tracking. Pass the existing family
 *                 when rotating, or omit to create a new family.
 */
export async function generateRefreshToken(
  userId: string,
  config: ResolvedAuthConfig,
  store: TokenStore,
  family?: string,
): Promise<RefreshToken> {
  const now = Math.floor(Date.now() / 1000);
  const refreshToken: RefreshToken = {
    token: generateOpaqueToken(),
    userId,
    family: family ?? randomUUID(),
    expiresAt: now + config.refreshTokenTTL,
    createdAt: now,
  };

  await store.save(refreshToken);
  return refreshToken;
}

/**
 * Rotate a refresh token: validate the old one, issue a new one, invalidate the old.
 *
 * This implements OWASP's refresh token rotation with reuse detection:
 * - Each refresh token can only be used once
 * - Using it produces a new token in the same "family"
 * - If a previously-used token is presented again, the entire family is invalidated
 *   (this means the token was likely stolen and replayed)
 *
 * @returns The new refresh token, or throws if the old token is invalid/reused.
 */
export async function rotateRefreshToken(
  currentToken: string,
  config: ResolvedAuthConfig,
  store: TokenStore,
): Promise<{ refreshToken: RefreshToken; userId: string }> {
  const existing = await store.findByToken(currentToken);

  if (!existing) {
    // Token not found — could be a reuse attempt.
    // We can't determine the family without the token, so we just reject.
    throw createTokenError(
      "Refresh token not found — possible reuse detected",
      "REFRESH_TOKEN_NOT_FOUND",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (existing.expiresAt <= now) {
    await store.delete(currentToken);
    throw createTokenError(
      "Refresh token has expired",
      "REFRESH_TOKEN_EXPIRED",
    );
  }

  // Invalidate the old token immediately (single-use)
  await store.delete(currentToken);

  // Issue a new token in the same family
  const newToken = await generateRefreshToken(
    existing.userId,
    config,
    store,
    existing.family,
  );

  return { refreshToken: newToken, userId: existing.userId };
}

/**
 * Check if a refresh token reuse has occurred within a token family.
 * If detected, invalidate all tokens in the family.
 *
 * Call this when a refresh fails with REFRESH_TOKEN_NOT_FOUND
 * and you have the family ID from another source (e.g., the access token's jti).
 */
export async function detectFamilyReuse(
  family: string,
  store: TokenStore,
): Promise<boolean> {
  const familyTokens = await store.findByFamily(family);
  if (familyTokens.length > 0) {
    // There are still active tokens in this family, but the presented token
    // was already used — reuse detected. Nuke the entire family.
    await store.deleteByFamily(family);
    return true;
  }
  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a cryptographically random opaque token (Base64URL, 32 bytes) */
function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Filter out standard JWT claims from custom claims in TokenPayload */
function filterCustomClaims(
  payload: TokenPayload,
): Record<string, unknown> {
  const { sub, roles, ...custom } = payload;
  return custom;
}

/** Extract custom claims from a decoded JWT, excluding standard fields */
function extractCustomClaims(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const standardClaims = new Set([
    "sub",
    "roles",
    "iss",
    "aud",
    "exp",
    "iat",
    "jti",
    "nbf",
  ]);
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!standardClaims.has(key)) {
      custom[key] = value;
    }
  }
  return custom;
}

/** Create an AuthError-like object without importing the class (avoid circular deps) */
function createTokenError(
  message: string,
  code: AuthError["code"],
): AuthError {
  const error = new Error(message) as AuthError;
  error.name = "AuthError";
  // We use Object.defineProperty to set the readonly 'code' property
  Object.defineProperty(error, "code", {
    value: code,
    writable: false,
    enumerable: true,
  });
  return error;
}
