import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailSender
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, email_brand, get_email_sender, get_google, get_notifier, me_out
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.schemas.api import (
    LoginIn,
    MeOut,
    ProvidersOut,
    RequestLinkIn,
    ResetIn,
    SignUpIn,
    StatusOut,
    Utm,
    VerifyIn,
)
from app.security import COOKIE_NAME
from app.services import email_templates as emails
from app.services.devices import observe_device
from app.services.events import record_from
from app.services.google_oauth import (
    STATE_COOKIE,
    STATE_COOKIE_PATH,
    GoogleAuthError,
    GoogleOAuth,
)
from app.services.names import clean_name
from app.services.notify import Notifier
from app.services.passwords import (
    hash_password_async,
    password_problem,
    verify_password_async,
)
from app.services.referrals import clean_code

log = logging.getLogger("app.auth")

router = APIRouter(prefix="/api", tags=["auth"])
REF_COOKIE = "invite_code"
UTM_COOKIE = "utm_tags"


_TAG_OK = re.compile(r"[^A-Za-z0-9_.\- ]")


def _tag(value: str | None) -> str:
    """A campaign tag as typed in a link, made safe to keep: letters, digits and a few marks."""
    return _TAG_OK.sub("", value or "").strip()[:60]


def _attribution(method: str, utm: Utm | None) -> dict[str, Any]:
    """How someone arrived, for the admin marketing view: sign-up method and campaign tags."""
    out: dict[str, Any] = {"method": method}
    if utm:
        for key, value in (
            ("utm_source", utm.source),
            ("utm_medium", utm.medium),
            ("utm_campaign", utm.campaign),
        ):
            if cleaned := _tag(value):
                out[key] = cleaned
    return out


async def _log_arrival(
    db: AsyncSession,
    repo: AuthRepo,
    notifier: Notifier,
    user: User,
    *,
    existed: bool,
    method: str,
    attribution: dict[str, Any] | None,
) -> None:
    """Write the sign-up or sign-in to the event log, and tell an inviter a friend joined."""
    if existed:
        await record_from(db, "user.signed_in", user_id=user.id, method=method)
        return
    tags = {k: v for k, v in (attribution or {}).items() if k.startswith("utm_")}
    await record_from(
        db,
        "user.signed_up",
        user_id=user.id,
        method=method,
        referred=repo.last_referral is not None,
        **tags,
    )
    if repo.last_referral is not None:
        referrer_id, status = repo.last_referral
        await record_from(
            db,
            "referral.counted" if status == "counted" else "referral.held",
            user_id=referrer_id,
            friend_id=user.id,
        )
        if status == "counted":
            await notifier.friend_joined(referrer_id, user.id)


LOGIN_FAILURE_LIMIT = 10  # wrong passwords per email in the window below
LOGIN_FAILURE_WINDOW = timedelta(minutes=15)
INVALID_LOGIN = ApiError(401, "invalid_credentials", "Email or password is incorrect.")


def _ttl(settings: Settings) -> timedelta:
    return timedelta(days=settings.session_ttl_days)


def _open_session(response: Response, cookie: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE_NAME,
        cookie,
        max_age=int(_ttl(settings).total_seconds()),
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",
        path="/",
    )


async def _check_link_rate(repo: AuthRepo, email: str, settings: Settings) -> None:
    if await repo.recent_login_requests(email, within=timedelta(hours=1)) >= (
        settings.login_requests_per_hour
    ):
        raise ApiError(429, "rate_limited", "Too many requests. Try again later.")


