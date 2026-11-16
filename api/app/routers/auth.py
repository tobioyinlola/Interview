from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailSender
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, get_email_sender, is_admin
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.schemas.api import MeOut, RequestLinkIn, StatusOut, VerifyIn
from app.security import COOKIE_NAME

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/request-link", status_code=202)
async def request_link(
    body: RequestLinkIn,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
) -> StatusOut:
    """Email a single-use sign-in link. The answer is the same for every address, so it cannot be
    used to discover which emails have accounts."""
    email = body.email.lower().strip()
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    if await repo.recent_login_requests(email, within=timedelta(hours=1)) >= (
        settings.login_requests_per_hour
    ):
        raise ApiError(429, "rate_limited", "Too many sign-in requests. Try again later.")
    token = await repo.create_login_token(
        email, ttl=timedelta(minutes=settings.login_link_ttl_minutes)
    )
    await sender.send_login_link(email, f"{settings.web_origin}/login/verify?token={token}")
    return StatusOut(status="sent")


@router.post("/auth/verify")
async def verify(
    body: VerifyIn,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MeOut:
    """Exchange the emailed token for a session cookie. POST (not GET) so a mail scanner that
    prefetches the link cannot burn the token."""
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    email = await repo.consume_login_token(body.token)
    if email is None:
        raise ApiError(400, "invalid_link", "This sign-in link is invalid or has expired.")
    user = await repo.get_or_create_user(email)
    ttl = timedelta(days=settings.session_ttl_days)
    cookie = await repo.create_session(user.id, ttl=ttl)
    response.set_cookie(
        COOKIE_NAME,
        cookie,
        max_age=int(ttl.total_seconds()),
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",
        path="/",
    )
    return MeOut(id=user.id, email=user.email, is_admin=is_admin(user, settings))


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> StatusOut:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await AuthRepo(db, settings.cookie_secret.get_secret_value()).delete_session(token)
    response.delete_cookie(COOKIE_NAME, path="/")
    return StatusOut(status="ok")


@router.get("/me")
async def me(
    user: User = Depends(current_user),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MeOut:
    return MeOut(id=user.id, email=user.email, is_admin=is_admin(user, settings))
