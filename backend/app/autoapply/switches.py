"""Operator kill switches. Flipping one stops new dispatches at once and keeps everything else:
history, reading replies, and settling attempts that are already in flight."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KillSwitch

CHANNELS = ("form", "email", "outreach")
KNOWN = ("global", *(f"channel:{c}" for c in CHANNELS))


def valid(name: str) -> bool:
    return name in KNOWN or (name.startswith("provider:") and 9 < len(name) <= 40)


async def active(db: AsyncSession) -> set[str]:
    rows = await db.execute(select(KillSwitch.name).where(KillSwitch.on.is_(True)))
    return set(rows.scalars().all())


def blocked(on: set[str], channel: str, *adapter_names: str) -> str | None:
    """Why a dispatch must not happen, as a short phrase, or None."""
    if "global" in on:
        return "sending is switched off"
    if f"channel:{channel}" in on:
        return f"{channel} sending is switched off"
    for name in adapter_names:
        if f"provider:{name}" in on:
            return f"{name} is switched off"
    return None


async def set_switch(
    db: AsyncSession, name: str, *, on: bool, reason: str, by: uuid.UUID | None
) -> KillSwitch:
    row = await db.get(KillSwitch, name)
    if row is None:
        row = KillSwitch(name=name)
        db.add(row)
    row.on, row.reason, row.set_by, row.set_at = on, reason[:300], by, datetime.now(UTC)
    await db.commit()
    return row
