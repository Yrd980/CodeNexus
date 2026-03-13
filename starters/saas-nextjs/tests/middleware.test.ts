import { describe, it, expect } from "vitest";
import {
  RateLimiter,
  getCorsHeaders,
  createRequestLog,
  processMiddleware,
} from "../src/middleware.js";
import type { MiddlewareRequest } from "../src/middleware.js";

// ─── Test Fixtures ──────────────────────────────────────────

function makeRequest(overrides?: Partial<MiddlewareRequest>): MiddlewareRequest {
  return {
    url: "https://example.com/dashboard",
    pathname: "/dashboard",
    method: "GET",
    headers: {},
    ip: "127.0.0.1",
    ...overrides,
  };
}

// ─── Rate Limiter ───────────────────────────────────────────

describe("RateLimiter", () => {
  it("allows requests under limit", () => {
    const limiter = new RateLimiter(5, 60_000);
    const result = limiter.check("user-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("blocks requests over limit", () => {
    const limiter = new RateLimiter(3, 60_000);
    limiter.check("user-1");
    limiter.check("user-1");
    limiter.check("user-1");
    const result = limiter.check("user-1");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("tracks separate keys independently", () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.check("user-1");
    limiter.check("user-1");
    const result = limiter.check("user-2");
    expect(result.allowed).toBe(true);
  });

  it("cleans up expired entries", () => {
    const limiter = new RateLimiter(100, 1); // 1ms window
    limiter.check("user-1");
    // Wait slightly longer than the window so it expires
    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }
    limiter.cleanup();
    // After cleanup, a new check should start fresh
    const result = limiter.check("user-1");
    expect(result.remaining).toBe(99);
  });
});

// ─── CORS ───────────────────────────────────────────────────

describe("getCorsHeaders", () => {
  it("sets allowed origin for matching origin", () => {
    const headers = getCorsHeaders("http://localhost:3000");
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:3000"
    );
  });

  it("omits allowed origin for non-matching origin", () => {
    const headers = getCorsHeaders("https://evil.com");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("includes allowed methods", () => {
    const headers = getCorsHeaders("http://localhost:3000");
    expect(headers["Access-Control-Allow-Methods"]).toContain("GET");
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
  });

  it("respects custom config", () => {
    const headers = getCorsHeaders("https://myapp.com", {
      allowedOrigins: ["https://myapp.com"],
      allowedMethods: ["GET"],
      allowedHeaders: ["Authorization"],
      maxAge: 3600,
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://myapp.com");
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET");
  });
});

// ─── Request Logging ────────────────────────────────────────

describe("createRequestLog", () => {
  it("captures request details", () => {
    const req = makeRequest({
      method: "POST",
      pathname: "/api/v1/users",
      headers: { "user-agent": "TestBot/1.0" },
    });
    const log = createRequestLog(req);

    expect(log.method).toBe("POST");
    expect(log.pathname).toBe("/api/v1/users");
    expect(log.userAgent).toBe("TestBot/1.0");
    expect(log.timestamp).toBeDefined();
  });
});

// ─── Middleware Orchestrator ─────────────────────────────────

describe("processMiddleware", () => {
  it("redirects unauthenticated requests to protected routes", () => {
    const req = makeRequest({ pathname: "/dashboard" });
    const result = processMiddleware(req);

    expect(result.status).toBe(302);
    expect(result.redirect).toContain("/login");
    expect(result.redirect).toContain("redirect=%2Fdashboard");
  });

  it("allows requests to public routes without auth", () => {
    const req = makeRequest({ pathname: "/" });
    const result = processMiddleware(req);
    expect(result.status).toBe(200);
  });

  it("allows authenticated requests to protected routes", () => {
    const req = makeRequest({
      pathname: "/dashboard",
      headers: { cookie: "session-token=abc123" },
    });
    const result = processMiddleware(req);
    expect(result.status).toBe(200);
  });

  it("handles CORS preflight for API routes", () => {
    const req = makeRequest({
      pathname: "/api/v1/users",
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000" },
    });
    const result = processMiddleware(req);
    expect(result.status).toBe(204);
    expect(result.headers["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:3000"
    );
  });

  it("returns 429 when rate limited", () => {
    const rateLimiter = new RateLimiter(1, 60_000);
    const req = makeRequest({ pathname: "/" });

    processMiddleware(req, { rateLimiter }); // first request — allowed
    const result = processMiddleware(req, { rateLimiter }); // second — blocked

    expect(result.status).toBe(429);
    expect(result.headers["Retry-After"]).toBeDefined();
  });

  it("allows webhook routes without auth", () => {
    const req = makeRequest({ pathname: "/api/webhooks/stripe" });
    const result = processMiddleware(req);
    expect(result.status).toBe(200);
  });
});
