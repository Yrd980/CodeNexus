import { describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../src/error-handler.js";
import { notFoundError, validationError, internalError } from "../src/errors.js";

describe("createErrorHandler", () => {
  it("maps a NotFoundError to 404", () => {
    const handle = createErrorHandler();
    const { status, body } = handle(notFoundError("User not found"));
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("User not found");
  });

  it("maps a ValidationError to 400 with fields", () => {
    const handle = createErrorHandler();
    const { status, body } = handle(
      validationError("Invalid", { fields: { email: "required" } }),
    );
    expect(status).toBe(400);
    expect(body.fields).toEqual({ email: "required" });
  });

  it("maps unknown errors to 500 with safe message in production", () => {
    const handle = createErrorHandler({ isDevelopment: false });
    const { status, body } = handle(new Error("secret internal detail"));
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("An unexpected error occurred");
    expect(body.context).toBeUndefined();
    expect(body.stack).toBeUndefined();
  });

  it("exposes details for unknown errors in development mode", () => {
    const handle = createErrorHandler({ isDevelopment: true });
    const { status, body } = handle(new Error("db crash"));
    expect(status).toBe(500);
    expect(body.message).toContain("db crash");
  });

  it("uses custom fallback message", () => {
    const handle = createErrorHandler({
      fallbackMessage: "Oops, something went wrong!",
    });
    const { body } = handle("random string error");
    expect(body.message).toBe("Oops, something went wrong!");
  });

  it("invokes onError callback for AppErrors", () => {
    const onError = vi.fn();
    const handle = createErrorHandler({ onError });
    const error = notFoundError("gone");
    handle(error);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error, error);
  });

  it("invokes onError callback for unknown errors", () => {
    const onError = vi.fn();
    const handle = createErrorHandler({ onError });
    const rawError = new Error("unexpected");
    handle(rawError);
    expect(onError).toHaveBeenCalledOnce();
    // First arg should be the wrapped AppError, second is the raw error
    const [appErr, raw] = onError.mock.calls[0] as [unknown, unknown];
    expect((appErr as { code: string }).code).toBe("INTERNAL_ERROR");
    expect(raw).toBe(rawError);
  });

  it("exposes context in development mode for AppErrors", () => {
    const handle = createErrorHandler({ isDevelopment: true });
    const error = internalError("broken", {
      cause: new Error("root cause"),
      context: { traceId: "abc" },
    });
    const { body } = handle(error);
    expect(body.context).toEqual({ traceId: "abc" });
  });
});
