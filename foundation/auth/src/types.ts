/**
 * @module foundation/auth - Type Definitions
 *
 * All types for the auth module. No runtime code here — pure type definitions
 * that serve as the contract between tokens, sessions, middleware, and storage.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

export interface AuthConfig {
  /** JWT issuer claim (e.g., "https://myapp.com") */
  issuer: string;

  /** JWT audience claim (e.g., "https://api.myapp.com") */
  audience?: string;

  /** Access token time-to-live in seconds. Default: 900 (15 minutes) */
  accessTokenTTL: number;

  /** Refresh token time-to-live in seconds. Default: 2592000 (30 days) */
  refreshTokenTTL: number;

  /** Secret key for HMAC signing (minimum 32 bytes recommended) */
  secret: string;

  /** JWT signing algorithm. Default: "HS256" */
  algorithm?: "HS256" | "HS384" | "HS512";

  /** Clock tolerance in seconds for token verification. Default: 5 */
  clockTolerance?: number;
}

/** Auth config with defaults applied */
export type ResolvedAuthConfig = Required<AuthConfig>;

// ─── Token Types ────────────────────────────────────────────────────────────

export interface TokenPayload {
  /** Subject — typically the user ID */
  sub: string;

  /** Roles assigned to the user */
  roles: string[];

  /** Additional custom claims */
  [key: string]: unknown;
}

export interface AccessToken {
  /** The signed JWT string */
  token: string;

  /** When this token expires (Unix timestamp in seconds) */
  expiresAt: number;
}

export interface RefreshToken {
  /** Opaque token identifier (stored in DB, sent to client) */
  token: string;

  /** The user this token belongs to */
  userId: string;

  /** Token family — used for rotation and reuse detection */
  family: string;

  /** When this token expires (Unix timestamp in seconds) */
  expiresAt: number;

  /** When this token was created (Unix timestamp in seconds) */
  createdAt: number;
}

// ─── User & Session ─────────────────────────────────────────────────────────

export interface AuthUser {
  /** Unique user identifier */
  id: string;

  /** User roles for authorization */
  roles: string[];
}

export interface Session {
  /** The access token (short-lived, stateless) */
  accessToken: AccessToken;

  /** The refresh token (long-lived, stored) */
  refreshToken: RefreshToken;
}

// ─── Token Store Interface ──────────────────────────────────────────────────

/**
 * Pluggable storage backend for refresh tokens.
 *
 * Why an interface? Production needs Redis or a database for persistence
 * and horizontal scaling. Development/testing needs a fast in-memory store.
 * This abstraction lets you swap without changing any auth logic.
 */
export interface TokenStore {
  /** Store a refresh token */
  save(token: RefreshToken): Promise<void>;

  /** Find a refresh token by its token string. Returns null if not found. May return expired tokens — caller checks expiry. */
  findByToken(token: string): Promise<RefreshToken | null>;

  /** Find all refresh tokens for a user */
  findByUserId(userId: string): Promise<RefreshToken[]>;

  /**
   * Find all refresh tokens in a token family.
   * Used for reuse detection — if a rotated-out token is reused,
   * we invalidate the entire family.
   */
  findByFamily(family: string): Promise<RefreshToken[]>;

  /** Delete a specific refresh token */
  delete(token: string): Promise<void>;

  /** Delete all refresh tokens in a family (reuse detection response) */
  deleteByFamily(family: string): Promise<void>;

  /** Delete all refresh tokens for a user (logout everywhere) */
  deleteByUserId(userId: string): Promise<void>;
}

// ─── Middleware Types ────────────────────────────────────────────────────────

/**
 * Framework-agnostic request representation.
 * Extract what you need from Express req, Hono c, Fastify request, etc.
 */
export interface AuthRequest {
  /** The Authorization header value (e.g., "Bearer eyJ...") */
  authorizationHeader?: string;

  /** Cookie value containing the access token (alternative to header) */
  cookieToken?: string;
}

/**
 * Result of successful authentication.
 */
export interface AuthResult {
  /** The authenticated user extracted from the token */
  user: AuthUser;

  /** The decoded token payload */
  payload: TokenPayload;
}

/**
 * Authentication error with machine-readable code.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: AuthErrorCode,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthErrorCode =
  | "TOKEN_MISSING"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "INSUFFICIENT_PERMISSIONS"
  | "REFRESH_TOKEN_NOT_FOUND"
  | "REFRESH_TOKEN_EXPIRED"
  | "REFRESH_TOKEN_REUSE_DETECTED";
