import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db

log = logging.getLogger("app.health")
router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is up."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> JSONResponse:
    """Readiness: database reachable and provider key present."""
    checks = {"database": False, "openai_key": bool(settings.openai_api_key.get_secret_value())}
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception as exc:  # any failure means not ready
        log.warning("readyz database check failed", extra={"fields": {"error": type(exc).__name__}})
    ready = all(checks.values())
    return JSONResponse(
        {"status": "ready" if ready else "not_ready", "checks": checks},
        status_code=200 if ready else 503,
    )
