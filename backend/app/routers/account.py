from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.email import EmailSender
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, email_brand, get_email_sender
from app.models import User
from app.repositories import AccountRepo
from app.schemas.api import StatusOut
from app.security import COOKIE_NAME
from app.services import email_templates as emails

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
    await AccountRepo(db, user.id).delete_everything()
    response.delete_cookie(COOKIE_NAME, path="/")
    await sender.send(emails.account_deleted(email_brand(settings), email, name))
    return StatusOut(status="accepted")
