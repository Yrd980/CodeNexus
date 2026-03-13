/**
 * Framework-agnostic error handler factory.
 *
 * Maps `AppError` instances to HTTP-shaped responses (status + body) without
 * coupling to Express, Fastify, Hono, or any other framework.
 *
 * Why a factory?
 * - Config is captured once at startup (dev vs prod, custom logger)
 * - The returned `handleError` function is a pure mapping — easy to test
 * - Frameworks change; error semantics don't
 */

import { httpStatusFromCode, isAppError, serializeError } from "./errors.js";
import type { AppError, ErrorHandlerConfig, ErrorResponse } from "./types.js";

const DEFAULT_FALLBACK_MESSAGE = "An unexpected error occurred";

/**
 * Create an error handler function pre-configured with your settings.
 *
 * @example
 * ```ts
 * const handleError = createErrorHandler({
 *   isDevelopment: process.env.NODE_ENV !== "production",
 *   onError: (err) => logger.error(err),
 * });
 *
 * // In your framework's error middleware:
 * const { status, body } = handleError(caughtError);
 * res.status(status).json(body);
 * ```
 */
export function createErrorHandler(
  config: ErrorHandlerConfig = {},
): (error: unknown) => ErrorResponse {
  const {
    isDevelopment = false,
    onError,
    fallbackMessage = DEFAULT_FALLBACK_MESSAGE,
  } = config;

  return (error: unknown): ErrorResponse => {
    // ------- Known AppError -------
    if (isAppError(error)) {
      const appError = error as AppError;
      onError?.(appError, error);

      return {
        status: httpStatusFromCode(appError.code),
        body: serializeError(appError, isDevelopment),
      };
    }

    // ------- Unknown / unexpected error -------
    const internalAppError: AppError = {
      code: "INTERNAL_ERROR",
      message: isDevelopment ? String(error) : fallbackMessage,
      cause: error,
      context:
        isDevelopment && error instanceof Error
          ? { stack: error.stack }
          : undefined,
    };

    onError?.(internalAppError, error);

    return {
      status: 500,
      body: serializeError(internalAppError, isDevelopment),
    };
  };
}
