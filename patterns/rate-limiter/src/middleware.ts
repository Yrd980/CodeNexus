/**
 * Framework-Agnostic Rate Limiting Middleware
 *
 * Provides a thin wrapper that:
 *   1. Extracts a key from the incoming request via a user-supplied function.
 *   2. Runs the rate-limit check.
 *   3. Returns standard HTTP headers and status metadata so the caller can
 *      apply them to *any* HTTP framework (Express, Fastify, Hono, etc.).
 *
 * This module intentionally does NOT depend on any framework — it only works
 * with plain objects so integrating it is a one-liner in your framework of
 * choice.
 */

import type { RateLimiter, RateLimitResult } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal request representation — just enough for key extraction. */
export interface RateLimitRequest {
  /** Remote IP address (often available as `req.ip` or `req.socket.remoteAddress`). */
  ip?: string;
  /** Parsed headers object — keys should be lowercase. */
  headers?: Record<string, string | string[] | undefined>;
  /** Any additional context (user ID, API key, etc.). */
  [key: string]: unknown;
}

/**
 * Function that derives a rate-limit key from the request.
 * Return `null` to skip rate limiting for this request.
 */
export type KeyExtractor = (req: RateLimitRequest) => string | null;

/** The middleware result — everything the framework adapter needs. */
export interface RateLimitMiddlewareResult {
  /** HTTP status code to send (200 when allowed, 429 when denied). */
  status: number;
  /** Headers to set on the HTTP response. */
  headers: Record<string, string>;
  /** The underlying rate-limit result for advanced consumers. */
  rateLimitResult: RateLimitResult;
}

export interface RateLimitMiddlewareOptions {
  /** The rate limiter instance to use. */
  limiter: RateLimiter;
  /** Derives a key from the request. Defaults to `req.ip ?? "unknown"`. */
  keyExtractor?: KeyExtractor;
}

// ---------------------------------------------------------------------------
// Built-in key extractors
// ---------------------------------------------------------------------------

/** Extract key from IP address (the most common default). */
export const keyByIp: KeyExtractor = (req) => req.ip ?? "unknown";

/** Extract key from the `authorization` header (e.g. per-API-key limits). */
export const keyByAuthHeader: KeyExtractor = (req) => {
  const auth = req.headers?.["authorization"];
  if (typeof auth === "string" && auth.length > 0) return auth;
  return null;
};

/**
 * Build a key extractor that reads a specific header.
 *
 * @example
 * const byApiKey = keyByHeader("x-api-key");
 */
export function keyByHeader(headerName: string): KeyExtractor {
  const lower = headerName.toLowerCase();
  return (req) => {
    const value = req.headers?.[lower];
    if (typeof value === "string" && value.length > 0) return value;
    return null;
  };
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a framework-agnostic rate-limit handler.
 *
 * @example
 * ```ts
 * const handler = createRateLimitMiddleware({
 *   limiter: new FixedWindowRateLimiter({ windowSize: 60_000, maxRequests: 100 }),
 *   keyExtractor: keyByIp,
 * });
 *
 * // Express
 * app.use(async (req, res, next) => {
 *   const { status, headers } = await handler(req);
 *   for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
 *   if (status === 429) return res.status(429).json({ error: "Too many requests" });
 *   next();
 * });
 * ```
 */
export function createRateLimitMiddleware(
  options: RateLimitMiddlewareOptions,
): (req: RateLimitRequest) => Promise<RateLimitMiddlewareResult> {
  const { limiter, keyExtractor = keyByIp } = options;

  return async (req: RateLimitRequest): Promise<RateLimitMiddlewareResult> => {
    const key = keyExtractor(req);

    // If the extractor returns null, allow the request without consuming quota.
    if (key === null) {
      return {
        status: 200,
        headers: {},
        rateLimitResult: {
          allowed: true,
          remaining: -1,
          resetAt: 0,
          limit: 0,
          retryAfter: 0,
        },
      };
    }

    const result = await limiter.check(key);

    const headers: Record<string, string> = {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    };

    if (!result.allowed) {
      headers["Retry-After"] = String(result.retryAfter);
    }

    return {
      status: result.allowed ? 200 : 429,
      headers,
      rateLimitResult: result,
    };
  };
}
