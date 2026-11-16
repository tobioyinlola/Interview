import hmac

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app import metrics
from app.config import Settings, get_settings

router = APIRouter(tags=["ops"], include_in_schema=False)


@router.get("/metrics")
async def prometheus(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> Response:
    """Prometheus scrape endpoint. With METRICS_TOKEN set it needs `Authorization: Bearer <token>`.
    Without a token it is open in local development and does not exist anywhere else."""
    token = settings.metrics_token.get_secret_value()
    if token:
        given = request.headers.get("authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {token}".encode()):
            return Response(status_code=401, headers={"www-authenticate": "Bearer"})
    elif settings.environment != "local":
        return Response(status_code=404)
    return Response(metrics.render(), media_type=metrics.CONTENT_TYPE)
