import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailSender
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, get_email_sender, get_google, is_admin
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.schemas.api import MeOut, ProvidersOut, RequestLinkIn, StatusOut, VerifyIn
from app.security import COOKIE_NAME
from app.services.google_oauth import (
    STATE_COOKIE,
    STATE_COOKIE_PATH,
    GoogleAuthError,
    GoogleOAuth,
)

log = logging.getLogger("app.auth")

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


# ------------------------------------------------------------------ Sign in with Google


@router.get("/auth/providers")
async def providers(google: GoogleOAuth = Depends(get_google)) -> ProvidersOut:  # noqa: B008
    """Which sign-in methods the web app should offer."""
    return ProvidersOut(google=google.enabled)


@router.get("/auth/google/start")
async def google_start(
    settings: Settings = Depends(get_settings),  # noqa: B008
    google: GoogleOAuth = Depends(get_google),  # noqa: B008
) -> RedirectResponse:
    if not google.enabled:
        raise ApiError(404, "google_not_configured", "Google sign-in is not available.")
    url, cookie = google.begin()
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        STATE_COOKIE,
        cookie,
        max_age=600,
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",  # sent on the top-level redirect back from Google
        path=STATE_COOKIE_PATH,
    )
    return response


@router.get("/auth/google/callback")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    google: GoogleOAuth = Depends(get_google),  # noqa: B008
) -> RedirectResponse:
    """Google sends the browser here. Whatever happens, the browser lands back on the web app, and
    the state cookie is used once."""

    def back(path: str) -> RedirectResponse:
        r = RedirectResponse(f"{settings.web_origin}{path}", status_code=303)
        r.delete_cookie(STATE_COOKIE, path=STATE_COOKIE_PATH)
        return r

    if not google.enabled:
        return back("/login?error=google_unavailable")
    if error or not code or not state:  # the user closed or denied the Google prompt
        return back("/login?error=google_cancelled")
    try:
        handshake = google.read_cookie(request.cookies.get(STATE_COOKIE))
        email = await google.finish(code=code, state=state, handshake=handshake)
    except GoogleAuthError as exc:
        log.warning("google sign-in refused", extra={"fields": {"reason": str(exc)}})
        return back("/login?error=google_failed")
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    user = await repo.get_or_create_user(email)
    ttl = timedelta(days=settings.session_ttl_days)
    cookie = await repo.create_session(user.id, ttl=ttl)
    response = back("/dashboard")
    response.set_cookie(
        COOKIE_NAME,
        cookie,
        max_age=int(ttl.total_seconds()),
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",
        path="/",
    )
    return response
