import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createAuthConfig,
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  authenticate,
  authenticateAndAuthorize,
  requireRoles,
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  MemoryTokenStore,
  AuthError,
} from "../src/index.js";
import type { ResolvedAuthConfig, TokenPayload, AuthResult } from "../src/index.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-key-that-is-at-least-32-characters-long!!";

function makeConfig(overrides?: Partial<ResolvedAuthConfig>): ResolvedAuthConfig {
  return createAuthConfig({
    issuer: "test-app",
    secret: TEST_SECRET,
    accessTokenTTL: 60, // 1 minute for faster tests
    refreshTokenTTL: 3600, // 1 hour
    ...overrides,
  });
}

// ─── Token Tests ────────────────────────────────────────────────────────────

describe("Access Tokens", () => {
  const config = makeConfig();

  it("should generate and verify a valid access token", async () => {
    const payload: TokenPayload = { sub: "user-1", roles: ["user", "admin"] };
    const accessToken = await generateAccessToken(payload, config);

    expect(accessToken.token).toBeDefined();
    expect(accessToken.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const decoded = await verifyAccessToken(accessToken.token, config);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.roles).toEqual(["user", "admin"]);
  });

  it("should include custom claims in the token", async () => {
    const payload: TokenPayload = {
      sub: "user-1",
      roles: ["user"],
      orgId: "org-42",
      tier: "pro",
    };
    const accessToken = await generateAccessToken(payload, config);
    const decoded = await verifyAccessToken(accessToken.token, config);

    expect(decoded.sub).toBe("user-1");
    expect(decoded["orgId"]).toBe("org-42");
    expect(decoded["tier"]).toBe("pro");
  });

  it("should reject an expired token", async () => {
    const shortConfig = makeConfig({ accessTokenTTL: 1 });
    const payload: TokenPayload = { sub: "user-1", roles: [] };
    const accessToken = await generateAccessToken(payload, shortConfig);

    // Wait for token to expire (1 second + clock tolerance buffer)
    await new Promise((r) => setTimeout(r, 7000));

    await expect(verifyAccessToken(accessToken.token, shortConfig)).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
  }, 10000);

  it("should reject a token with wrong secret", async () => {
    const payload: TokenPayload = { sub: "user-1", roles: [] };
    const accessToken = await generateAccessToken(payload, config);

    const otherConfig = makeConfig({ secret: "another-secret-that-is-also-32-chars-long!!" });
    await expect(verifyAccessToken(accessToken.token, otherConfig)).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });

  it("should reject a malformed token", async () => {
    await expect(verifyAccessToken("not-a-jwt", config)).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });
});

// ─── Refresh Token Tests ────────────────────────────────────────────────────

