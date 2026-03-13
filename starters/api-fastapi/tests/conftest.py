"""Shared test fixtures.

Design decisions:
- Fresh app instance per test session via the app factory
- TestClient from httpx for async-compatible testing
- Items repo is cleared between tests to avoid state leakage
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from src.main import create_app
from src.routes.items import items_repo


@pytest.fixture(scope="session")
def app():
    """Create a fresh FastAPI app for the test session."""
    return create_app()


@pytest.fixture()
def client(app) -> Iterator[TestClient]:
    """HTTP test client with automatic repo cleanup between tests."""
    items_repo.clear()
    with TestClient(app) as c:
        yield c