@router.post("/auth/request-link", status_code=202)
async def request_link(
    body: RequestLinkIn,
    request: Request,
    response: Response,
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
    ttl = settings.login_link_ttl_minutes
    token = await repo.create_login_token(
        email,
        ttl=timedelta(minutes=ttl),
        referral_code=clean_code(body.ref),
        device=observe_device(request, response, settings),
        attribution=_attribution("email_link", body.utm),
    )
    known = await repo.find_user(email)
    link = f"{settings.web_origin}/login/verify?token={token}"
    message = emails.sign_in_link(
        email_brand(settings), email, known.full_name if known else None, link, ttl
    )
    await sender.send(message)
    return StatusOut(status="sent")


@router.post("/auth/verify")
async def verify(
    body: VerifyIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> MeOut:
    """Exchange the emailed token for a session cookie. POST (not GET) so a mail scanner that
    prefetches the link cannot burn the token."""
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    used = await repo.consume_token(body.token, ("login", "signup"))
    if used is None:
        raise ApiError(400, "invalid_link", "This sign-in link is invalid or has expired.")
    email, password_hash = used.email, used.password_hash
    existed = await repo.find_user(email) is not None
    # The name chosen at sign-up goes only on a brand-new account, like the password below.
    here = observe_device(request, response, settings)
    user = await repo.get_or_create_user(
        email,
        full_name=None if existed else used.full_name,
        referral_code=None if existed else used.referral_code,
        # where the link was asked for and where it was opened: both are checked against the inviter
        devices=(used.device, here),
        attribution=None if existed else (used.attribution or {"method": "email_link"}),
    )
    if existed:
        await repo.record_device(user.id, here)
    if password_hash and not existed:
        # Only a brand-new account takes the password chosen at sign-up. If the account already
        # exists (someone else registered this address meanwhile) the password is ignored, so a
        # sign-up started by a stranger can never set the password on a real person's account.
        await repo.set_password(user.id, password_hash)
    _open_session(response, await repo.create_session(user.id, ttl=_ttl(settings)), settings)
    if not existed:
        await sender.send(emails.welcome(email_brand(settings), user.email, user.full_name))
    method = (used.attribution or {}).get("method") or "email_link"
    await _log_arrival(
        db, repo, notifier, user, existed=existed, method=method, attribution=used.attribution
    )
    return me_out(user, settings)


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
    return me_out(user, settings)


# ------------------------------------------------------------------ Passwords


@router.post("/auth/signup", status_code=202)
async def signup(
    body: SignUpIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
) -> StatusOut:
    """Start an account with an email and password. Nothing takes effect until the emailed link is
    opened, which proves the address. The answer is the same whether or not the email already has
    an account; an existing account just gets an ordinary sign-in link."""
    email = body.email.lower().strip()
    full_name = clean_name(body.full_name)
    if full_name is None:
        raise ApiError(422, "invalid_name", "Please enter your full name, using letters only.")
    problem = password_problem(body.password, email)
    if problem:
        raise ApiError(422, "weak_password", problem)
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    await _check_link_rate(repo, email, settings)
    password_hash = await hash_password_async(body.password)  # always, so timing is the same
    ttl = settings.login_link_ttl_minutes
    brand = email_brand(settings)
    existing = await repo.find_user(email)
    if existing is None:
        token = await repo.create_login_token(
            email,
            ttl=timedelta(minutes=ttl),
            purpose="signup",
            password_hash=password_hash,
            full_name=full_name,
            referral_code=clean_code(body.ref),
            device=observe_device(request, response, settings),
            attribution=_attribution("password", body.utm),
        )
        link = f"{settings.web_origin}/login/verify?token={token}"
        await sender.send(emails.signup_confirmation(brand, email, full_name, link, ttl))
    else:
        token = await repo.create_login_token(email, ttl=timedelta(minutes=ttl))
        link = f"{settings.web_origin}/login/verify?token={token}"
        await sender.send(emails.sign_in_link(brand, email, existing.full_name, link, ttl))
    return StatusOut(status="sent")


@router.post("/auth/login")
async def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MeOut:
    email = body.email.lower().strip()
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    if await repo.recent_login_failures(email, within=LOGIN_FAILURE_WINDOW) >= LOGIN_FAILURE_LIMIT:
        raise ApiError(
            429, "rate_limited", "Too many wrong passwords. Wait 15 minutes, or use an email link."
        )
    user = await repo.find_user(email)
    ok = await verify_password_async(body.password, user.password_hash if user else None)
    if not ok or user is None:
        await repo.record_login_failure(email)
        await record_from(db, "auth.login_failed", user_id=user.id if user else None, email=email)
        raise INVALID_LOGIN  # the same answer for a wrong password, no password and no account
    await repo.clear_login_failures(email)
    await repo.record_device(user.id, observe_device(request, response, settings))
    _open_session(response, await repo.create_session(user.id, ttl=_ttl(settings)), settings)
    await record_from(db, "user.signed_in", user_id=user.id, method="password")
    return me_out(user, settings)


@router.post("/auth/request-reset", status_code=202)
async def request_reset(
    body: RequestLinkIn,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
) -> StatusOut:
    """Email a password-reset link. Same answer for every address."""
    email = body.email.lower().strip()
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    await _check_link_rate(repo, email, settings)
    known = await repo.find_user(email)
    if known is not None:
        ttl = settings.login_link_ttl_minutes
        token = await repo.create_login_token(email, ttl=timedelta(minutes=ttl), purpose="reset")
        link = f"{settings.web_origin}/reset-password?token={token}"
        await sender.send(
            emails.password_reset(email_brand(settings), email, known.full_name, link, ttl)
        )
    return StatusOut(status="sent")


@router.post("/auth/reset-password")
async def reset_password(
    body: ResetIn,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
) -> MeOut:
    """Choose a new password with the emailed link. Every other session is signed out."""
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    invalid = ApiError(400, "invalid_link", "This reset link is invalid or has expired.")
    email = await repo.peek_token_email(body.token, ("reset",))
    if email is None:
        raise invalid
    problem = password_problem(body.password, email)
    if problem:  # checked before the link is used up, so the person can simply try again
        raise ApiError(422, "weak_password", problem)
    used = await repo.consume_token(body.token, ("reset",))
    user = await repo.find_user(email) if used else None
    if user is None:
        raise invalid
    await repo.set_password(user.id, await hash_password_async(body.password))
    await repo.revoke_sessions(user.id)
    await repo.clear_login_failures(user.email)
    _open_session(response, await repo.create_session(user.id, ttl=_ttl(settings)), settings)
    await sender.send(
        emails.password_changed(
            email_brand(settings), user.email, user.full_name, datetime.now(UTC)
        )
    )
    await record_from(db, "user.password_reset", user_id=user.id)
    return me_out(user, settings)


# ------------------------------------------------------------------ Sign in with Google


@router.get("/auth/providers")
async def providers(google: GoogleOAuth = Depends(get_google)) -> ProvidersOut:  # noqa: B008
    """Which sign-in methods the web app should offer."""
    return ProvidersOut(google=google.enabled)


@router.get("/auth/google/start")
async def google_start(
    request: Request,
    ref: str | None = None,
    utm_source: str | None = None,
    utm_medium: str | None = None,
    utm_campaign: str | None = None,
    settings: Settings = Depends(get_settings),  # noqa: B008
    google: GoogleOAuth = Depends(get_google),  # noqa: B008
) -> RedirectResponse:
    if not google.enabled:
        raise ApiError(404, "google_not_configured", "Google sign-in is not available.")
    url, cookie = google.begin()
    response = RedirectResponse(url, status_code=302)
    observe_device(request, response, settings)  # gives the browser its device id if it has none
    response.set_cookie(
        STATE_COOKIE,
        cookie,
        max_age=600,
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",  # sent on the top-level redirect back from Google
        path=STATE_COOKIE_PATH,
    )
    if code := clean_code(ref):  # remember the invite across the trip to Google and back
        response.set_cookie(
            REF_COOKIE,
            code,
            max_age=1800,
            httponly=True,
            secure=settings.environment != "local",
            samesite="lax",
            path=STATE_COOKIE_PATH,
        )
    tags = "|".join(_tag(v) for v in (utm_source, utm_medium, utm_campaign))
    if tags != "||":  # campaign tags travel the same way
        response.set_cookie(
            UTM_COOKIE,
            tags,
            max_age=1800,
            httponly=True,
            secure=settings.environment != "local",
            samesite="lax",
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
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> RedirectResponse:
    """Google sends the browser here. Whatever happens, the browser lands back on the web app, and
    the state cookie is used once."""

    def back(path: str) -> RedirectResponse:
        r = RedirectResponse(f"{settings.web_origin}{path}", status_code=303)
        r.delete_cookie(STATE_COOKIE, path=STATE_COOKIE_PATH)
        r.delete_cookie(REF_COOKIE, path=STATE_COOKIE_PATH)
        r.delete_cookie(UTM_COOKIE, path=STATE_COOKIE_PATH)
        return r

    if not google.enabled:
        return back("/login?error=google_unavailable")
    if error or not code or not state:  # the user closed or denied the Google prompt
        return back("/login?error=google_cancelled")
    try:
        handshake = google.read_cookie(request.cookies.get(STATE_COOKIE))
        identity = await google.finish(code=code, state=state, handshake=handshake)
    except GoogleAuthError as exc:
        log.warning("google sign-in refused", extra={"fields": {"reason": str(exc)}})
        return back("/login?error=google_failed")
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    existed = await repo.find_user(identity.email) is not None
    here = observe_device(request, None, settings)  # the cookie was given at the start
    parts = (request.cookies.get(UTM_COOKIE) or "").split("|")[:3]
    parts += [""] * (3 - len(parts))
    attribution = _attribution(
        "google",
        Utm(
            source=_tag(parts[0]) or None,
            medium=_tag(parts[1]) or None,
            campaign=_tag(parts[2]) or None,
        ),
    )
    user = await repo.get_or_create_user(
        identity.email,
        full_name=None if existed else clean_name(identity.name),
        referral_code=None if existed else request.cookies.get(REF_COOKIE),
        devices=(here,),
        attribution=None if existed else attribution,
    )
    if existed:
        await repo.record_device(user.id, here)
    if not existed:
        await sender.send(emails.welcome(email_brand(settings), user.email, user.full_name))
    await _log_arrival(
        db, repo, notifier, user, existed=existed, method="google", attribution=attribution
    )
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