describe("Refresh Tokens", () => {
  let store: MemoryTokenStore;
  const config = makeConfig();

  beforeEach(() => {
    store = new MemoryTokenStore(0); // No auto-cleanup in tests
  });

  afterEach(() => {
    store.destroy();
  });

  it("should generate a refresh token and store it", async () => {
    const token = await generateRefreshToken("user-1", config, store);

    expect(token.token).toBeDefined();
    expect(token.userId).toBe("user-1");
    expect(token.family).toBeDefined();
    expect(token.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const found = await store.findByToken(token.token);
    expect(found).toEqual(token);
  });

  it("should rotate a refresh token (old invalidated, new issued)", async () => {
    const original = await generateRefreshToken("user-1", config, store);
    const { refreshToken: rotated, userId } = await rotateRefreshToken(
      original.token,
      config,
      store,
    );

    expect(userId).toBe("user-1");
    expect(rotated.token).not.toBe(original.token);
    expect(rotated.family).toBe(original.family); // Same family

    // Old token should be gone
    const oldFound = await store.findByToken(original.token);
    expect(oldFound).toBeNull();

    // New token should exist
    const newFound = await store.findByToken(rotated.token);
    expect(newFound).toEqual(rotated);
  });

  it("should reject a reused (already-rotated) refresh token", async () => {
    const original = await generateRefreshToken("user-1", config, store);
    const originalToken = original.token;

    // First rotation succeeds
    await rotateRefreshToken(originalToken, config, store);

    // Second use of the same token should fail
    await expect(rotateRefreshToken(originalToken, config, store)).rejects.toMatchObject({
      code: "REFRESH_TOKEN_NOT_FOUND",
    });
  });

  it("should reject an expired refresh token", async () => {
    const shortConfig = makeConfig({ refreshTokenTTL: 1 });
    const token = await generateRefreshToken("user-1", shortConfig, store);

    await new Promise((r) => setTimeout(r, 1500));

    await expect(rotateRefreshToken(token.token, shortConfig, store)).rejects.toMatchObject({
      code: "REFRESH_TOKEN_EXPIRED",
    });
  }, 5000);
});

// ─── Session Tests ──────────────────────────────────────────────────────────

describe("Sessions", () => {
  let store: MemoryTokenStore;
  const config = makeConfig();
  const testUser = { id: "user-1", roles: ["user"] };

  beforeEach(() => {
    store = new MemoryTokenStore(0);
  });

  afterEach(() => {
    store.destroy();
  });

  it("should create a session with access and refresh tokens", async () => {
    const session = await createSession(testUser, config, store);

    expect(session.accessToken.token).toBeDefined();
    expect(session.refreshToken.token).toBeDefined();
    expect(session.refreshToken.userId).toBe("user-1");

    // Access token should be valid
    const decoded = await verifyAccessToken(session.accessToken.token, config);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.roles).toEqual(["user"]);
  });

  it("should refresh a session (new tokens, old refresh token invalidated)", async () => {
    const session = await createSession(testUser, config, store);
    const oldRefreshToken = session.refreshToken.token;

    const newSession = await refreshSession(
      oldRefreshToken,
      ["user"], // Fresh roles
      config,
      store,
    );

    // New tokens should be different
    expect(newSession.accessToken.token).not.toBe(session.accessToken.token);
    expect(newSession.refreshToken.token).not.toBe(oldRefreshToken);

    // Old refresh token should be invalidated
    const oldFound = await store.findByToken(oldRefreshToken);
    expect(oldFound).toBeNull();

    // New refresh token should be valid
    const newFound = await store.findByToken(newSession.refreshToken.token);
    expect(newFound).not.toBeNull();
  });

  it("should revoke a single session", async () => {
    const session = await createSession(testUser, config, store);

    await revokeSession(session.refreshToken.token, store);

    const found = await store.findByToken(session.refreshToken.token);
    expect(found).toBeNull();
  });

  it("should revoke all sessions for a user", async () => {
    // Create multiple sessions (e.g., different devices)
    await createSession(testUser, config, store);
    await createSession(testUser, config, store);
    await createSession(testUser, config, store);

    const before = await store.findByUserId("user-1");
    expect(before.length).toBe(3);

    await revokeAllSessions("user-1", store);

    const after = await store.findByUserId("user-1");
    expect(after.length).toBe(0);
  });

  it("should include custom claims in session access token", async () => {
    const session = await createSession(testUser, config, store, {
      orgId: "org-99",
    });

    const decoded = await verifyAccessToken(session.accessToken.token, config);
    expect(decoded["orgId"]).toBe("org-99");
  });
});

// ─── Middleware Tests ───────────────────────────────────────────────────────

describe("Middleware", () => {
  let store: MemoryTokenStore;
  const config = makeConfig();

  beforeEach(() => {
    store = new MemoryTokenStore(0);
  });

  afterEach(() => {
    store.destroy();
  });

  it("should authenticate a valid Bearer token", async () => {
    const session = await createSession({ id: "user-1", roles: ["user"] }, config, store);

    const result = await authenticate(
      { authorizationHeader: `Bearer ${session.accessToken.token}` },
      config,
    );

    expect(result.user.id).toBe("user-1");
    expect(result.user.roles).toEqual(["user"]);
  });

  it("should authenticate from a cookie token", async () => {
    const session = await createSession({ id: "user-1", roles: ["user"] }, config, store);

    const result = await authenticate(
      { cookieToken: session.accessToken.token },
      config,
    );

    expect(result.user.id).toBe("user-1");
  });

  it("should reject when no token is provided", async () => {
    await expect(authenticate({}, config)).rejects.toMatchObject({
      code: "TOKEN_MISSING",
    });
  });

  it("should reject an expired token", async () => {
    const shortConfig = makeConfig({ accessTokenTTL: 1 });
    const session = await createSession({ id: "user-1", roles: [] }, shortConfig, store);

    await new Promise((r) => setTimeout(r, 7000));

    await expect(
      authenticate(
        { authorizationHeader: `Bearer ${session.accessToken.token}` },
        shortConfig,
      ),
    ).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
  }, 10000);

  it("should reject an invalid token", async () => {
    await expect(
      authenticate(
        { authorizationHeader: "Bearer invalid-token" },
        config,
      ),
    ).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });

  it("should enforce role requirements (pass)", async () => {
    const session = await createSession(
      { id: "user-1", roles: ["user", "admin"] },
      config,
      store,
    );

    const result = await authenticateAndAuthorize(
      { authorizationHeader: `Bearer ${session.accessToken.token}` },
      config,
      ["admin"],
    );

    expect(result.user.roles).toContain("admin");
  });

  it("should enforce role requirements (fail)", async () => {
    const session = await createSession(
      { id: "user-1", roles: ["user"] },
      config,
      store,
    );

    await expect(
      authenticateAndAuthorize(
        { authorizationHeader: `Bearer ${session.accessToken.token}` },
        config,
        ["admin"],
      ),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_PERMISSIONS",
    });
  });

  it("should pass requireRoles with any-of logic", () => {
    const result: AuthResult = {
      user: { id: "user-1", roles: ["editor", "viewer"] },
      payload: { sub: "user-1", roles: ["editor", "viewer"] },
    };

    // Has "editor", so should pass even though it doesn't have "admin"
    expect(() => requireRoles(result, ["admin", "editor"])).not.toThrow();
  });

  it("should skip role check when requiredRoles is empty", async () => {
    const session = await createSession(
      { id: "user-1", roles: [] },
      config,
      store,
    );

    const result = await authenticateAndAuthorize(
      { authorizationHeader: `Bearer ${session.accessToken.token}` },
      config,
      [],
    );

    expect(result.user.id).toBe("user-1");
  });
});

