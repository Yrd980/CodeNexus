"""Health check endpoint.

Every production API needs a health check for load balancers, Kubernetes
readiness probes, and uptime monitors. Keep it simple and fast.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Returns OK if the service is running.

    In production, extend this to check downstream dependencies
    (database, cache, message queue) and return degraded status.
    """
    return {"status": "ok"}
