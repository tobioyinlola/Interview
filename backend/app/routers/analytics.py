from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, maybe_user
from app.models import User
from app.services import analytics
from app.services.events import record_from

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class EventIn(BaseModel):
    name: str = Field(max_length=32)
    ts: int | None = None  # milliseconds since 1970, from the device's clock
    route: str | None = Field(default=None, max_length=120)
    props: dict[str, Any] = Field(default_factory=dict)


class BatchIn(BaseModel):
    device_id: str = Field(max_length=36)  # random, kept on the device; not a fingerprint
    session_id: str = Field(max_length=36)
    platform: str = Field(max_length=16)
    form_factor: str = Field(max_length=8)
    app_version: str = Field(default="", max_length=20)
    locale: str = Field(default="", max_length=12)
    viewport: str = Field(default="", max_length=3)
    events: list[EventIn] = Field(max_length=analytics.MAX_PER_BATCH)


class IngestOut(BaseModel):
    accepted: int
    rejected: int
    stop: bool = (
        False  # true: do not send any more (opted out, or the browser asks not to be tracked)
    )


class PreferenceIn(BaseModel):
    opt_out: bool


class PreferenceOut(BaseModel):
    opt_out: bool


def _asks_not_to_be_tracked(request: Request) -> bool:
    """The browser's own 'Global Privacy Control' or 'Do Not Track' signal. Honoured here, on the
    server, so it holds whatever the app's code does."""
    h = request.headers
    return h.get("sec-gpc") == "1" or h.get("dnt") == "1"


@router.post("/events", status_code=202)
async def ingest(
    body: BatchIn,
    request: Request,
    user: User | None = Depends(maybe_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> IngestOut:
    """A batch of usage events from the app on any device. Works before sign-in (anonymous) and
    after (attached to the account). Never fails the app: unknown or malformed events are dropped
    and counted."""
    if _asks_not_to_be_tracked(request) or (user is not None and user.analytics_opt_out):
        return IngestOut(accepted=0, rejected=len(body.events), stop=True)
    ctx = analytics.clean_context(
        device_id=body.device_id,
        session_id=body.session_id,
        platform=body.platform,
        form_factor=body.form_factor,
        app_version=body.app_version,
        locale=body.locale,
        viewport=body.viewport,
    )
    if ctx is None:
        return IngestOut(accepted=0, rejected=len(body.events))
    accepted, rejected = await analytics.ingest(
        db,
        ctx,
        user.id if user else None,
        [e.model_dump() for e in body.events],
        datetime.now(UTC),
    )
    return IngestOut(accepted=accepted, rejected=rejected)


@router.put("/preference")
async def set_preference(
    body: PreferenceIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> PreferenceOut:
    """Turn usage statistics off or on for this account, on every device. Turning them off also
    deletes what was collected about the person."""
    db_user = await db.get(User, user.id)
    if db_user is None:  # cannot happen for a signed-in person; fail closed
        return PreferenceOut(opt_out=body.opt_out)
    changed = db_user.analytics_opt_out != body.opt_out
    db_user.analytics_opt_out = body.opt_out
    if body.opt_out:
        await analytics.forget_user(db, user.id)
    await db.commit()
    if changed:
        await record_from(
            db, "analytics.opted_out" if body.opt_out else "analytics.opted_in", user_id=user.id
        )
    return PreferenceOut(opt_out=body.opt_out)
