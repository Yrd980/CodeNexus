"""FastAPI dependencies — reusable building blocks injected into routes.

Why dependencies:
- DRY: pagination logic written once, used everywhere
- Testable: override dependencies in tests without monkey-patching
- Composable: dependencies can depend on other dependencies
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Query, Request

from src.config import Settings, get_settings

# --- Pagination ---


class PaginationParams:
    """Validates and holds pagination query parameters."""

    def __init__(
        self,
        page: Annotated[int, Query(ge=1, description="Page number (1-indexed)")] = 1,
        page_size: Annotated[int, Query(ge=1, le=100, description="Items per page (max 100)")] = 20,
    ) -> None:
        self.page = page
        self.page_size = page_size


Pagination = Annotated[PaginationParams, Depends()]


# --- Settings ---


SettingsDep = Annotated[Settings, Depends(get_settings)]


# --- Current User (stub) ---


class CurrentUser:
    """Minimal user representation extracted from a JWT token.

    In production, replace the `_get_current_user` implementation with actual
    JWT decoding (e.g., python-jose or PyJWT).
    """

    def __init__(self, user_id: str, email: str) -> None:
        self.user_id = user_id
        self.email = email


async def _get_current_user(request: Request) -> CurrentUser:
    """Extract user from Authorization header.

    This is a stub — it returns a demo user. Replace with real JWT validation.
    """
    # In a real app:
    # token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    # payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    # return CurrentUser(user_id=payload["sub"], email=payload["email"])
    return CurrentUser(user_id="demo-user-id", email="demo@example.com")


RequireUser = Annotated[CurrentUser, Depends(_get_current_user)]
