from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.models import User
from app.repositories import AccountRepo
from app.schemas.api import StatusOut
from app.security import COOKIE_NAME

router = APIRouter(prefix="/api", tags=["account"])


@router.delete("/account", status_code=202)
async def delete_account(
    response: Response,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> StatusOut:
    """Delete the user and everything they own at once. Backups age out within 30 days."""
    await AccountRepo(db, user.id).delete_everything()
    response.delete_cookie(COOKIE_NAME, path="/")
    return StatusOut(status="accepted")
