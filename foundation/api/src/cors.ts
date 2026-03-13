/**
 * CORS handler.
 *
 * Configurable origin allowlist, methods, headers, and preflight support.
 * Designed as middleware that can slot into the Router middleware chain.
 */

import type { ApiRequest, ApiResponse, CorsConfig, Middleware } from "./types.js";

const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const DEFAULT_HEADERS = ["Content-Type", "Authorization"] as const;
const DEFAULT_MAX_AGE = 86_400; // 24 hours

// ---------------------------------------------------------------------------
// Origin matching
// ---------------------------------------------------------------------------

function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.includes("*")) return true;
  return allowed.some((pattern) => {
    if (pattern === origin) return true;
    // Support simple wildcard subdomains: "*.example.com"
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".example.com"
      return origin.endsWith(suffix) || origin === `https://${pattern.slice(2)}` || origin === `http://${pattern.slice(2)}`;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// CORS header builder
// ---------------------------------------------------------------------------

function buildCorsHeaders(
  origin: string,
  config: CorsConfig,
  isPreflight: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // If wildcard and no credentials, use * for origin header
  if (config.origins.includes("*") && !config.credentials) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  if (config.credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  if (config.exposeHeaders && config.exposeHeaders.length > 0) {
    headers["Access-Control-Expose-Headers"] = config.exposeHeaders.join(", ");
  }

  if (isPreflight) {
    const methods = config.methods ?? [...DEFAULT_METHODS];
    headers["Access-Control-Allow-Methods"] = methods.join(", ");

    const allowHeaders = config.allowHeaders ?? [...DEFAULT_HEADERS];
    headers["Access-Control-Allow-Headers"] = allowHeaders.join(", ");

    headers["Access-Control-Max-Age"] = String(config.maxAge ?? DEFAULT_MAX_AGE);
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a CORS middleware.
 *
 * ```ts
 * const cors = createCorsMiddleware({
 *   origins: ["https://app.example.com"],
 *   credentials: true,
 * });
 * router.group({ prefix: "/api", middleware: [cors], routes: [...] });
 * ```
 */
export function createCorsMiddleware(config: CorsConfig): Middleware {
  return async (
    req: ApiRequest,
    next: () => Promise<ApiResponse<unknown>>,
  ): Promise<ApiResponse<unknown>> => {
    const origin = getOriginHeader(req);

    // No Origin header → not a CORS request, pass through
    if (!origin) {
      return next();
    }

    if (!isOriginAllowed(origin, config.origins)) {
      // Origin not allowed — respond without CORS headers
      return next();
    }

    // Preflight
    if (req.method === "OPTIONS") {
      const headers = buildCorsHeaders(origin, config, true);
      return {
        status: 204,
        headers,
        body: { ok: true, data: null },
      };
    }

    // Actual request — add CORS headers to response
    const response = await next();
    const corsHeaders = buildCorsHeaders(origin, config, false);
    return {
      ...response,
      headers: { ...response.headers, ...corsHeaders },
    };
  };
}

function getOriginHeader(req: ApiRequest): string | undefined {
  const raw = req.headers["origin"] ?? req.headers["Origin"];
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}

/** Utility: check if an origin is allowed by the given config. Exported for testing. */
export { isOriginAllowed };
