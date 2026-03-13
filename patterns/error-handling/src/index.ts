/**
 * @module @codenexus/error-handling
 *
 * Type-safe error handling for TypeScript applications.
 *
 * - **Result<T, E>** — discriminated union that makes failures explicit in the
 *   type system (no more invisible `throw`).
 * - **AppError hierarchy** — structured, serializable errors with HTTP status
 *   mapping for API services.
 * - **Error handler** — framework-agnostic factory that turns errors into
 *   HTTP responses with dev/prod modes.
 *
 * @example
 * ```ts
 * import {
 *   ok, err, map, flatMap, fromPromise,
 *   validationError, notFoundError,
 *   createErrorHandler,
 * } from "@codenexus/error-handling";
 * ```
 */

// Result type — constructors, guards, transformations, combinators
export {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  flatMap,
  andThen,
  unwrap,
  unwrapOr,
  unwrapOrElse,
  fromPromise,
  fromThrowable,
  combine,
} from "./result.js";

// Error hierarchy — factories, guards, serialization
export {
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
} from "./errors.js";

// Error handler — framework-agnostic factory
export { createErrorHandler } from "./error-handler.js";

// Types — re-export for downstream consumers
export type {
  Ok,
  Err,
  Result,
  ErrorCode,
  AppError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ExternalServiceError,
  RateLimitError,
  InternalError,
  AnyAppError,
  SerializedError,
  ErrorHandlerConfig,
  ErrorResponse,
} from "./types.js";
