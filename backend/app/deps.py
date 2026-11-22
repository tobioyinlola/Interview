import uuid
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import HTTPConnection

from app.adapters.email import (
    AuditedEmailSender,
    ConsoleEmailSender,
    EmailSender,
    ResendEmailSender,
    TeeEmailSender,
    UnconfiguredEmailSender,
)
from app.adapters.interfaces import SttProvider
from app.config import Settings, get_settings
from app.db import get_db, get_sessionmaker
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.schemas.api import MeOut, OnboardingAnswers
from app.security import COOKIE_NAME, STAFF_COOKIE_NAME
from app.services.email_templates import Brand
from app.services.google_oauth import GoogleOAuth
from app.services.live import LiveHub
from app.services.notify import Notifier
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


def get_google(
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> GoogleOAuth:
    return GoogleOAuth(settings)


def build_email_sender(settings: Settings) -> EmailSender:
    """The sender for this environment, wrapped so every outcome reaches the admin event log."""
    key = settings.resend_api_key.get_secret_value()
    dev_log = settings.dev_log_email_links and settings.environment == "staging"
    inner: EmailSender
    if key and settings.email_from:
        resend = ResendEmailSender(key, settings.email_from)
        inner = TeeEmailSender(resend, ConsoleEmailSender()) if dev_log else resend
    elif settings.environment == "local" or dev_log:
        inner = ConsoleEmailSender()
    else:
        inner = UnconfiguredEmailSender()
    return AuditedEmailSender(inner, get_sessionmaker())


def get_email_sender(
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> EmailSender:
    return build_email_sender(settings)


def get_notifier(
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
    maker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
) -> Notifier:
    """Emails the platform sends on its own (a friend joined, a free interview was added)."""
    return Notifier(maker, settings, sender)


def email_brand(settings: Settings) -> Brand:
    return Brand(web_origin=settings.web_origin, support_email=settings.support_email)


def me_out(user: User, settings: Settings) -> MeOut:
    """The signed-in person as the web app sees them."""
    return MeOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        onboarded=user.onboarded_at is not None,
        tour_done=user.tour_done_at is not None,
        onboarding=OnboardingAnswers(**user.onboarding) if user.onboarding else None,
    )


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


def staff_repo(db: AsyncSession, settings: Settings) -> AuthRepo:
    """Staff sessions live in the same table but are hashed with a different key, so a customer
    cookie can never be used as a staff cookie, or the other way round."""
    return AuthRepo(db, settings.cookie_secret.get_secret_value() + ":staff")


async def require_admin(
    request: Request,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> User:
    """Back-office routes. They need the separate staff sign-in; being signed in to the app is not
    enough. A missing or expired staff session is a 401 (so the console shows its sign-in page),
    and someone who is no longer on the staff list gets 404."""
    token = request.cookies.get(STAFF_COOKIE_NAME)
    user = await staff_repo(db, settings).user_for_session(token) if token else None
    if user is None:
        raise ApiError(401, "staff_not_authenticated", "Please sign in to the back office.")
    if not is_admin(user, settings):
        raise ApiError(404, "not_found", "Not found.")
    return user
