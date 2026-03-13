"""Generic in-memory repository implementing the Repository pattern.

Why the Repository pattern:
- Decouples routes from data access — swap in-memory for Postgres without touching routes
- Makes testing trivial — no database needed
- Type-safe with generics — catches bugs at type-check time

In production, replace InMemoryRepository with a SQLAlchemy / async-pg implementation
that satisfies the same interface.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any, Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel

from src.exceptions import NotFoundError

ModelT = TypeVar("ModelT", bound=BaseModel)


class InMemoryRepository(Generic[ModelT]):
    """Generic CRUD repository backed by a dict.

    Good enough for prototyping and testing. Swap for a real DB repo in production.
    """

    def __init__(self, model_cls: type[ModelT]) -> None:
        self._model_cls = model_cls
        self._store: dict[UUID, ModelT] = {}

    def create(self, entity: ModelT) -> ModelT:
        entity_id: UUID = entity.id
        self._store[entity_id] = entity
        return entity

    def get(self, entity_id: UUID) -> ModelT:
        entity = self._store.get(entity_id)
        if entity is None or getattr(entity, "deleted_at", None) is not None:
            raise NotFoundError(f"{self._model_cls.__name__} {entity_id} not found")
        return entity

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 20,
        filters: dict[str, Any] | None = None,
    ) -> tuple[list[ModelT], int]:
        """Return a page of entities and the total count (excluding soft-deleted)."""
        active = [e for e in self._store.values() if getattr(e, "deleted_at", None) is None]

        # Apply simple equality filters
        if filters:
            for key, value in filters.items():
                active = [e for e in active if getattr(e, key, None) == value]

        total = len(active)

        # Sort by created_at descending (newest first)
        active.sort(key=lambda e: getattr(e, "created_at", 0), reverse=True)

        start = (page - 1) * page_size
        end = start + page_size
        return active[start:end], total

    def update(self, entity_id: UUID, data: dict[str, Any]) -> ModelT:
        entity = self.get(entity_id)
        update_data = {k: v for k, v in data.items() if v is not None}
        update_data["updated_at"] = datetime.now(UTC)
        updated = entity.model_copy(update=update_data)
        self._store[entity_id] = updated
        return updated

    def delete(self, entity_id: UUID, *, soft: bool = True) -> None:
        entity = self.get(entity_id)
        if soft:
            updated = entity.model_copy(update={"deleted_at": datetime.now(UTC)})
            self._store[entity_id] = updated
        else:
            del self._store[entity_id]

    def count(self) -> int:
        return len([e for e in self._store.values() if getattr(e, "deleted_at", None) is None])

    def clear(self) -> None:
        """Remove all entities. Useful in tests."""
        self._store.clear()

    @staticmethod
    def total_pages(total: int, page_size: int) -> int:
        return max(1, math.ceil(total / page_size))
