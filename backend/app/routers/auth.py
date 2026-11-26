import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailSender
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, email_brand, get_email_sender, get_google, get_notifier, me_out
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.schemas.api import (
    AppCodeOut,
    AppExchangeIn,
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
from app.security import COOKIE_NAME, SESSION_TOKEN_HEADER, session_token, wants_token
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
MODE_COOKIE = "oauth_mode"  # signin: only existing accounts; signup: may create one
APP_COOKIE = "oauth_app"  # an installed app started this sign-in; holds the app's challenge
APP_SCHEME = "interviewmeet"  # the address the system browser hands the result to
CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{43}$")  # base64url of a SHA-256 hash


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


def _open_session(
    response: Response, cookie: str, settings: Settings, request: Request | None = None
) -> None:
    if request is not None and wants_token(request):
        response.headers[SESSION_TOKEN_HEADER] = cookie  # an installed app keeps it itself
        return
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
    """Email a single-use sign-in link to someone who has an account. An address with no account is
    told so, plainly, and pointed to sign-up: no link is sent and nothing is created. (This does say
    which addresses are registered; the per-address and per-client limits bound how fast it can be
    asked.)"""
    email = body.email.lower().strip()
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    if await repo.recent_login_requests(email, within=timedelta(hours=1)) >= (
        settings.login_requests_per_hour
    ):
        raise ApiError(429, "rate_limited", "Too many sign-in requests. Try again later.")
    known = await repo.find_user(email)
    if known is None and not settings.open_link_signup:
        raise ApiError(
            404,
            "not_registered",
            "You're not registered on InterviewMeet yet. Please sign up first.",
        )
    ttl = settings.login_link_ttl_minutes
    token = await repo.create_login_token(
        email,
        ttl=timedelta(minutes=ttl),
        referral_code=clean_code(body.ref),
        device=observe_device(request, response, settings),
        attribution=_attribution("email_link", body.utm),
        app_challenge=body.app_challenge,
    )
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
) -> MeOut | AppCodeOut:
    """Exchange the emailed token for a session cookie. POST (not GET) so a mail scanner that
    prefetches the link cannot burn the token. If an installed app asked for the link, the browser
    is not signed in: the app is handed a one-time code instead (see /auth/app-exchange)."""
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
    app_code = (
        await repo.issue_app_code(user.id, used.app_challenge) if used.app_challenge else None
    )
    if app_code is None:
        _open_session(response, await repo.create_session(user.id, ttl=_ttl(settings)), settings)
    if not existed:
        await sender.send(emails.welcome(email_brand(settings), user.email, user.full_name))
    method = (used.attribution or {}).get("method") or "email_link"
    await _log_arrival(
        db, repo, notifier, user, existed=existed, method=method, attribution=used.attribution
    )
    return AppCodeOut(app_code=app_code) if app_code else me_out(user, settings)


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> StatusOut:
    token = session_token(request)
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
            app_challenge=body.app_challenge,
        )
        link = f"{settings.web_origin}/login/verify?token={token}"
        await sender.send(emails.signup_confirmation(brand, email, full_name, link, ttl))
    else:
        token = await repo.create_login_token(
            email, ttl=timedelta(minutes=ttl), app_challenge=body.app_challenge
        )
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
    _open_session(
        response, await repo.create_session(user.id, ttl=_ttl(settings)), settings, request
    )
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


def _app_handoff(params: dict[str, str]) -> HTMLResponse:
    """The page the system browser shows after Google, which passes the result to the installed app
    through its own address (interviewmeet://...). It opens by itself, and has a button for browsers
    that want a tap first. Plain markup only: no script, no stylesheet."""
    from html import escape
    from urllib.parse import urlencode

    link = escape(f"{APP_SCHEME}://auth?{urlencode(params)}", quote=True)
    ok = "code" in params
    body = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>InterviewMeet</title>"
        f'<meta http-equiv="refresh" content="0;url={link}"></head>'
        '<body style="font-family:system-ui,sans-serif;background:#f7f4ff;color:#1b1830;margin:0;'
        'min-height:100vh;display:grid;place-items:center;text-align:center">'
        '<main style="max-width:24rem;padding:1.5rem">'
        f"<h1>{'You are signed in' if ok else 'Sign-in did not finish'}</h1>"
        f"<p>{'Return to the app to continue.' if ok else 'Go back to the app to try again.'}</p>"
        f'<p><a href="{link}" style="display:inline-block;background:#7b47f3;color:#fff;'
        'text-decoration:none;padding:.9rem 1.6rem;border-radius:12px">Open InterviewMeet</a></p>'
        "</main></body></html>"
    )
    r = HTMLResponse(body)
    r.headers["Cache-Control"] = "no-store"
    r.headers["Referrer-Policy"] = "no-referrer"
    return r


