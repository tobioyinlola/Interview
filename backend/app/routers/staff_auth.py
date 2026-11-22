"""The back office's own sign-in. It is separate from the customer app: a different cookie, a
shorter life, a different page, and only addresses on the staff list can use it. Signing in to the
app does not open the back office, and signing in here does not sign anyone in to the app."""

from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailSender
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import email_brand, get_email_sender, is_admin, require_admin, staff_repo
from app.errors import ApiError
from app.models import User
from app.repositories import AuthRepo
from app.schemas.api import StatusOut, VerifyIn
from app.security import STAFF_COOKIE_NAME
from app.services import email_templates as emails
from app.services.events import record_from
from app.services.passwords import verify_password_async

router = APIRouter(prefix="/api/admin/auth", tags=["staff"])

FAILURE_LIMIT = 5  # wrong passwords per address in 15 minutes: tighter than for customers
FAILURE_WINDOW = timedelta(minutes=15)
INVALID = ApiError(401, "invalid_credentials", "Email or password is incorrect.")
BAD_LINK = ApiError(400, "invalid_link", "This sign-in link is invalid or has expired.")


class StaffIn(BaseModel):
    email: EmailStr


class StaffLoginIn(StaffIn):
    password: str = Field(min_length=1, max_length=256)


class StaffOut(BaseModel):
    email: str
    full_name: str | None = None


def _staff_emails(settings: Settings) -> set[str]:
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


def _open(response: Response, cookie: str, settings: Settings) -> None:
    response.set_cookie(
        STAFF_COOKIE_NAME,
        cookie,
        max_age=settings.staff_session_hours * 3600,
        httponly=True,
        secure=settings.environment != "local",
        samesite="strict",
        path="/api/admin",  # sent to the back office's API and nowhere else
    )


@router.post("/request-link", status_code=202)
async def request_link(
    body: StaffIn,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
) -> StatusOut:
    """Email a single-use back-office link, but only to staff. The answer is the same for every
    address, so it cannot be used to find out who is on the staff list."""
    email = body.email.lower().strip()
    if email in _staff_emails(settings):
        repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
        if await repo.recent_login_requests(email, within=timedelta(hours=1)) < (
            settings.login_requests_per_hour
        ):
            ttl = settings.login_link_ttl_minutes
            token = await repo.create_login_token(
                email, ttl=timedelta(minutes=ttl), purpose="staff"
            )
            known = await repo.find_user(email)
            link = f"{settings.web_origin}/admin/verify?token={token}"
            await sender.send(
                emails.staff_sign_in_link(
                    email_brand(settings), email, known.full_name if known else None, link, ttl
                )
            )
    return StatusOut(status="sent")


@router.post("/verify")
async def verify(
    body: VerifyIn,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> StaffOut:
    """Exchange the emailed token for a staff cookie. POST, so a mail scanner that opens the link
    cannot use the token up."""
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    used = await repo.consume_token(body.token, ("staff",))
    if used is None or used.email.lower() not in _staff_emails(settings):
        raise BAD_LINK
    user = await repo.get_or_create_user(used.email, attribution={"method": "email_link"})
    _open(
        response,
        await staff_repo(db, settings).create_session(
            user.id, ttl=timedelta(hours=settings.staff_session_hours)
        ),
        settings,
    )
    await record_from(db, "staff.signed_in", user_id=user.id, method="link")
    return StaffOut(email=user.email, full_name=user.full_name)


@router.post("/login")
async def login(
    body: StaffLoginIn,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> StaffOut:
    email = body.email.lower().strip()
    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    if await repo.recent_login_failures(email, within=FAILURE_WINDOW) >= FAILURE_LIMIT:
        raise ApiError(429, "rate_limited", "Too many wrong passwords. Wait 15 minutes.")
    user = await repo.find_user(email)
    ok = await verify_password_async(body.password, user.password_hash if user else None)
    if not ok or user is None or not is_admin(user, settings):
        await repo.record_login_failure(email)
        await record_from(
            db, "staff.login_failed", user_id=user.id if user and is_admin(user, settings) else None
        )
        raise INVALID  # one answer for a wrong password, account or staff list
    await repo.clear_login_failures(email)
    _open(
        response,
        await staff_repo(db, settings).create_session(
            user.id, ttl=timedelta(hours=settings.staff_session_hours)
        ),
        settings,
    )
    await record_from(db, "staff.signed_in", user_id=user.id, method="password")
    return StaffOut(email=user.email, full_name=user.full_name)


@router.get("/me")
async def me(staff: User = Depends(require_admin)) -> StaffOut:  # noqa: B008
    return StaffOut(email=staff.email, full_name=staff.full_name)


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> StatusOut:
    token = request.cookies.get(STAFF_COOKIE_NAME)
    if token:
        repo = staff_repo(db, settings)
        user = await repo.user_for_session(token)
        await repo.delete_session(token)
        if user:
            await record_from(db, "staff.signed_out", user_id=user.id)
    response.delete_cookie(STAFF_COOKIE_NAME, path="/api/admin")
    return StatusOut(status="ok")