// ─── Password Tests ─────────────────────────────────────────────────────────

describe("Password", () => {
  it("should hash and verify a password", async () => {
    const hash = await hashPassword("MySecureP@ss1");
    expect(hash).toContain(":"); // salt:hash format

    const valid = await verifyPassword("MySecureP@ss1", hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword("wrong-password", hash);
    expect(invalid).toBe(false);
  });

  it("should produce different hashes for the same password (unique salts)", async () => {
    const hash1 = await hashPassword("SamePassword1!");
    const hash2 = await hashPassword("SamePassword1!");
    expect(hash1).not.toBe(hash2);
  });

  it("should reject malformed stored hashes", async () => {
    const result = await verifyPassword("test", "not-a-valid-hash");
    expect(result).toBe(false);
  });

  describe("Password Strength", () => {
    it("should accept a strong password", () => {
      const result = validatePasswordStrength("MyStr0ng!Pass");
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should reject a short password", () => {
      const result = validatePasswordStrength("Ab1!");
      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Password must be at least 8 characters long");
    });

    it("should require uppercase, lowercase, digit, and special char", () => {
      const result = validatePasswordStrength("alllowercase");
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });

    it("should rate a long valid password as strong", () => {
      const result = validatePasswordStrength("MyVeryStr0ng!Password");
      expect(result.strength).toBe("strong");
    });

    it("should rate a valid but short password as fair", () => {
      const result = validatePasswordStrength("Str0ng!P");
      expect(result.strength).toBe("fair");
    });
  });
});

// ─── Memory Store Tests ─────────────────────────────────────────────────────

describe("MemoryTokenStore", () => {
  let store: MemoryTokenStore;

  beforeEach(() => {
    store = new MemoryTokenStore(0);
  });

  afterEach(() => {
    store.destroy();
  });

  it("should track store size", async () => {
    const config = makeConfig();
    expect(store.size).toBe(0);

    await generateRefreshToken("user-1", config, store);
    expect(store.size).toBe(1);

    await generateRefreshToken("user-1", config, store);
    expect(store.size).toBe(2);
  });

  it("should clean up expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    await store.save({
      token: "expired-token",
      userId: "user-1",
      family: "fam-1",
      expiresAt: now - 100, // Already expired
      createdAt: now - 200,
    });
    await store.save({
      token: "valid-token",
      userId: "user-1",
      family: "fam-2",
      expiresAt: now + 3600, // Valid
      createdAt: now,
    });

    expect(store.size).toBe(2);
    store.cleanupExpired();
    expect(store.size).toBe(1);

    const found = await store.findByToken("valid-token");
    expect(found).not.toBeNull();
  });
});

// ─── Config Tests ───────────────────────────────────────────────────────────

describe("Config", () => {
  it("should create config with defaults", () => {
    const config = createAuthConfig({
      issuer: "myapp",
      secret: TEST_SECRET,
    });

    expect(config.issuer).toBe("myapp");
    expect(config.accessTokenTTL).toBe(900);
    expect(config.refreshTokenTTL).toBe(2_592_000);
    expect(config.algorithm).toBe("HS256");
    expect(config.clockTolerance).toBe(5);
  });

  it("should reject short secrets", () => {
    expect(() =>
      createAuthConfig({ issuer: "myapp", secret: "too-short" }),
    ).toThrow("at least 32 characters");
  });

  it("should allow overriding defaults", () => {
    const config = createAuthConfig({
      issuer: "myapp",
      secret: TEST_SECRET,
      accessTokenTTL: 300,
      algorithm: "HS512",
    });

    expect(config.accessTokenTTL).toBe(300);
    expect(config.algorithm).toBe("HS512");
  });
});
