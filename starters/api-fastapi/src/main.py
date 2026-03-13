"""FastAPI application entry point.

Design decisions:
- App factory pattern (create_app) so tests can spin up isolated instances
- Lifespan context manager for clean startup / shutdown
- API versioning via router prefix (/api/v1)
- All cross-cutting concerns (middleware, exception handlers) registered centrally
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import get_settings
from src.exceptions import register_exception_handlers
from src.middleware import register_middleware
from src.routes.health import router as health_router
from src.routes.items import router as items_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup / shutdown lifecycle.

    Put database pool creation, cache warm-up, ML model loading, etc. here.
    """
    settings = get_settings()
    logger.info("Starting %s (%s)", settings.app_name, settings.environment.value)
    # --- startup ---
    yield
    # --- shutdown ---
    logger.info("Shutting down %s", settings.app_name)


def create_app() -> FastAPI:
    """Application factory — creates and configures the FastAPI instance."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Custom middleware (request ID, timing, structured logging)
    register_middleware(app)

    # Exception handlers
    register_exception_handlers(app)

    # Routes
    app.include_router(health_router)
    app.include_router(items_router, prefix="/api/v1")

    return app


# Module-level app instance for `uvicorn src.main:app`
app = create_app()
