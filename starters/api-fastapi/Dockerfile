# Production-ready multi-stage Docker build for the FastAPI starter.
#
# Build:  docker build -t codenexus-api .
# Run:    docker run -p 8000:8000 codenexus-api
#
# Design decisions:
# - Multi-stage build: keeps the final image small (~120 MB vs ~800 MB)
# - Non-root user: security best practice
# - Health check baked in: works with Docker Compose and orchestrators

# ---------- Stage 1: build dependencies ----------
FROM python:3.12-slim AS builder

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# ---------- Stage 2: runtime ----------
FROM python:3.12-slim

# Security: run as non-root
RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid appuser --shell /bin/bash --create-home appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn

# Copy application code
COPY src/ ./src/

# Switch to non-root user
USER appuser

EXPOSE 8000

# Health check for orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
