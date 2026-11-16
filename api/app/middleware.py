import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.logging_config import request_id_var

log = logging.getLogger("app.request")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns a request id, returns it in a header, and logs route, status and duration only."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_var.set(rid)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["x-request-id"] = rid
        log.info(
            "request",
            extra={
                "fields": {
                    "route": request.url.path,
                    "method": request.method,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                }
            },
        )
        return response
