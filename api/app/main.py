import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import dispose_engine, get_sessionmaker
from app.errors import install_error_handlers
from app.logging_config import configure_logging
from app.middleware import CsrfMiddleware, RequestContextMiddleware
from app.routers import account, audio_ws, auth, companies, health, notes, sessions
from app.services.live import LiveHub
from app.services.providers import build_runner


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    if settings.use_fake_providers and settings.environment == "production":
        raise RuntimeError("USE_FAKE_PROVIDERS must never be enabled in production")
    runner = build_runner(settings, get_sessionmaker())
    app.state.research_runner = runner
    app.state.live_hub = hub = LiveHub()
    await runner.recover_stale()  # requeue jobs a restart interrupted
    yield
    await (
        hub.shutdown()
    )  # open audio sockets close with 1012 so clients reconnect to the new replica
    try:  # give running jobs a moment; anything unfinished is recovered on the next boot
        await asyncio.wait_for(runner.wait_idle(), timeout=25)
    except TimeoutError:
        pass
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
    for r in (
        auth.router,
        account.router,
        notes.router,
        companies.router,
        sessions.router,
        audio_ws.router,
    ):
        app.include_router(r)
    return app


app = create_app()
