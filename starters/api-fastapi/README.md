# api-fastapi

Production-ready FastAPI REST API starter with auth scaffolding, full CRUD, pagination, structured errors, and testing.

## 解决什么问题

Every new API project starts from scratch: routing, error handling, config management, auth scaffolding, testing setup. Teams waste the first 1-2 weeks on boilerplate instead of building the product. This starter gives you a production-grade structure on day 1 — you delete the example `Item` resource, rename it to your domain entity, and start shipping.

## 为什么这样设计

| Decision | Why | Trade-off |
|----------|-----|-----------|
| **FastAPI** | Fastest-growing Python API framework, built-in OpenAPI docs, async-native, excellent DX | Smaller ecosystem than Django; no built-in ORM |
| **App factory pattern** | Enables isolated test instances, environment-specific config | Slightly more indirection than a global `app` |
| **Repository pattern** | Decouples routes from data access — swap in-memory for Postgres without touching routes | Extra abstraction layer for simple apps |
| **Pydantic v2** | 2-5x faster than v1, strict mode, better error messages | Requires Python 3.11+ |
| **In-memory repository** | Zero infrastructure dependencies — clone and run immediately | Must replace with real DB for production |
| **Structured error responses** | Consistent `{error, detail, request_id}` envelope saves frontend hours of error parsing | Slightly more verbose than FastAPI defaults |
| **Soft delete** | Data is precious in startups — accidental deletes are recoverable | Queries must filter `deleted_at IS NULL` |

## 快速使用

```bash
# Install (with dev dependencies for testing)
pip install -e ".[dev]"

# Run the development server
uvicorn src.main:app --reload

# Run tests
pytest -v

# Format / lint
ruff check src/ tests/
ruff format src/ tests/
```

### Docker

```bash
docker build -t codenexus-api .
docker run -p 8000:8000 codenexus-api
```

Open http://localhost:8000/docs for interactive API documentation.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/v1/items` | List items (paginated) |
| POST | `/api/v1/items` | Create an item |
| GET | `/api/v1/items/{id}` | Get item by ID |
| PUT | `/api/v1/items/{id}` | Update item |
| DELETE | `/api/v1/items/{id}` | Soft-delete item |

### Pagination

```
GET /api/v1/items?page=1&page_size=20
```

Response:
```json
{
  "items": [...],
  "total": 42,
  "page": 1,
  "page_size": 20,
  "pages": 3
}
```

## 项目结构

```
starters/api-fastapi/
├── src/
│   ├── main.py           # App factory, lifespan, router registration
│   ├── config.py          # Pydantic Settings (env-based config)
│   ├── models.py          # Domain models (User, Item)
│   ├── schemas.py         # Request/response Pydantic schemas
│   ├── repository.py      # Generic in-memory CRUD repository
│   ├── dependencies.py    # FastAPI dependencies (pagination, auth stub)
│   ├── exceptions.py      # Custom exceptions + handlers
│   ├── middleware.py       # Request ID, timing, structured logging
│   └── routes/
│       ├── health.py      # Health check endpoint
│       └── items.py       # Item CRUD routes
├── tests/
│   ├── conftest.py        # Fixtures (client, app)
│   └── test_api.py        # 25+ tests covering all endpoints
├── pyproject.toml         # Dependencies, ruff, pytest config
├── Dockerfile             # Multi-stage production build
├── .meta.yml              # CodeNexus metadata
└── README.md
```

## 配置项

All configuration is via environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | `CodeNexus API` | Application name (appears in OpenAPI docs) |
| `APP_VERSION` | `1.0.0` | Application version |
| `ENVIRONMENT` | `dev` | `dev` / `staging` / `prod` |
| `DEBUG` | `false` | Enable debug mode |
| `HOST` | `0.0.0.0` | Server bind host |
| `PORT` | `8000` | Server bind port |
| `DATABASE_URL` | `sqlite:///./app.db` | Database connection string |
| `JWT_SECRET` | `change-me-in-production` | Secret for JWT signing |
| `JWT_ALGORITHM` | `HS256` | JWT algorithm |
| `JWT_EXPIRATION_MINUTES` | `30` | Token lifetime |
| `CORS_ORIGINS` | `["http://localhost:3000", ...]` | Allowed CORS origins |
| `DEFAULT_PAGE_SIZE` | `20` | Default items per page |
| `MAX_PAGE_SIZE` | `100` | Maximum items per page |

## How to adapt this starter

1. **Rename the `Item` model** to your domain entity (e.g., `Product`, `Project`, `Post`)
2. **Replace `InMemoryRepository`** with a database-backed implementation (SQLAlchemy, SQLModel, Tortoise)
3. **Implement real JWT auth** in `src/dependencies.py` (uncomment the JWT code, add `python-jose` or `PyJWT`)
4. **Add your routes** following the pattern in `src/routes/items.py`
5. **Configure for production** — set `ENVIRONMENT=prod`, real `JWT_SECRET`, real `DATABASE_URL`

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 FastAPI best practices 和 tiangolo 模式中综合提炼，创建零依赖可运行的 starter |
