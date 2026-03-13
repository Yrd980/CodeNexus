/**
 * Standardized API response builders.
 *
 * Every endpoint returns the same envelope so frontend teams never have to
 * guess the shape.  The `ok` discriminant makes type narrowing trivial in TS.
 */

import type {
  ApiResponse,
  ErrorBody,
  PageInfo,
  PaginatedResponse,
  SuccessBody,
} from "./types.js";

// ---------------------------------------------------------------------------
// Success helpers
// ---------------------------------------------------------------------------

/** Wrap data in the standard success envelope. */
export function success<T>(
  data: T,
  meta?: Record<string, unknown>,
): ApiResponse<T> {
  const body: SuccessBody<T> = { ok: true, data };
  if (meta) body.meta = meta;
  return { status: 200, headers: {}, body };
}

/** 200 OK with data. Alias for `success`. */
export function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return success(data, meta);
}

/** 201 Created. */
export function created<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  const resp = success(data, meta);
  resp.status = 201;
  return resp;
}

/** 204 No Content. Body is technically empty but we keep the envelope for consistency. */
export function noContent(): ApiResponse<null> {
  return { status: 204, headers: {}, body: { ok: true, data: null } };
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** Build an error response with a machine-readable code and human message. */
export function error(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResponse<never> {
  const body: ErrorBody = {
    ok: false,
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return { status, headers: {}, body };
}

/** 400 Bad Request. */
export function badRequest(
  message = "Bad request",
  details?: unknown,
): ApiResponse<never> {
  return error(400, "BAD_REQUEST", message, details);
}

/** 401 Unauthorized. */
export function unauthorized(message = "Unauthorized"): ApiResponse<never> {
  return error(401, "UNAUTHORIZED", message);
}

/** 403 Forbidden. */
export function forbidden(message = "Forbidden"): ApiResponse<never> {
  return error(403, "FORBIDDEN", message);
}

/** 404 Not Found. */
export function notFound(message = "Not found"): ApiResponse<never> {
  return error(404, "NOT_FOUND", message);
}

/** 409 Conflict. */
export function conflict(message = "Conflict", details?: unknown): ApiResponse<never> {
  return error(409, "CONFLICT", message, details);
}

/** 500 Internal Server Error. */
export function internalError(message = "Internal server error"): ApiResponse<never> {
  return error(500, "INTERNAL_ERROR", message);
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

/** Build a paginated success response. */
export function paginated<T>(
  data: T[],
  pageInfo: PageInfo,
): ApiResponse<T[]> {
  const body: PaginatedResponse<T> = {
    ok: true,
    data,
    meta: { pagination: pageInfo },
  };
  return { status: 200, headers: {}, body };
}
