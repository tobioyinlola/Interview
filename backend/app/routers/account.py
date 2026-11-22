from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailSender
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, email_brand, get_email_sender, me_out
from app.errors import ApiError
from app.models import User
from app.repositories import AccountRepo, AuthRepo
from app.schemas.api import MeOut, PasswordIn, StatusOut
from app.security import COOKIE_NAME
from app.services import email_templates as emails
from app.services.events import record_from
from app.services.passwords import hash_password_async, password_problem, verify_password_async

router = APIRouter(prefix="/api", tags=["account"])


@router.delete("/account", status_code=202)
async def delete_account(
    response: Response,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
) -> StatusOut:
    """Delete the user and everything they own at once. Backups age out within 30 days. One
    confirmation email goes out afterwards, and the address is kept for nothing else."""
    email, name = user.email, user.full_name
    # recorded first and without the person attached: their own events go with the account
    await record_from(db, "user.deleted")
    await AccountRepo(db, user.id).delete_everything()
    response.delete_cookie(COOKIE_NAME, path="/")
    await sender.send(emails.account_deleted(email_brand(settings), email, name))
    return StatusOut(status="accepted")


WRONG_PASSWORD = ApiError(401, "wrong_password", "Your current password is not right.")


@router.put("/account/password")
async def change_password(
    body: PasswordIn,
    response: Response,
    request: Request,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    sender: EmailSender = Depends(get_email_sender),  # noqa: B008
) -> MeOut:
    """Change the password, or set a first one if the person only used email links or Google.
    Changing it needs the current password, every other device is signed out, and an email tells
    the account owner."""
    from app.routers.auth import LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW, _open_session, _ttl

    repo = AuthRepo(db, settings.cookie_secret.get_secret_value())
    if user.password_hash is not None:
        if (
            await repo.recent_login_failures(user.email, within=LOGIN_FAILURE_WINDOW)
            >= LOGIN_FAILURE_LIMIT
        ):
            raise ApiError(429, "rate_limited", "Too many wrong passwords. Wait 15 minutes.")
        if not body.current_password or not await verify_password_async(
            body.current_password, user.password_hash
        ):
            await repo.record_login_failure(user.email)
            raise WRONG_PASSWORD
        if body.current_password == body.new_password:
            raise ApiError(422, "same_password", "Choose a password you have not been using.")
    problem = password_problem(body.new_password, user.email)
    if problem:
        raise ApiError(422, "weak_password", problem)
    first = user.password_hash is None
    await repo.set_password(user.id, await hash_password_async(body.new_password))
    await repo.clear_login_failures(user.email)
    await repo.revoke_sessions(user.id)  # every device, this one included, then a fresh session
    _open_session(response, await repo.create_session(user.id, ttl=_ttl(settings)), settings)
    await db.refresh(user)
    await sender.send(
        emails.password_changed(
            email_brand(settings), user.email, user.full_name, datetime.now(UTC)
        )
    )
    await record_from(db, "user.password_changed", user_id=user.id, first=first)
    _ = (request, timedelta)
    return me_out(user, settings)
