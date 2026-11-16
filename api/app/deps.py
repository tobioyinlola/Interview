import uuid
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import ConsoleEmailSender, EmailSender, UnconfiguredEmailSender
from app.config import Settings, get_settings
from app.db import get_db, get_sessionmaker
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.security import COOKIE_NAME
from app.services.providers import build_runner
from app.services.url_guard import Resolver, system_resolver
from app.workers.research_worker import ResearchRunner


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
