/**
 * Core type definitions for the error-handling module.
 *
 * Uses discriminated unions (tagged unions) instead of classes for:
 * - Zero runtime overhead (no prototype chain)
 * - Better tree-shaking (dead code elimination)
 * - Exhaustive pattern matching via TypeScript's narrowing
 */

// ---------------------------------------------------------------------------
// Result<T, E> — discriminated union
// ---------------------------------------------------------------------------

/**
 * Represents a successful computation holding value `T`.
 */
export interface Ok<T> {
  readonly _tag: "Ok";
  readonly value: T;
}

/**
 * Represents a failed computation holding error `E`.
 */
export interface Err<E> {
  readonly _tag: "Err";
  readonly error: E;
}

/**
 * A value that is either a success (`Ok<T>`) or a failure (`Err<E>`).
 *
 * Inspired by Rust's `std::result::Result`. Forces the caller to handle
 * both success and failure paths at the type level.
 */
export type Result<T, E> = Ok<T> | Err<E>;

// ---------------------------------------------------------------------------
// AppError — structured error hierarchy
// ---------------------------------------------------------------------------

/** Canonical error codes that map 1-to-1 with HTTP semantics. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "CONFLICT"
  | "EXTERNAL_SERVICE_ERROR"
  | "RATE_LIMIT_ERROR"
  | "INTERNAL_ERROR";

/**
 * Base shape for all application errors.
 *
 * Every error carries:
 * - `code`    – machine-readable error code
 * - `message` – human-readable description
 * - `cause`   – optional upstream error (for wrapping)
 * - `context` – optional bag of structured metadata
 */
export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: unknown;
  readonly context?: Record<string, unknown>;
}

/** Validation failed (e.g. bad request body). */
export interface ValidationError extends AppError {
  readonly code: "VALIDATION_ERROR";
  /** Per-field validation failures. */
  readonly fields?: Record<string, string>;
}

/** Requested resource does not exist. */
export interface NotFoundError extends AppError {
  readonly code: "NOT_FOUND";
  readonly resource?: string;
  readonly resourceId?: string;
}

/** Caller is not authenticated. */
export interface AuthenticationError extends AppError {
  readonly code: "AUTHENTICATION_ERROR";
}

/** Caller is authenticated but lacks permission. */
export interface AuthorizationError extends AppError {
  readonly code: "AUTHORIZATION_ERROR";
  readonly requiredPermission?: string;
}

/** Write conflict (e.g. optimistic lock failure). */
export interface ConflictError extends AppError {
  readonly code: "CONFLICT";
}

/** An external dependency (API, DB, queue) failed. */
export interface ExternalServiceError extends AppError {
  readonly code: "EXTERNAL_SERVICE_ERROR";
  readonly service?: string;
}

/** Caller exceeded allowed request rate. */
export interface RateLimitError extends AppError {
  readonly code: "RATE_LIMIT_ERROR";
  readonly retryAfterMs?: number;
}

/** Catch-all for unexpected internal failures. */
export interface InternalError extends AppError {
  readonly code: "INTERNAL_ERROR";
}

/**
 * Union of every concrete error type.
 * Enables exhaustive `switch` matching on `code`.
 */
export type AnyAppError =
  | ValidationError
  | NotFoundError
  | AuthenticationError
  | AuthorizationError
  | ConflictError
  | ExternalServiceError
  | RateLimitError
  | InternalError;

// ---------------------------------------------------------------------------
// Serialized form (for API responses / logging)
// ---------------------------------------------------------------------------

/** JSON-safe representation of an AppError. */
export interface SerializedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly fields?: Record<string, string>;
  readonly stack?: string;
}

// ---------------------------------------------------------------------------
// Error handler configuration
// ---------------------------------------------------------------------------

/** Configuration for the framework-agnostic error handler. */
export interface ErrorHandlerConfig {
  /**
   * When `true`, serialized errors include stack traces and full context.
   * Should be `false` in production to avoid leaking internals.
   * @default false
   */
  readonly isDevelopment?: boolean;

  /**
   * Optional hook called whenever an error is handled.
   * Use this to integrate with your logging / observability stack.
   */
  readonly onError?: (error: AppError, raw?: unknown) => void;

  /**
   * Fallback message shown to clients for unrecognised errors in
   * production mode. Override to localise.
   * @default "An unexpected error occurred"
   */
  readonly fallbackMessage?: string;
}

/** HTTP-shaped response returned by the error handler. */
export interface ErrorResponse {
  readonly status: number;
  readonly body: SerializedError;
}