@router.post("/auth/app-exchange")
async def app_exchange(
    body: AppExchangeIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> StatusOut:
    """An installed app swaps the one-time code from the system browser, plus the secret it made
    before leaving, for its own session. The code alone is worthless."""
    import base64
    import hashlib

    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(body.verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    user_id = await repo.redeem_app_code(body.code, challenge)
    if user_id is None:
        raise ApiError(400, "invalid_code", "That sign-in has expired. Please try again.")
    ttl = timedelta(days=settings.session_ttl_days)
    cookie = await repo.create_session(user_id, ttl=ttl)
    if wants_token(request):
        response.headers[SESSION_TOKEN_HEADER] = cookie
        return StatusOut(status="ok")
    response.set_cookie(
        COOKIE_NAME,
        cookie,
        max_age=int(ttl.total_seconds()),
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",
        path="/",
    )
    return StatusOut(status="ok")


@router.get("/auth/google/start")
async def google_start(
    request: Request,
    ref: str | None = None,
    utm_source: str | None = None,
    utm_medium: str | None = None,
    utm_campaign: str | None = None,
    app: str | None = None,
    challenge: str | None = None,
    mode: str | None = None,
    settings: Settings = Depends(get_settings),  # noqa: B008
    google: GoogleOAuth = Depends(get_google),  # noqa: B008
) -> RedirectResponse:
    if not google.enabled:
        raise ApiError(404, "google_not_configured", "Google sign-in is not available.")
    if app == "1" and not (challenge and CHALLENGE.match(challenge)):
        raise ApiError(400, "bad_request", "That sign-in request is not valid.")
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
    # Only the sign-up page may create an account through Google; anything else only signs in
    response.set_cookie(
        MODE_COOKIE,
        "signup" if mode == "signup" else "signin",
        max_age=600,
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",
        path=STATE_COOKIE_PATH,
    )
    if app == "1" and challenge:  # an installed app is waiting: remember to hand back to it
        response.set_cookie(
            APP_COOKIE,
            challenge,
            max_age=600,
            httponly=True,
            secure=settings.environment != "local",
            samesite="lax",
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
) -> Response:
    """Google sends the browser here. Whatever happens, the browser lands back on the web app, and
    the state cookie is used once."""

    app_challenge = request.cookies.get(APP_COOKIE)
    if app_challenge and not CHALLENGE.match(app_challenge):
        app_challenge = None

    def clear(r: Response) -> None:
        for name in (STATE_COOKIE, REF_COOKIE, UTM_COOKIE, APP_COOKIE, MODE_COOKIE):
            r.delete_cookie(name, path=STATE_COOKIE_PATH)

    def back(path: str) -> Response:
        r: Response
        if app_challenge:
            # the app is waiting, so tell it what went wrong instead of showing a page
            reason = path.split("error=")[-1] if "error=" in path else "google_failed"
            r = _app_handoff({"error": reason})
        else:
            r = RedirectResponse(f"{settings.web_origin}{path}", status_code=303)
        clear(r)
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
    if (
        not existed
        and request.cookies.get(MODE_COOKIE) != "signup"
        and not settings.open_link_signup
    ):
        # signing in is for people who have an account: send them to sign up, create nothing
        return back("/login?error=not_registered")
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
    if app_challenge:  # an installed app is waiting: give it a code, not a cookie in this browser
        handoff = _app_handoff({"code": await repo.issue_app_code(user.id, app_challenge)})
        clear(handoff)
        return handoff
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
