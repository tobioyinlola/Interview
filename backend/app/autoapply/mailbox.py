"""Mailbox connections (added properly in the outbound phase)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession


async def connected_address(db: AsyncSession, user_id: uuid.UUID) -> str | None:  # noqa: ARG001
    return None
