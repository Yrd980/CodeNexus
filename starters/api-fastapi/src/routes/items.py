"""Item CRUD routes — the example resource for this starter.

Rename "items" to your domain entity (e.g., products, projects, posts).
The pattern stays the same: thin routes that delegate to the repository.

Design decisions:
- Routes are thin — business logic lives in the repository / service layer
- Dependency injection for pagination, auth, and settings
- Consistent response schemas across all endpoints
- Soft delete by default (data is precious)
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, status

from src.dependencies import Pagination
from src.models import Item
from src.repository import InMemoryRepository
from src.schemas import ItemCreate, ItemResponse, ItemUpdate, PaginatedResponse

router = APIRouter(prefix="/items", tags=["items"])

# In production, this would be injected via Depends() pointing at a DB-backed repo.
# Using a module-level instance here so it persists across requests.
items_repo = InMemoryRepository(Item)


def _item_to_response(item: Item) -> ItemResponse:
    return ItemResponse(
        id=item.id,
        name=item.name,
        description=item.description,
        owner_id=item.owner_id,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("", response_model=PaginatedResponse[ItemResponse])
async def list_items(pagination: Pagination) -> PaginatedResponse[ItemResponse]:
    """List items with pagination."""
    items, total = items_repo.list(page=pagination.page, page_size=pagination.page_size)
    return PaginatedResponse(
        items=[_item_to_response(i) for i in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        pages=items_repo.total_pages(total, pagination.page_size),
    )


@router.post("", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(body: ItemCreate) -> ItemResponse:
    """Create a new item."""
    item = Item(name=body.name, description=body.description)
    created = items_repo.create(item)
    return _item_to_response(created)


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(item_id: UUID) -> ItemResponse:
    """Get a single item by ID."""
    item = items_repo.get(item_id)
    return _item_to_response(item)


@router.put("/{item_id}", response_model=ItemResponse)
async def update_item(item_id: UUID, body: ItemUpdate) -> ItemResponse:
    """Update an item. Only provided fields are changed."""
    updated = items_repo.update(item_id, body.model_dump(exclude_unset=True))
    return _item_to_response(updated)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: UUID) -> None:
    """Soft-delete an item."""
    items_repo.delete(item_id, soft=True)
