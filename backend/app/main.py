import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import metrics
from app.autoapply.adapters import MailboxAdapter
from app.config import Settings, allowed_origins, get_settings
from app.db import dispose_engine, get_sessionmaker
from app.deps import build_email_sender
from app.errors import install_error_handlers
from app.hardening import (
    BodyLimitMiddleware,
    MetricsMiddleware,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    assert_safe,
)
from app.logging_config import configure_logging
from app.middleware import CsrfMiddleware, RequestContextMiddleware
from app.observability import init_sentry
from app.routers import (
    account,
    admin,
    admin_autoapply,
    app_releases,
    audio_ws,
    auth,
    autoapply,
    billing,
    companies,
    health,
    hunt,
    metrics_route,
    notes,
    profile,
    sessions,
    staff_auth,
)
from app.routers import (
    analytics as analytics_router,
)
from app.services.analytics import purge_old_client_events
from app.services.events import purge_old_events
from app.services.google_oauth import GoogleOAuth
from app.services.live import LiveHub
from app.services.notify import Notifier
from app.services.providers import build_answer_llm, build_runner
from app.workers.scoring_worker import ScoringRunner

log = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    assert_safe(settings)  # an unsafe production configuration stops here, before serving
    configure_logging(settings.log_level)
    metrics.configure(settings)
    if settings.google_client_id and settings.google_client_secret.get_secret_value():
        log.info(
            "google sign-in is on",
            extra={"fields": {"redirect_uri": GoogleOAuth(settings).redirect_uri}},
        )
    else:
        log.info("google sign-in is off: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")
    metrics.build_info.labels(app.version).set(1)
    init_sentry(settings)
    if settings.use_fake_providers and settings.environment == "production":
        raise RuntimeError("USE_FAKE_PROVIDERS must never be enabled in production")
    monitor = asyncio.create_task(metrics.monitor_loop())  # event-loop lag, DB pool use
    runner = build_runner(settings, get_sessionmaker())
    app.state.research_runner = runner
    app.state.live_hub = hub = LiveHub()
    scorer = ScoringRunner(build_answer_llm(settings), settings, get_sessionmaker())
    app.state.scoring_runner = scorer
    # the jobs tell people when their brief or review is ready
    notifier = Notifier(get_sessionmaker(), settings, build_email_sender(settings))
    runner.notifier = notifier
    scorer.notifier = notifier
    await purge_old_events(get_sessionmaker(), settings.event_retention_days)
    await purge_old_client_events(get_sessionmaker(), settings.analytics_retention_days)
    autoapply_task: asyncio.Task[None] | None = None
    # BACKGROUND_MODE=worker: the unified worker service (app/workers/main.py) does this instead
    if (
        (settings.autoapply_enabled or settings.startup_outreach_enabled)
        and settings.autoapply_tick_seconds > 0
        and settings.background_mode != "worker"
    ):
        autoapply_task = asyncio.create_task(start_autoapply(settings))

    await scorer.fail_interrupted()
    await runner.recover_stale()  # requeue jobs a restart interrupted
    yield
    monitor.cancel()
    if autoapply_task is not None:
        autoapply_task.cancel()
    # open audio sockets close with 1012 so clients reconnect to the new replica
    await hub.shutdown()
    try:  # give running jobs a moment; anything unfinished is recovered on the next boot
        await asyncio.wait_for(asyncio.gather(runner.wait_idle(), scorer.wait_idle()), timeout=25)
    except TimeoutError:
        pass
    await dispose_engine()


async def start_autoapply(settings: Settings) -> None:
    """Run the Auto-Apply scheduler for the life of the server."""
    from app.autoapply import discovery, forms, mailboxes, scheduler

    mailbox_adapter: MailboxAdapter = mailboxes.build(settings)
    await scheduler.loop(
        get_sessionmaker(),
        settings=settings,
        sources=discovery.build_sources(settings),
        form=forms.build(settings),
        mailbox_adapter=mailbox_adapter,
        llm=build_answer_llm(settings),
    )


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="InterviewMeet API", version="0.1.0", lifespan=lifespan)

    # Last added is outermost. CORS and the request id wrap everything, so even rejections
    # (rate limit, body size, CSRF) carry the CORS headers and a request id.
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(BodyLimitMiddleware, settings=settings)
    app.add_middleware(RateLimitMiddleware, settings=settings)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
    app.add_middleware(MetricsMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(settings),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id", "x-session-token"],
    )
    install_error_handlers(app)

    app.include_router(health.router)
    app.include_router(metrics_route.router)
    for r in (
        auth.router,
        account.router,
        analytics_router.router,
        notes.router,
        profile.router,
        billing.router,
        companies.router,
        sessions.router,
        audio_ws.router,
        autoapply.router,
        hunt.router,
        hunt.admin_router,
        staff_auth.router,
        admin.router,
        admin_autoapply.router,
        app_releases.router,
    ):
        app.include_router(r)
    return app


app = create_app()
