import uuid
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from app.adapters.email import (
    ConsoleEmailSender,
    EmailSender,
    ResendEmailSender,
    UnconfiguredEmailSender,
)
from app.adapters.interfaces import SttProvider
from app.config import Settings, get_settings
from app.db import get_db, get_sessionmaker
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.security import COOKIE_NAME
from app.services.live import LiveHub
from app.services.providers import build_answer_llm, build_runner, build_stt
from app.services.suggest import SuggestionService
from app.services.url_guard import Resolver, system_resolver
from app.workers.research_worker import ResearchRunner
from app.workers.scoring_worker import ScoringRunner


async def current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> User:
    token = request.cookies.get(COOKIE_NAME)
    user = None
    if token:
        user = await AuthRepo(db, settings.cookie_secret.get_secret_value()).user_for_session(token)
    if user is None:
        raise ApiError(401, "not_authenticated", "Please sign in.")
    return user


def get_email_sender(
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> EmailSender:
    key = settings.resend_api_key.get_secret_value()
    if key and settings.email_from:
        return ResendEmailSender(
            key, settings.email_from, ttl_minutes=settings.login_link_ttl_minutes
        )
    return ConsoleEmailSender() if settings.environment == "local" else UnconfiguredEmailSender()


def parse_uuid(value: str, code: str, message: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise ApiError(404, code, message) from None


UserId = Callable[..., uuid.UUID]


def get_runner(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> ResearchRunner:
    """The single in-process research runner (created at startup, or lazily on first use)."""
    runner: ResearchRunner | None = getattr(request.app.state, "research_runner", None)
    if runner is None:
        runner = build_runner(settings, get_sessionmaker())
        request.app.state.research_runner = runner
    return runner


def get_resolver() -> Resolver:
    return system_resolver


def get_hub(conn: HTTPConnection) -> LiveHub:
    """HTTPConnection, not Request: this dependency is also used by the WebSocket route, which has
    no HTTP request to inject."""
    return conn.app.state.live_hub  # type: ignore[no-any-return]


def get_stt(settings: Settings = Depends(get_settings)) -> SttProvider:  # noqa: B008
    return build_stt(settings)


def get_suggester(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> SuggestionService:
    """One service per process: it holds the in-memory per-session context cache."""
    svc: SuggestionService | None = getattr(request.app.state, "suggester", None)
    if svc is None:
        svc = SuggestionService(build_answer_llm(settings), settings, get_sessionmaker())
        request.app.state.suggester = svc
    return svc


def get_scorer(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> ScoringRunner:
    runner: ScoringRunner | None = getattr(request.app.state, "scoring_runner", None)
    if runner is None:
        runner = ScoringRunner(build_answer_llm(settings), settings, get_sessionmaker())
        request.app.state.scoring_runner = runner
    return runner


def is_admin(user: User, settings: Settings) -> bool:
    admins = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    return user.email.lower() in admins


async def require_admin(
    user: User = Depends(current_user),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> User:
    """Owner-only routes. A non-admin gets 404, so the route's existence is not revealed."""
    if not is_admin(user, settings):
        raise ApiError(404, "not_found", "Not found.")
    return user
