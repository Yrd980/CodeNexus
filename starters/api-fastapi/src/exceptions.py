"""Custom exception classes and FastAPI exception handlers.

Design decisions:
- Every exception maps to a specific HTTP status code
- All errors return the same ErrorResponse schema — frontend only parses one format
- Unhandled exceptions are caught and logged, returning a safe 500 without leaking internals
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.schemas import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)


# --- Custom exceptions ---


class AppError(Exception):
    """Base exception for the application."""

    status_code: int = 500
    error: str = "internal_error"
    message: str = "An unexpected error occurred"

    def __init__(self, message: str | None = None, **kwargs: Any) -> None:
        self.message = message or self.message
        self.extra = kwargs
        super().__init__(self.message)


class NotFoundError(AppError):
    status_code = 404
    error = "not_found"
    message = "Resource not found"


class ValidationError(AppError):
    status_code = 422
    error = "validation_error"
    message = "Validation failed"


class AuthError(AppError):
    status_code = 401
    error = "auth_error"
    message = "Authentication required"


class ForbiddenError(AppError):
    status_code = 403
    error = "forbidden"
    message = "You do not have permission to perform this action"


class ConflictError(AppError):
    status_code = 409
    error = "conflict"
    message = "Resource already exists"


# --- Exception handlers ---


def _build_error_response(
    request: Request,
    status_code: int,
    error: str,
    message: str,
    detail: list[ErrorDetail] | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    body = ErrorResponse(
        error=error,
        detail=detail or [ErrorDetail(message=message)],
        request_id=request_id,
    )
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Handle custom application errors."""
    return _build_error_response(request, exc.status_code, exc.error, exc.message)


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Handle Pydantic / FastAPI validation errors with structured detail."""
    details = [
        ErrorDetail(
            field=".".join(str(loc) for loc in err.get("loc", [])),
            message=err.get("msg", "Invalid value"),
            code="validation_error",
        )
        for err in exc.errors()
    ]
    return _build_error_response(request, 422, "validation_error", "Validation failed", details)


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions. Logs the traceback, returns a safe 500."""
    logger.exception("Unhandled exception: %s", exc)
    return _build_error_response(request, 500, "internal_error", "An unexpected error occurred")


def register_exception_handlers(app: FastAPI) -> None:
    """Register all exception handlers on the app."""
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_error_handler)  # type: ignore[arg-type]
