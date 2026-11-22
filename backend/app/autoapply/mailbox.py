"""The candidate's connected mailbox: connect, read back, disconnect."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.autoapply import crypto
from app.autoapply.adapters import AdapterError, MailboxAdapter
from app.config import Settings
from app.models import MailboxConnection
from app.services.events import record_from


async def get(db: AsyncSession, user_id: uuid.UUID) -> MailboxConnection | None:
    return (
        await db.execute(select(MailboxConnection).where(MailboxConnection.user_id == user_id))
    ).scalar_one_or_none()


async def connected_address(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    """The address, only while the mailbox can actually be used."""
    conn = await get(db, user_id)
    return conn.address if conn and conn.status == "connected" and conn.token_encrypted else None


async def connect(
    db: AsyncSession,
    settings: Settings,
    user_id: uuid.UUID,
    *,
    provider: str,
    address: str,
    credential: str,
    now: datetime,
) -> MailboxConnection:
    """Store a mailbox, replacing any earlier one. The credential is encrypted here."""
    conn = await get(db, user_id)
    if conn is None:
        conn = MailboxConnection(user_id=user_id, provider=provider, address=address)
        db.add(conn)
    conn.provider, conn.address = provider, address
    conn.token_encrypted = crypto.encrypt(settings, credential)
    conn.capabilities = ["send", "read"]
    conn.status, conn.cursor, conn.last_synced_at, conn.connected_at = "connected", None, None, now
    await db.commit()
    await record_from(db, "autoapply.mailbox_connected", user_id=user_id, provider=provider)
    return conn


def token(settings: Settings, conn: MailboxConnection) -> str:
    if conn.status != "connected" or not conn.token_encrypted:
        raise AdapterError("reauth", "The mailbox is not connected.")
    return crypto.decrypt(settings, conn.token_encrypted)


async def mark_reauth(db: AsyncSession, conn: MailboxConnection) -> None:
    """The provider refused our access: sends and reads stop until the person reconnects."""
    if conn.status == "connected":
        conn.status = "reauth_needed"
        await db.commit()
        await record_from(db, "autoapply.mailbox_reauth", user_id=conn.user_id)


async def disconnect(
    db: AsyncSession, settings: Settings, adapter: MailboxAdapter, user_id: uuid.UUID
) -> bool:
    """Stop sends and reads, revoke access where the provider supports it, delete the credential."""
    conn = await get(db, user_id)
    if conn is None or conn.status == "disconnected":
        return False
    if conn.token_encrypted:
        try:
            await adapter.revoke(crypto.decrypt(settings, conn.token_encrypted))
        except (AdapterError, crypto.CryptoError):
            pass
    conn.token_encrypted, conn.status, conn.cursor = None, "disconnected", None
    await db.commit()
    await record_from(db, "autoapply.mailbox_disconnected", user_id=user_id)
    return True
