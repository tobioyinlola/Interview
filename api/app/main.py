from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import dispose_engine
from app.errors import install_error_handlers
from app.logging_config import configure_logging
from app.middleware import CsrfMiddleware, RequestContextMiddleware
from app.routers import account, auth, health, notes, sessions


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging(get_settings().log_level)
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Meet Practice Assistant API", version="0.1.0", lifespan=lifespan)

    # Last added is outermost: CORS wraps request-id wraps CSRF, so even CSRF errors carry both.
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )
    install_error_handlers(app)

    app.include_router(health.router)
    for r in (auth.router, account.router, notes.router, sessions.router):
        app.include_router(r)
    return app


app = create_app()
