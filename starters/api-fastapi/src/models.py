"""Domain models.

These are the core data structures for the application. In a real project you'd
back these with SQLAlchemy / SQLModel, but we keep them as plain Pydantic models
so the starter has zero infrastructure dependencies and can run immediately.

Design decisions:
- Pydantic models (not SQLAlchemy) so the starter is runnable without a database
- Timestamps mixin via composition — keeps models focused
- Soft delete via `deleted_at` — never lose data by accident
- UUID primary keys — safe for distributed systems, no sequential ID leaks
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin(BaseModel):
    """Adds created_at / updated_at to any model."""

    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class SoftDeleteMixin(BaseModel):
    """Adds soft-delete support. Prefer this over hard deletes in most cases."""

    deleted_at: datetime | None = None

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def soft_delete(self) -> None:
        self.deleted_at = _utcnow()


class User(TimestampMixin, SoftDeleteMixin):
    """Application user."""

    id: UUID = Field(default_factory=uuid4)
    email: str
    username: str
    hashed_password: str = ""
    is_active: bool = True


class Item(TimestampMixin, SoftDeleteMixin):
    """Generic CRUD resource — rename this to your domain entity."""

    id: UUID = Field(default_factory=uuid4)
    name: str
    description: str = ""
    owner_id: UUID | None = None
