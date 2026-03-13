import { describe, expect, it } from "vitest";
import { createCorsMiddleware, isOriginAllowed } from "../src/cors.js";
import type { ApiRequest, ApiResponse } from "../src/types.js";

function makeRequest(
  overrides: Partial<ApiRequest> = {},
): ApiRequest {
  return {
    method: "GET",
    path: "/",
    headers: {},
    query: {},
    params: {},
    body: null,
    ...overrides,
  };
}

const dummyNext = async (): Promise<ApiResponse<unknown>> => ({
  status: 200,
  headers: {},
  body: { ok: true, data: "ok" },
});

describe("isOriginAllowed", () => {
  it("allows exact match", () => {
    expect(isOriginAllowed("https://app.example.com", ["https://app.example.com"])).toBe(true);
  });

  it("rejects non-matching origin", () => {
    expect(isOriginAllowed("https://evil.com", ["https://app.example.com"])).toBe(false);
  });

  it("allows wildcard *", () => {
    expect(isOriginAllowed("https://anything.com", ["*"])).toBe(true);
  });

  it("allows wildcard subdomain pattern", () => {
    expect(
      isOriginAllowed("https://sub.example.com", ["*.example.com"]),
    ).toBe(true);
  });

  it("rejects non-matching subdomain", () => {
    expect(
      isOriginAllowed("https://sub.evil.com", ["*.example.com"]),
    ).toBe(false);
  });
});

describe("createCorsMiddleware", () => {
  it("passes through when no Origin header", async () => {
    const cors = createCorsMiddleware({ origins: ["https://app.example.com"] });
    const res = await cors(makeRequest(), dummyNext);
    expect(res.status).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("adds CORS headers for allowed origin", async () => {
    const cors = createCorsMiddleware({ origins: ["https://app.example.com"] });
    const req = makeRequest({
      headers: { origin: "https://app.example.com" },
    });
    const res = await cors(req, dummyNext);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(res.headers["Vary"]).toBe("Origin");
  });

  it("does not add headers for disallowed origin", async () => {
    const cors = createCorsMiddleware({ origins: ["https://app.example.com"] });
    const req = makeRequest({
      headers: { origin: "https://evil.com" },
    });
    const res = await cors(req, dummyNext);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("handles preflight OPTIONS request", async () => {
    const cors = createCorsMiddleware({
      origins: ["https://app.example.com"],
      methods: ["GET", "POST"],
      allowHeaders: ["Content-Type", "X-Custom"],
    });
    const req = makeRequest({
      method: "OPTIONS",
      headers: { origin: "https://app.example.com" },
    });
    const res = await cors(req, dummyNext);
    expect(res.status).toBe(204);
    expect(res.headers["Access-Control-Allow-Methods"]).toBe("GET, POST");
    expect(res.headers["Access-Control-Allow-Headers"]).toBe("Content-Type, X-Custom");
    expect(res.headers["Access-Control-Max-Age"]).toBeDefined();
  });

  it("sets credentials header when configured", async () => {
    const cors = createCorsMiddleware({
      origins: ["https://app.example.com"],
      credentials: true,
    });
    const req = makeRequest({
      headers: { origin: "https://app.example.com" },
    });
    const res = await cors(req, dummyNext);
    expect(res.headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("uses * for wildcard without credentials", async () => {
    const cors = createCorsMiddleware({ origins: ["*"] });
    const req = makeRequest({
      headers: { origin: "https://anything.com" },
    });
    const res = await cors(req, dummyNext);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(res.headers["Vary"]).toBeUndefined();
  });

  it("sets expose headers when configured", async () => {
    const cors = createCorsMiddleware({
      origins: ["*"],
      exposeHeaders: ["X-Total-Count"],
    });
    const req = makeRequest({
      headers: { origin: "https://test.com" },
    });
    const res = await cors(req, dummyNext);
    expect(res.headers["Access-Control-Expose-Headers"]).toBe("X-Total-Count");
  });
});
