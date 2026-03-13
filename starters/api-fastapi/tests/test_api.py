"""API tests — health check, full CRUD, pagination, and error handling.

Run with: pytest -v
"""

from __future__ import annotations

from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


class TestHealthCheck:
    def test_health_returns_ok(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_health_has_request_id(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert "x-request-id" in resp.headers

    def test_health_has_response_time(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert "x-response-time" in resp.headers


# ---------------------------------------------------------------------------
# Create item
# ---------------------------------------------------------------------------


class TestCreateItem:
    def test_create_item_success(self, client: TestClient) -> None:
        resp = client.post("/api/v1/items", json={"name": "Widget", "description": "A fine widget"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Widget"
        assert data["description"] == "A fine widget"
        assert "id" in data
        assert "created_at" in data

    def test_create_item_minimal(self, client: TestClient) -> None:
        """Only name is required — description defaults to empty string."""
        resp = client.post("/api/v1/items", json={"name": "Gadget"})
        assert resp.status_code == 201
        assert resp.json()["description"] == ""

    def test_create_item_empty_name_fails(self, client: TestClient) -> None:
        resp = client.post("/api/v1/items", json={"name": ""})
        assert resp.status_code == 422

    def test_create_item_missing_name_fails(self, client: TestClient) -> None:
        resp = client.post("/api/v1/items", json={"description": "no name"})
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"] == "validation_error"
        assert len(body["detail"]) > 0


# ---------------------------------------------------------------------------
# Read item
# ---------------------------------------------------------------------------


class TestGetItem:
    def test_get_item_success(self, client: TestClient) -> None:
        create_resp = client.post("/api/v1/items", json={"name": "Readable"})
        item_id = create_resp.json()["id"]

        resp = client.get(f"/api/v1/items/{item_id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Readable"

    def test_get_item_not_found(self, client: TestClient) -> None:
        resp = client.get("/api/v1/items/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404
        body = resp.json()
        assert body["error"] == "not_found"

    def test_get_item_invalid_uuid(self, client: TestClient) -> None:
        resp = client.get("/api/v1/items/not-a-uuid")
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# List items + pagination
# ---------------------------------------------------------------------------


class TestListItems:
    def test_list_empty(self, client: TestClient) -> None:
        resp = client.get("/api/v1/items")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0
        assert body["page"] == 1
        assert body["pages"] == 1

    def test_list_with_items(self, client: TestClient) -> None:
        for i in range(3):
            client.post("/api/v1/items", json={"name": f"Item {i}"})

        resp = client.get("/api/v1/items")
        body = resp.json()
        assert body["total"] == 3
        assert len(body["items"]) == 3

    def test_pagination(self, client: TestClient) -> None:
        for i in range(5):
            client.post("/api/v1/items", json={"name": f"Page Item {i}"})

        resp = client.get("/api/v1/items?page=1&page_size=2")
        body = resp.json()
        assert len(body["items"]) == 2
        assert body["total"] == 5
        assert body["pages"] == 3
        assert body["page"] == 1

    def test_pagination_page_2(self, client: TestClient) -> None:
        for i in range(5):
            client.post("/api/v1/items", json={"name": f"P2 Item {i}"})

        resp = client.get("/api/v1/items?page=2&page_size=2")
        body = resp.json()
        assert len(body["items"]) == 2
        assert body["page"] == 2

    def test_pagination_invalid_page(self, client: TestClient) -> None:
        resp = client.get("/api/v1/items?page=0")
        assert resp.status_code == 422

    def test_pagination_page_size_too_large(self, client: TestClient) -> None:
        resp = client.get("/api/v1/items?page_size=200")
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Update item
# ---------------------------------------------------------------------------


class TestUpdateItem:
    def test_update_item_name(self, client: TestClient) -> None:
        create_resp = client.post("/api/v1/items", json={"name": "Old Name"})
        item_id = create_resp.json()["id"]

        resp = client.put(f"/api/v1/items/{item_id}", json={"name": "New Name"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    def test_update_partial(self, client: TestClient) -> None:
        """Updating description only should not change name."""
        create_resp = client.post("/api/v1/items", json={"name": "Keep Me", "description": "Old"})
        item_id = create_resp.json()["id"]

        resp = client.put(f"/api/v1/items/{item_id}", json={"description": "New"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Keep Me"
        assert data["description"] == "New"

    def test_update_nonexistent(self, client: TestClient) -> None:
        resp = client.put(
            "/api/v1/items/00000000-0000-0000-0000-000000000000",
            json={"name": "Ghost"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete item
# ---------------------------------------------------------------------------


class TestDeleteItem:
    def test_delete_item(self, client: TestClient) -> None:
        create_resp = client.post("/api/v1/items", json={"name": "Doomed"})
        item_id = create_resp.json()["id"]

        resp = client.delete(f"/api/v1/items/{item_id}")
        assert resp.status_code == 204

    def test_deleted_item_not_found(self, client: TestClient) -> None:
        """After soft-delete the item should not be retrievable."""
        create_resp = client.post("/api/v1/items", json={"name": "Vanish"})
        item_id = create_resp.json()["id"]

        client.delete(f"/api/v1/items/{item_id}")
        resp = client.get(f"/api/v1/items/{item_id}")
        assert resp.status_code == 404

    def test_deleted_item_excluded_from_list(self, client: TestClient) -> None:
        client.post("/api/v1/items", json={"name": "Alive"})
        del_resp = client.post("/api/v1/items", json={"name": "Dead"})
        item_id = del_resp.json()["id"]
        client.delete(f"/api/v1/items/{item_id}")

        resp = client.get("/api/v1/items")
        names = [i["name"] for i in resp.json()["items"]]
        assert "Alive" in names
        assert "Dead" not in names

    def test_delete_nonexistent(self, client: TestClient) -> None:
        resp = client.delete("/api/v1/items/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Error response structure
# ---------------------------------------------------------------------------


class TestErrorStructure:
    def test_error_has_consistent_shape(self, client: TestClient) -> None:
        """All errors should return {error, detail, request_id}."""
        resp = client.get("/api/v1/items/00000000-0000-0000-0000-000000000000")
        body = resp.json()
        assert "error" in body
        assert "detail" in body
        assert "request_id" in body

    def test_validation_error_has_field_info(self, client: TestClient) -> None:
        resp = client.post("/api/v1/items", json={})
        body = resp.json()
        assert body["error"] == "validation_error"
        assert any(d.get("field") for d in body["detail"])


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class TestMiddleware:
    def test_custom_request_id_is_echoed(self, client: TestClient) -> None:
        custom_id = "my-trace-id-123"
        resp = client.get("/health", headers={"X-Request-ID": custom_id})
        assert resp.headers["x-request-id"] == custom_id
