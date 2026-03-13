/**
 * foundation/api — Framework-agnostic API patterns.
 *
 * @module foundation/api
 */

// Types -----------------------------------------------------------------------
export type {
  ApiConfig,
  ApiRequest,
  ApiResponse,
  ApiResponseBody,
  ArraySchema,
  BooleanSchema,
  CorsConfig,
  CustomRule,
  EnumSchema,
  ErrorBody,
  Handler,
  HttpMethod,
  Middleware,
  NumberSchema,
  ObjectSchema,
  OffsetPaginationParams,
  PageInfo,
  PaginatedResponse,
  PaginationDefaults,
  PaginationParams,
  RouteDefinition,
  RouteGroup,
  SchemaKind,
  SchemaNode,
  StringSchema,
  SuccessBody,
  ValidationError,
  ValidationResult,
} from "./types.js";

// Re-export the class (not just the type)
export { ApiError } from "./types.js";

// Validator -------------------------------------------------------------------
export {
  string,
  number,
  boolean,
  object,
  array,
  enumType,
  optional,
  withRule,
  validate,
} from "./validator.js";
export type { ValidateOptions } from "./validator.js";

// Response builders -----------------------------------------------------------
export {
  success,
  ok,
  created,
  noContent,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internalError,
  error,
  paginated,
} from "./response.js";

// Router ----------------------------------------------------------------------
export { Router } from "./router.js";
export type { ResolvedRoute } from "./router.js";

// CORS ------------------------------------------------------------------------
export { createCorsMiddleware, isOriginAllowed } from "./cors.js";

// Pagination ------------------------------------------------------------------
export {
  encodeCursor,
  decodeCursor,
  cursorPage,
  offsetPageInfo,
  clampLimit,
} from "./pagination.js";
export type { CursorPageInput, OffsetPageInput } from "./pagination.js";
