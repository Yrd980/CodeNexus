"""Application configuration using Pydantic Settings.

Why Pydantic Settings:
- Type-safe config with automatic validation
- Loads from environment variables out of the box
- Supports .env files for local development
- Defaults are environment-aware (dev/staging/prod)
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(StrEnum):
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    All values can be overridden via env vars. Example:
        APP_NAME=MyAPI DATABASE_URL=postgresql://... uvicorn src.main:app
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    app_name: str = "CodeNexus API"
    app_version: str = "1.0.0"
    environment: Environment = Environment.DEV
    debug: bool = False

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Database
    database_url: str = "sqlite:///./app.db"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 30

    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Pagination defaults
    default_page_size: int = 20
    max_page_size: int = 100

    @property
    def is_production(self) -> bool:
        return self.environment == Environment.PROD

    @property
    def is_development(self) -> bool:
        return self.environment == Environment.DEV


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance. Call this instead of Settings() directly."""
    return Settings()
