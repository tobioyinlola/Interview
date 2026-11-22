"""The back office's Auto-Apply page: how it is doing, what is stuck, and the kill switches."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.autoapply import switches
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import require_admin
from app.errors import ApiError
from app.models import User
from app.routers.autoapply import get_now
from app.schemas.admin_autoapply import AutoApplyAdminOut, SwitchIn, SwitchOut
from app.services import admin_autoapply
from app.services.events import record_from

router = APIRouter(prefix="/api/admin/autoapply", tags=["admin"])


@router.get("")
async def overview(
    days: int = Query(30, ge=1, le=365),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> AutoApplyAdminOut:
    return await admin_autoapply.overview(db, settings, now, days)


@router.put("/switches/{name}")
async def flip(
    name: str,
    body: SwitchIn,
    admin: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> SwitchOut:
    """Turn a kill switch on or off. Takes effect on the next claim, without a deploy; attempts
    already sent are still settled."""
    if not switches.valid(name):
        raise ApiError(
            422,
            "unknown_switch",
            "That is not a switch. Use global, channel:<name> or provider:<name>.",
        )
    row = await switches.set_switch(db, name, on=body.on, reason=body.reason, by=admin.id)
    await record_from(
        db,
        "admin.switch",
        user_id=None,
        actor_id=admin.id,
        name=name,
        on=body.on,
        reason=body.reason,
    )
    return SwitchOut(name=row.name, on=row.on, reason=row.reason, set_at=row.set_at)
