/**
 * Core type definitions for the API module.
 *
 * Framework-agnostic types that model HTTP request/response lifecycle,
 * routing, pagination, and error handling.
 */

// ---------------------------------------------------------------------------
// HTTP primitives
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  body: unknown;
}

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

export interface SuccessBody<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponseBody<T> = SuccessBody<T> | ErrorBody;

export interface ApiResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: ApiResponseBody<T>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type Handler = (req: ApiRequest) => Promise<ApiResponse<unknown>> | ApiResponse<unknown>;

export type Middleware = (
  req: ApiRequest,
  next: () => Promise<ApiResponse<unknown>>,
) => Promise<ApiResponse<unknown>>;

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: Handler;
  middleware?: Middleware[];
  /** Optional validation schemas keyed by target (body | query | params). */
  validation?: {
    body?: SchemaNode;
    query?: SchemaNode;
    params?: SchemaNode;
  };
}

export interface RouteGroup {
  prefix: string;
  middleware?: Middleware[];
  routes: RouteDefinition[];
}

// ---------------------------------------------------------------------------
// Validation schema AST (see validator.ts for builder functions)
// ---------------------------------------------------------------------------

export type SchemaKind = "string" | "number" | "boolean" | "object" | "array" | "enum";

export interface BaseSchema {
  kind: SchemaKind;
  optional?: boolean;
  description?: string;
  customRules?: CustomRule[];
}

export interface StringSchema extends BaseSchema {
  kind: "string";
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export interface NumberSchema extends BaseSchema {
  kind: "number";
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface BooleanSchema extends BaseSchema {
  kind: "boolean";
}

export interface ObjectSchema extends BaseSchema {
  kind: "object";
  properties: Record<string, SchemaNode>;
}

export interface ArraySchema extends BaseSchema {
  kind: "array";
  items: SchemaNode;
  minItems?: number;
  maxItems?: number;
}

export interface EnumSchema extends BaseSchema {
  kind: "enum";
  values: readonly (string | number)[];
}

export type SchemaNode =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | ObjectSchema
  | ArraySchema
  | EnumSchema;

export interface CustomRule {
  name: string;
  validate: (value: unknown) => boolean;
  message: string;
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationParams {
  cursor?: string;
  limit: number;
  direction?: "forward" | "backward";
}

export interface OffsetPaginationParams {
  offset: number;
  limit: number;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
  totalCount?: number;
}

export interface PaginatedResponse<T> {
  ok: true;
  data: T[];
  meta: {
    pagination: PageInfo;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CorsConfig {
  /** Allowed origins. Use `["*"]` for any (not recommended in production). */
  origins: string[];
  methods?: HttpMethod[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface PaginationDefaults {
  defaultLimit: number;
  maxLimit: number;
}

export interface ApiConfig {
  basePath: string;
  version: string;
  cors?: CorsConfig;
  pagination?: PaginationDefaults;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
