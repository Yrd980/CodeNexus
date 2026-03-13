/**
 * Next.js middleware pattern for a SaaS application.
 *
 * Middleware runs on the Edge Runtime BEFORE your page/API route.
 * It's the first line of defense for:
 * - Authentication: redirect unauthenticated users to login
 * - Rate limiting: block abusive requests before they hit your app
 * - CORS: handle cross-origin requests for your API
 * - Logging: capture request metadata for observability
 *
 * Why middleware instead of per-route checks?
 * - Catches unauthorized requests before any page code runs
 * - Consistent behavior across all routes
 * - Runs on the edge = low latency
 *
 * Limitation: Edge Runtime can't access Node.js APIs or your database.
 * Use lightweight checks (JWT verification, cookie presence) here,
 * and do full DB session validation in Server Components.
 */

import { isProtectedRoute } from "./config/auth.js";

// ─── Types ──────────────────────────────────────────────────

export interface MiddlewareRequest {
  url: string;
  pathname: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip?: string;
}

export interface MiddlewareResponse {
  status: number;
  headers: Record<string, string>;
  redirect?: string;
  body?: string;
}

// ─── Rate Limiting (in-memory, per-instance) ────────────────

/**
 * Simple sliding-window rate limiter.
 *
 * WARNING: This is per-instance, not distributed.
 * For production, use Redis or a rate limiting service (e.g., Upstash).
 *
 * Why include it anyway?
 * - Shows the pattern for how rate limiting integrates with middleware
 * - Provides basic protection during development
 * - Easy to swap the storage backend later
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 100, windowMs: number = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    // No entry or window expired — start fresh
    if (!entry || now > entry.resetAt) {
      const resetAt = now + this.windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt };
    }

    // Within window — increment and check
    entry.count++;
    const remaining = Math.max(0, this.maxRequests - entry.count);
    return {
      allowed: entry.count <= this.maxRequests,
      remaining,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Clean up expired entries to prevent memory leaks.
   * Call this periodically (e.g., every minute).
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

// ─── CORS Headers ───────────────────────────────────────────

/**
 * CORS configuration.
 *
 * Why handle CORS in middleware?
 * - Consistent headers across all API routes
 * - Preflight (OPTIONS) requests are handled before they reach your routes
 * - Easy to configure per-environment allowed origins
 */
export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAge: number;
}

const defaultCorsConfig: CorsConfig = {
  allowedOrigins: ["http://localhost:3000"],
  allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400, // 24 hours
};

export function getCorsHeaders(
  origin: string | undefined,
  config: CorsConfig = defaultCorsConfig
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": config.allowedMethods.join(", "),
    "Access-Control-Allow-Headers": config.allowedHeaders.join(", "),
    "Access-Control-Max-Age": String(config.maxAge),
  };

  // Only set Allow-Origin if the request origin is in the allowlist
  if (origin && config.allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

// ─── Request Logging ────────────────────────────────────────

export interface RequestLog {
  timestamp: string;
  method: string;
  pathname: string;
  ip: string | undefined;
  userAgent: string | undefined;
  durationMs?: number;
}

export function createRequestLog(req: MiddlewareRequest): RequestLog {
  return {
    timestamp: new Date().toISOString(),
    method: req.method,
    pathname: req.pathname,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

// ─── Middleware Orchestrator ─────────────────────────────────

/**
 * Process a request through the middleware pipeline.
 *
 * Returns a MiddlewareResponse that tells the framework what to do:
 * - status 200: continue to the route handler
 * - status 302: redirect (e.g., to login)
 * - status 429: rate limited
 * - status 204: CORS preflight response
 *
 * Pattern: Chain of checks, early-return on failure.
 */
export function processMiddleware(
  req: MiddlewareRequest,
  options: {
    rateLimiter?: RateLimiter;
    corsConfig?: CorsConfig;
    loginPath?: string;
    sessionCookieName?: string;
  } = {}
): MiddlewareResponse {
  const {
    rateLimiter,
    corsConfig = defaultCorsConfig,
    loginPath = "/login",
    sessionCookieName = "session-token",
  } = options;

  const responseHeaders: Record<string, string> = {};

  // 1. CORS preflight
  if (req.method === "OPTIONS" && req.pathname.startsWith("/api")) {
    const corsHeaders = getCorsHeaders(req.headers["origin"], corsConfig);
    return {
      status: 204,
      headers: corsHeaders,
    };
  }

  // 2. CORS headers for API routes
  if (req.pathname.startsWith("/api")) {
    const corsHeaders = getCorsHeaders(req.headers["origin"], corsConfig);
    Object.assign(responseHeaders, corsHeaders);
  }

  // 3. Rate limiting
  if (rateLimiter) {
    const key = req.ip ?? "unknown";
    const result = rateLimiter.check(key);
    responseHeaders["X-RateLimit-Remaining"] = String(result.remaining);
    responseHeaders["X-RateLimit-Reset"] = String(result.resetAt);

    if (!result.allowed) {
      return {
        status: 429,
        headers: {
          ...responseHeaders,
          "Retry-After": String(
            Math.ceil((result.resetAt - Date.now()) / 1000)
          ),
        },
        body: JSON.stringify({
          error: { code: "RATE_LIMITED", message: "Too many requests" },
        }),
      };
    }
  }

  // 4. Auth check for protected routes
  if (isProtectedRoute(req.pathname)) {
    const hasSession = hasSessionCookie(req.headers, sessionCookieName);
    if (!hasSession) {
      const redirectUrl = `${loginPath}?redirect=${encodeURIComponent(req.pathname)}`;
      return {
        status: 302,
        headers: responseHeaders,
        redirect: redirectUrl,
      };
    }
  }

  // 5. All checks passed — continue
  return {
    status: 200,
    headers: responseHeaders,
  };
}

/**
 * Check if the request has a session cookie.
 *
 * This is a lightweight check — presence only, not validation.
 * Full session validation happens in Server Components / API routes
 * where you have access to the database.
 */
function hasSessionCookie(
  headers: Record<string, string | undefined>,
  cookieName: string
): boolean {
  const cookieHeader = headers["cookie"];
  if (!cookieHeader) return false;
  return cookieHeader.includes(`${cookieName}=`);
}

/**
 * Next.js middleware config — which paths to run middleware on.
 *
 * Pattern: Match all paths except static assets and Next.js internals.
 * This is configured in next.config.js via the `matcher` option.
 */
export const middlewareConfig = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
