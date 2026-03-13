"""Pydantic request / response schemas.

Why separate schemas from models:
- Models represent internal domain objects (may include hashed_password, etc.)
- Schemas define the API contract — what goes in and what comes out
- This separation prevents accidental data leaks and keeps the API stable
  even when internal models change.
"""

from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field

T = TypeVar("T")


# --- Error responses ---


class ErrorDetail(BaseModel):
    """Single error detail for structured error responses."""

    field: str | None = None
    message: str
    code: str = "error"


class ErrorResponse(BaseModel):
    """Consistent error envelope — every error from this API looks the same."""

    error: str
    detail: list[ErrorDetail] = []
    request_id: str | None = None


# --- Pagination ---


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response wrapper."""

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


# --- Item schemas ---


class ItemCreate(BaseModel):
    """Schema for creating an item."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)


class ItemUpdate(BaseModel):
    """Schema for updating an item. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


class ItemResponse(BaseModel):
    """Schema returned when reading an item."""

    id: UUID
    name: str
    description: str
    owner_id: UUID | None
    created_at: datetime
    updated_at: datetime


# --- User schemas ---


class UserCreate(BaseModel):
    """Schema for creating a user."""

    email: str = Field(..., min_length=3)
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=8)


class UserResponse(BaseModel):
    """Schema returned when reading a user. Never exposes password."""

    id: UUID
    email: str
    username: str
    is_active: bool
    created_at: datetime
