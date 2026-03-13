import { describe, it, expect, vi } from "vitest";
import {
  hasMinimumRole,
  extractSessionToken,
  parseCookies,
  getSession,
  requireAuth,
  AuthError,
} from "../src/lib/auth.js";
import type { SessionStore } from "../src/lib/auth.js";
import type { Session, User, Team } from "../src/types/index.js";

// ─── Test Fixtures ──────────────────────────────────────────

function makeUser(overrides?: Partial<User>): User {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    avatarUrl: null,
    role: "member",
    teamId: "team-1",
    emailVerified: true,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    user: makeUser(),
    team: {
      id: "team-1",
      name: "Test Team",
      slug: "test-team",
      ownerId: "user-1",
      planId: "pro",
      subscriptionId: "sub-1",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    },
    accessToken: "test-token",
    expiresAt: new Date(Date.now() + 86400000), // 1 day from now
    ...overrides,
  };
}

function makeMockStore(session: Session | null): SessionStore {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    createSession: vi.fn().mockResolvedValue(session),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Role Hierarchy ─────────────────────────────────────────

describe("hasMinimumRole", () => {
  it("owner has all roles", () => {
    expect(hasMinimumRole("owner", "owner")).toBe(true);
    expect(hasMinimumRole("owner", "admin")).toBe(true);
    expect(hasMinimumRole("owner", "member")).toBe(true);
    expect(hasMinimumRole("owner", "viewer")).toBe(true);
  });

  it("viewer only has viewer role", () => {
    expect(hasMinimumRole("viewer", "viewer")).toBe(true);
    expect(hasMinimumRole("viewer", "member")).toBe(false);
    expect(hasMinimumRole("viewer", "admin")).toBe(false);
    expect(hasMinimumRole("viewer", "owner")).toBe(false);
  });

  it("member meets member and viewer requirements", () => {
    expect(hasMinimumRole("member", "member")).toBe(true);
    expect(hasMinimumRole("member", "viewer")).toBe(true);
    expect(hasMinimumRole("member", "admin")).toBe(false);
  });

  it("admin meets admin, member, and viewer requirements", () => {
    expect(hasMinimumRole("admin", "admin")).toBe(true);
    expect(hasMinimumRole("admin", "member")).toBe(true);
    expect(hasMinimumRole("admin", "viewer")).toBe(true);
    expect(hasMinimumRole("admin", "owner")).toBe(false);
  });
});

// ─── Token Extraction ───────────────────────────────────────

describe("extractSessionToken", () => {
  it("extracts token from Bearer header", () => {
    const token = extractSessionToken({
      authorization: "Bearer my-token-123",
    });
    expect(token).toBe("my-token-123");
  });

  it("extracts token from cookie header", () => {
    const token = extractSessionToken({
      cookie: "session-token=cookie-token-456; other=value",
    });
    expect(token).toBe("cookie-token-456");
  });

  it("prefers Bearer header over cookie", () => {
    const token = extractSessionToken({
      authorization: "Bearer bearer-token",
      cookie: "session-token=cookie-token",
    });
    expect(token).toBe("bearer-token");
  });

  it("returns null when no auth info present", () => {
    expect(extractSessionToken({})).toBeNull();
  });

  it("supports custom cookie name", () => {
    const token = extractSessionToken(
      { cookie: "my-session=abc123" },
      "my-session"
    );
    expect(token).toBe("abc123");
  });
});

describe("parseCookies", () => {
  it("parses a single cookie", () => {
    expect(parseCookies("name=value")).toEqual({ name: "value" });
  });

  it("parses multiple cookies", () => {
    expect(parseCookies("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("handles cookies with = in value", () => {
    expect(parseCookies("token=abc=def")).toEqual({ token: "abc=def" });
  });

  it("trims whitespace", () => {
    expect(parseCookies("  name = value ")).toEqual({ name: "value" });
  });

  it("returns empty object for empty string", () => {
    expect(parseCookies("")).toEqual({});
  });
});

// ─── Session Management ─────────────────────────────────────

describe("getSession", () => {
  it("returns session for valid token", async () => {
    const session = makeSession();
    const store = makeMockStore(session);
    const headers = { authorization: "Bearer valid-token" };

    const result = await getSession(headers, store);
    expect(result).toBe(session);
    expect(store.getSession).toHaveBeenCalledWith("valid-token");
  });

  it("returns null when no token present", async () => {
    const store = makeMockStore(makeSession());
    const result = await getSession({}, store);
    expect(result).toBeNull();
  });

  it("returns null when session not found", async () => {
    const store = makeMockStore(null);
    const headers = { authorization: "Bearer invalid-token" };

    const result = await getSession(headers, store);
    expect(result).toBeNull();
  });

  it("deletes and returns null for expired session", async () => {
    const expiredSession = makeSession({
      expiresAt: new Date(Date.now() - 1000),
    });
    const store = makeMockStore(expiredSession);
    const headers = { authorization: "Bearer expired-token" };

    const result = await getSession(headers, store);
    expect(result).toBeNull();
    expect(store.deleteSession).toHaveBeenCalledWith("expired-token");
  });
});

describe("requireAuth", () => {
  it("returns session for authenticated user", async () => {
    const session = makeSession();
    const store = makeMockStore(session);
    const headers = { authorization: "Bearer valid-token" };

    const result = await requireAuth(headers, store);
    expect(result).toBe(session);
  });

  it("throws AuthError when not authenticated", async () => {
    const store = makeMockStore(null);
    const headers = { authorization: "Bearer invalid-token" };

    await expect(requireAuth(headers, store)).rejects.toThrow(AuthError);
    await expect(requireAuth(headers, store)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws FORBIDDEN when role is insufficient", async () => {
    const session = makeSession({
      user: makeUser({ role: "viewer" }),
    });
    const store = makeMockStore(session);
    const headers = { authorization: "Bearer valid-token" };

    await expect(requireAuth(headers, store, "admin")).rejects.toThrow(
      AuthError
    );
    await expect(
      requireAuth(headers, store, "admin")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("succeeds when role meets requirement", async () => {
    const session = makeSession({
      user: makeUser({ role: "admin" }),
    });
    const store = makeMockStore(session);
    const headers = { authorization: "Bearer valid-token" };

    const result = await requireAuth(headers, store, "member");
    expect(result).toBe(session);
  });
});
