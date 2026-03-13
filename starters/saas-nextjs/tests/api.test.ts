import { describe, it, expect, vi } from "vitest";
import {
  buildUrl,
  mergeHeaders,
  parseResponse,
  createApiClient,
  ApiClientError,
} from "../src/lib/api.js";

// ─── URL Building ───────────────────────────────────────────

describe("buildUrl", () => {
  it("joins base and path", () => {
    expect(buildUrl("https://api.example.com", "/users")).toBe(
      "https://api.example.com/users"
    );
  });

  it("handles trailing slash on base", () => {
    expect(buildUrl("https://api.example.com/", "/users")).toBe(
      "https://api.example.com/users"
    );
  });

  it("handles missing leading slash on path", () => {
    expect(buildUrl("https://api.example.com", "users")).toBe(
      "https://api.example.com/users"
    );
  });

  it("handles both trailing and missing slashes", () => {
    expect(buildUrl("https://api.example.com/", "users")).toBe(
      "https://api.example.com/users"
    );
  });
});

// ─── Header Merging ─────────────────────────────────────────

describe("mergeHeaders", () => {
  it("includes Content-Type by default", () => {
    const headers = mergeHeaders({});
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("merges config headers", () => {
    const headers = mergeHeaders({ Authorization: "Bearer token" });
    expect(headers["Authorization"]).toBe("Bearer token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("request headers override config headers", () => {
    const headers = mergeHeaders(
      { "Content-Type": "application/json" },
      { "Content-Type": "text/plain" }
    );
    expect(headers["Content-Type"]).toBe("text/plain");
  });

  it("handles undefined request headers", () => {
    const headers = mergeHeaders({ "X-Custom": "value" }, undefined);
    expect(headers["X-Custom"]).toBe("value");
  });
});

// ─── Response Parsing ───────────────────────────────────────

describe("parseResponse", () => {
  it("parses successful JSON response", async () => {
    const response = new Response(JSON.stringify({ id: 1, name: "Test" }), {
      status: 200,
    });

    const result = await parseResponse<{ id: number; name: string }>(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(1);
      expect(result.data.name).toBe("Test");
    }
  });

  it("parses error response with error body", async () => {
    const response = new Response(
      JSON.stringify({ code: "NOT_FOUND", message: "User not found" }),
      { status: 404 }
    );

    const result = await parseResponse(response);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.message).toBe("User not found");
    }
  });

  it("handles non-JSON response", async () => {
    const response = new Response("Internal Server Error", { status: 500 });

    const result = await parseResponse(response);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PARSE_ERROR");
    }
  });

  it("handles error response without standard error body", async () => {
    const response = new Response(JSON.stringify({ detail: "forbidden" }), {
      status: 403,
    });

    const result = await parseResponse(response);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("HTTP_403");
    }
  });
});

// ─── API Client ─────────────────────────────────────────────

describe("createApiClient", () => {
  it("makes GET requests", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ users: [] }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const api = createApiClient({ baseUrl: "https://api.example.com" });
    const result = await api.get<{ users: unknown[] }>("/users");

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/users",
      expect.objectContaining({ method: "GET" })
    );

    vi.unstubAllGlobals();
  });

  it("makes POST requests with body", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), { status: 201 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const api = createApiClient({ baseUrl: "https://api.example.com" });
    await api.post("/users", { name: "Test" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
      })
    );

    vi.unstubAllGlobals();
  });

  it("handles network errors", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const api = createApiClient({ baseUrl: "https://api.example.com" });
    const result = await api.get("/users");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.message).toBe("Network error");
    }

    vi.unstubAllGlobals();
  });

  it("calls onError callback on failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const onError = vi.fn();
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      onError,
    });
    await api.get("/users");

    expect(onError).toHaveBeenCalledWith(expect.any(ApiClientError));

    vi.unstubAllGlobals();
  });

  it("includes custom headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const api = createApiClient({
      baseUrl: "https://api.example.com",
      headers: { Authorization: "Bearer token123" },
    });
    await api.get("/users");

    const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(callHeaders["Authorization"]).toBe("Bearer token123");

    vi.unstubAllGlobals();
  });
});
