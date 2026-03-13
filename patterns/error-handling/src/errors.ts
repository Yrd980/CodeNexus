/**
 * Structured error hierarchy and utilities.
 *
 * Every application error carries a machine-readable `code`, a human-readable
 * `message`, optional `cause` (for wrapping upstream errors), and optional
 * `context` (structured metadata for logging / debugging).
 *
 * Why a hierarchy instead of ad-hoc error strings?
 * - Consistent API responses across the entire codebase
 * - Exhaustive `switch` on `code` catches missing cases at compile time
 * - Structured `context` makes logs grep-able without parsing messages
 */

import type {
  AnyAppError,
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ErrorCode,
  ExternalServiceError,
  InternalError,
  NotFoundError,
  RateLimitError,
  SerializedError,
  ValidationError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a `ValidationError`.
 *
 * @example
 * ```ts
 * validationError("Invalid email format", { fields: { email: "must contain @" } });
 * ```
 */
export function validationError(
  message: string,
  opts?: {
    fields?: Record<string, string>;
    cause?: unknown;
    context?: Record<string, unknown>;
  },
): ValidationError {
  return {
    code: "VALIDATION_ERROR",
    message,
    fields: opts?.fields,
    cause: opts?.cause,
    context: opts?.context,
  };
}

/**
 * Create a `NotFoundError`.
 *
 * @example
 * ```ts
 * notFoundError("User not found", { resource: "User", resourceId: "abc-123" });
 * ```
 */
export function notFoundError(
  message: string,
  opts?: {
    resource?: string;
    resourceId?: string;
    cause?: unknown;
    context?: Record<string, unknown>;
  },
): NotFoundError {
  return {
    code: "NOT_FOUND",
    message,
    resource: opts?.resource,
    resourceId: opts?.resourceId,
    cause: opts?.cause,
    context: opts?.context,
  };
}

/**
 * Create an `AuthenticationError`.
 *
 * @example
 * ```ts
 * authenticationError("Token expired");
 * ```
 */
export function authenticationError(
  message: string,
  opts?: { cause?: unknown; context?: Record<string, unknown> },
): AuthenticationError {
  return {
    code: "AUTHENTICATION_ERROR",
    message,
    cause: opts?.cause,
    context: opts?.context,
  };
}

/**
 * Create an `AuthorizationError`.
 *
 * @example
 * ```ts
 * authorizationError("Insufficient permissions", { requiredPermission: "admin:write" });
 * ```
 */
export function authorizationError(
  message: string,
  opts?: {
    requiredPermission?: string;
    cause?: unknown;
    context?: Record<string, unknown>;
  },
): AuthorizationError {
  return {
    code: "AUTHORIZATION_ERROR",
    message,
    requiredPermission: opts?.requiredPermission,
    cause: opts?.cause,
    context: opts?.context,
  };
}

/**
 * Create a `ConflictError`.
 *
 * @example
 * ```ts
 * conflictError("Resource was modified by another request");
 * ```
 */
export function conflictError(
  message: string,
  opts?: { cause?: unknown; context?: Record<string, unknown> },
): ConflictError {
  return {
    code: "CONFLICT",
    message,
    cause: opts?.cause,
    context: opts?.context,
  };
}

/**
 * Create an `ExternalServiceError`.
 *
 * @example
 * ```ts
 * externalServiceError("Stripe API timeout", { service: "stripe" });
 * ```
 */
export function externalServiceError(
  message: string,
  opts?: {
    service?: string;
    cause?: unknown;
    context?: Record<string, unknown>;
  },
): ExternalServiceError {
  return {
    code: "EXTERNAL_SERVICE_ERROR",
    message,
    service: opts?.service,
    cause: opts?.cause,
    context: opts?.context,
  };
}

/**
 * Create a `RateLimitError`.
 *
 * @example
 * ```ts
 * rateLimitError("Too many requests", { retryAfterMs: 30_000 });
 * ```
 */
export function rateLimitError(
  message: string,
  opts?: {
    retryAfterMs?: number;
    cause?: unknown;
    context?: Record<string, unknown>;
  },
): RateLimitError {
  return {
    code: "RATE_LIMIT_ERROR",
    message,
    retryAfterMs: opts?.retryAfterMs,
    cause: opts?.cause,
    context: opts?.context,
  };
}

/**
 * Create an `InternalError` (catch-all for unexpected failures).
 *
 * @example
 * ```ts
 * internalError("Something went wrong", { cause: caughtException });
 * ```
 */
export function internalError(
  message: string,
  opts?: { cause?: unknown; context?: Record<string, unknown> },
): InternalError {
  return {
    code: "INTERNAL_ERROR",
    message,
    cause: opts?.cause,
    context: opts?.context,
  };
}

// ---------------------------------------------------------------------------
// Type guards / matching
// ---------------------------------------------------------------------------

/**
 * Check whether an unknown value conforms to the `AppError` shape.
 *
 * This is a *structural* check — it does not rely on `instanceof`.
 */
export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["code"] === "string" &&
    typeof candidate["message"] === "string"
  );
}

/**
 * Check whether an `AppError` has a specific `code`.
 *
 * @example
 * ```ts
 * if (isErrorType(error, "NOT_FOUND")) {
 *   // error is narrowed to NotFoundError
 * }
 * ```
 */
export function isErrorType<C extends ErrorCode>(
  error: AppError,
  code: C,
): error is Extract<AnyAppError, { code: C }> {
  return error.code === code;
}

// ---------------------------------------------------------------------------
// HTTP status mapping
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  CONFLICT: 409,
  EXTERNAL_SERVICE_ERROR: 502,
  RATE_LIMIT_ERROR: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Map an `ErrorCode` to the appropriate HTTP status code.
 *
 * @example
 * ```ts
 * httpStatusFromCode("NOT_FOUND") // 404
 * ```
 */
export function httpStatusFromCode(code: ErrorCode): number {
  return STATUS_MAP[code];
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an `AppError` to a JSON-safe representation.
 *
 * In development mode (`includeSensitive = true`) the output includes
 * the `context` bag and a stringified `cause` stack trace.
 * In production mode only `code` and `message` are exposed.
 */
export function serializeError(
  error: AppError,
  includeSensitive = false,
): SerializedError {
  const base: SerializedError = {
    code: error.code,
    message: error.message,
  };

  // Attach validation field errors — these are always client-facing
  if (isErrorType(error, "VALIDATION_ERROR") && error.fields) {
    return { ...base, fields: error.fields };
  }

  if (!includeSensitive) return base;

  // Development-only extras
  return {
    ...base,
    context: error.context,
    stack: error.cause instanceof Error ? error.cause.stack : undefined,
  };
}

/**
 * Deserialize a JSON payload back into an `AppError`.
 *
 * Useful when consuming error responses from other services.
 */
export function deserializeError(data: SerializedError): AppError {
  return {
    code: data.code,
    message: data.message,
    context: data.context,
  };
}
