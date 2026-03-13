/**
 * Type-safe API client factory for a SaaS application.
 *
 * Why build a custom API client instead of using fetch directly?
 * - Consistent error handling across all API calls
 * - Type-safe request/response — no more `as any` on fetch results
 * - Centralized auth header injection
 * - Easy to add retry logic, logging, etc.
 *
 * Pattern: Factory function that returns typed methods.
 * This avoids class inheritance complexity while keeping things organized.
 */

import type { ApiResponse, ApiErrorResponse } from "../types/index.js";

// ─── Types ──────────────────────────────────────────────────

export interface ApiClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
  onError?: (error: ApiClientError) => void;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
}

// ─── Error Class ────────────────────────────────────────────

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ─── Request Builder ────────────────────────────────────────

/**
 * Build the full URL from base + path.
 * Handles trailing slashes and leading slashes gracefully.
 */
export function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const segment = path.startsWith("/") ? path : `/${path}`;
  return `${base}${segment}`;
}

/**
 * Merge headers: default config headers + per-request headers.
 * Per-request headers take precedence.
 */
export function mergeHeaders(
  configHeaders: Record<string, string>,
  requestHeaders?: Record<string, string>
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...configHeaders,
    ...(requestHeaders ?? {}),
  };
}

// ─── Response Parser ────────────────────────────────────────

/**
 * Parse the API response, handling both success and error cases.
 *
 * Why a separate parser?
 * - Network errors (no response) and API errors (4xx/5xx) need different handling
 * - JSON parsing can fail on malformed responses
 * - Centralizing this prevents inconsistent error handling across calls
 */
export async function parseResponse<T>(
  response: Response
): Promise<ApiResponse<T>> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    // Response isn't JSON — wrap in an error response
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: `Failed to parse response (status ${response.status})`,
      },
    };
  }

  if (!response.ok) {
    // Try to extract error info from the body
    const errorBody = body as Partial<ApiErrorResponse["error"]>;
    return {
      success: false,
      error: {
        code: errorBody?.code ?? `HTTP_${response.status}`,
        message:
          errorBody?.message ?? `Request failed with status ${response.status}`,
        details: errorBody?.details,
      },
    };
  }

  return {
    success: true,
    data: body as T,
  };
}

// ─── API Client Factory ────────────────────────────────────

/**
 * Create a typed API client.
 *
 * Usage:
 * ```ts
 * const api = createApiClient({
 *   baseUrl: "https://api.yoursaas.com",
 *   headers: { Authorization: `Bearer ${token}` },
 * });
 *
 * const result = await api.get<User[]>("/users");
 * if (result.success) {
 *   console.log(result.data);
 * }
 * ```
 */
export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, headers: configHeaders = {}, onError } = config;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    const url = buildUrl(baseUrl, path);
    const headers = mergeHeaders(configHeaders, options?.headers);

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: options?.signal,
    };

    if (body !== undefined && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      const error = new ApiClientError(
        0,
        "NETWORK_ERROR",
        err instanceof Error ? err.message : "Network request failed"
      );
      onError?.(error);
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    const result = await parseResponse<T>(response);

    if (!result.success && onError) {
      onError(
        new ApiClientError(
          response.status,
          result.error.code,
          result.error.message,
          result.error.details
        )
      );
    }

    return result;
  }

  return {
    get<T>(path: string, options?: RequestOptions) {
      return request<T>("GET", path, undefined, options);
    },
    post<T>(path: string, body?: unknown, options?: RequestOptions) {
      return request<T>("POST", path, body, options);
    },
    put<T>(path: string, body?: unknown, options?: RequestOptions) {
      return request<T>("PUT", path, body, options);
    },
    patch<T>(path: string, body?: unknown, options?: RequestOptions) {
      return request<T>("PATCH", path, body, options);
    },
    delete<T>(path: string, options?: RequestOptions) {
      return request<T>("DELETE", path, undefined, options);
    },
  };
}
