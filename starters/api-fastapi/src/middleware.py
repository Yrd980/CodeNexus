"""Custom ASGI middleware.

Design decisions:
- Request ID: every request gets a unique ID for tracing through logs / downstream services
- Timing: X-Response-Time header for quick latency checks without external tooling
- Structured logging: JSON logs that are parseable by any log aggregator (ELK, Datadog, etc.)
"""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

logger = logging.getLogger(__name__)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attaches a unique X-Request-ID to every request and response.

    If the client sends an X-Request-ID header, we reuse it (useful for
    tracing across microservices). Otherwise we generate one.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class TimingMiddleware(BaseHTTPMiddleware):
    """Adds X-Response-Time header (milliseconds) to every response."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Response-Time"] = f"{elapsed_ms:.2f}ms"
        return response


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    """Logs every request in a structured format."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000

        request_id = getattr(request.state, "request_id", "unknown")
        logger.info(
            "request completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round(elapsed_ms, 2),
            },
        )
        return response


def register_middleware(app: FastAPI) -> None:
    """Register all custom middleware on the app.

    Order matters: middleware added last runs first (LIFO).
    We want RequestID to run first so other middleware can use it.
    """
    # Added in reverse order — StructuredLogging wraps Timing wraps RequestID
    app.add_middleware(StructuredLoggingMiddleware)
    app.add_middleware(TimingMiddleware)
    app.add_middleware(RequestIDMiddleware)
