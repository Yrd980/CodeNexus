import { describe, expect, it } from "vitest";
import {
  validationError,
  notFoundError,
  authenticationError,
  authorizationError,
  conflictError,
  externalServiceError,
  rateLimitError,
  internalError,
  isAppError,
  isErrorType,
  httpStatusFromCode,
  serializeError,
  deserializeError,
} from "../src/errors.js";
import type { ErrorCode } from "../src/types.js";

// ---------------------------------------------------------------------------
// Error creation
// ---------------------------------------------------------------------------

describe("error factory functions", () => {
  it("creates a ValidationError with fields", () => {
    const e = validationError("Bad input", {
      fields: { email: "required", name: "too short" },
      context: { requestId: "abc" },
    });
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toBe("Bad input");
    expect(e.fields).toEqual({ email: "required", name: "too short" });
    expect(e.context).toEqual({ requestId: "abc" });
  });

  it("creates a NotFoundError with resource info", () => {
    const e = notFoundError("User not found", {
      resource: "User",
      resourceId: "usr_123",
    });
    expect(e.code).toBe("NOT_FOUND");
    expect(e.resource).toBe("User");
    expect(e.resourceId).toBe("usr_123");
  });

  it("creates an AuthenticationError", () => {
    const e = authenticationError("Token expired");
    expect(e.code).toBe("AUTHENTICATION_ERROR");
    expect(e.message).toBe("Token expired");
  });

  it("creates an AuthorizationError with required permission", () => {
    const e = authorizationError("Forbidden", {
      requiredPermission: "admin:write",
    });
    expect(e.code).toBe("AUTHORIZATION_ERROR");
    expect(e.requiredPermission).toBe("admin:write");
  });

  it("creates a ConflictError", () => {
    const e = conflictError("Version mismatch");
    expect(e.code).toBe("CONFLICT");
  });

  it("creates an ExternalServiceError with service name", () => {
    const e = externalServiceError("Stripe timeout", { service: "stripe" });
    expect(e.code).toBe("EXTERNAL_SERVICE_ERROR");
    expect(e.service).toBe("stripe");
  });

  it("creates a RateLimitError with retry info", () => {
    const e = rateLimitError("Too many requests", { retryAfterMs: 30_000 });
    expect(e.code).toBe("RATE_LIMIT_ERROR");
    expect(e.retryAfterMs).toBe(30_000);
  });

  it("creates an InternalError with cause", () => {
    const cause = new Error("underlying");
    const e = internalError("Something broke", { cause });
    expect(e.code).toBe("INTERNAL_ERROR");
    expect(e.cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// Type guards / matching
// ---------------------------------------------------------------------------

describe("isAppError", () => {
  it("returns true for valid AppError objects", () => {
    expect(isAppError(validationError("test"))).toBe(true);
    expect(isAppError(notFoundError("test"))).toBe(true);
    expect(isAppError(internalError("test"))).toBe(true);
  });

  it("returns false for non-AppError values", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError("string")).toBe(false);
    expect(isAppError(42)).toBe(false);
    expect(isAppError({})).toBe(false);
    expect(isAppError({ code: 123 })).toBe(false);
    expect(isAppError({ message: "hi" })).toBe(false);
    expect(isAppError(new Error("native"))).toBe(false);
  });

  it("returns true for plain objects matching the shape", () => {
    expect(isAppError({ code: "CUSTOM", message: "custom error" })).toBe(true);
  });
});

describe("isErrorType", () => {
  it("narrows to specific error type", () => {
    const e = notFoundError("gone", { resource: "User", resourceId: "1" });
    if (isErrorType(e, "NOT_FOUND")) {
      // TypeScript narrows to NotFoundError here
      expect(e.resource).toBe("User");
      expect(e.resourceId).toBe("1");
    } else {
      throw new Error("should have matched");
    }
  });

  it("returns false for non-matching code", () => {
    const e = validationError("bad");
    expect(isErrorType(e, "NOT_FOUND")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP status mapping
// ---------------------------------------------------------------------------

describe("httpStatusFromCode", () => {
  const cases: [ErrorCode, number][] = [
    ["VALIDATION_ERROR", 400],
    ["AUTHENTICATION_ERROR", 401],
    ["AUTHORIZATION_ERROR", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["RATE_LIMIT_ERROR", 429],
    ["INTERNAL_ERROR", 500],
    ["EXTERNAL_SERVICE_ERROR", 502],
  ];

  it.each(cases)("maps %s to %d", (code, expectedStatus) => {
    expect(httpStatusFromCode(code)).toBe(expectedStatus);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("serializeError", () => {
  it("produces a minimal safe object in production mode", () => {
    const e = notFoundError("User not found", {
      resource: "User",
      context: { query: "SELECT *" },
    });
    const serialized = serializeError(e, false);
    expect(serialized).toEqual({
      code: "NOT_FOUND",
      message: "User not found",
    });
    // context should NOT be exposed
    expect(serialized.context).toBeUndefined();
    expect(serialized.stack).toBeUndefined();
  });

  it("includes context and stack in development mode", () => {
    const cause = new Error("db timeout");
    const e = internalError("Something broke", {
      cause,
      context: { query: "SELECT 1" },
    });
    const serialized = serializeError(e, true);
    expect(serialized.code).toBe("INTERNAL_ERROR");
    expect(serialized.context).toEqual({ query: "SELECT 1" });
    expect(serialized.stack).toBeDefined();
  });

  it("includes field errors for ValidationError", () => {
    const e = validationError("Bad input", {
      fields: { email: "invalid" },
    });
    const serialized = serializeError(e, false);
    expect(serialized.fields).toEqual({ email: "invalid" });
  });
});

describe("deserializeError", () => {
  it("round-trips through serialize → deserialize", () => {
    const original = notFoundError("Gone");
    const serialized = serializeError(original, false);
    const deserialized = deserializeError(serialized);
    expect(deserialized.code).toBe("NOT_FOUND");
    expect(deserialized.message).toBe("Gone");
  });

  it("preserves context when serialized in dev mode", () => {
    const original = internalError("Boom", {
      context: { traceId: "t-123" },
    });
    const serialized = serializeError(original, true);
    const deserialized = deserializeError(serialized);
    expect(deserialized.context).toEqual({ traceId: "t-123" });
  });
});
