"""What the scheduler does for startup outreach on each pass."""

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.interfaces import LlmProvider
from app.autoapply.adapters import MailboxAdapter
from app.config import Settings
from app.hunt import directory, engine, research
from app.models import HuntSettings, Startup
from app.services.fetcher import Fetcher

log = logging.getLogger("app.hunt")
RESEARCH_PER_PASS = 4


async def research_pending(
    maker: async_sessionmaker[AsyncSession],
    fetcher: Fetcher,
    llm: LlmProvider,
    now: datetime,
    limit: int = RESEARCH_PER_PASS,
) -> int:
    done = 0
    async with maker() as db:
        rows = (
            (
                await db.execute(
                    select(Startup)
                    .where(Startup.status == "new")
                    .order_by((Startup.region == "other"), Startup.created_at)  # placed ones first
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        for s in rows:
            try:
                await research.research(db, fetcher, llm, s, now)
                done += 1
            except Exception:  # noqa: BLE001 - one site must not stop the rest
                await db.rollback()
                log.exception("research failed", extra={"fields": {"startup": str(s.id)}})
    return done


async def run(
    maker: async_sessionmaker[AsyncSession],
    now: datetime,
    *,
    settings: Settings,
    adapter: MailboxAdapter,
    llm: LlmProvider,
    fetcher: Fetcher | None = None,
) -> dict[str, int]:
    fetcher = fetcher or Fetcher(text_max_chars=directory.PAGE_CHARS, links_max=directory.LINKS_MAX)
    try:
        async with maker() as db:
            await directory.refresh_due(db, fetcher, llm, now)
            await directory.scout(db, fetcher, llm, now)
    except Exception:  # noqa: BLE001 - a directory being down must not stop the rest
        log.exception("directory refresh failed")
    researched = await research_pending(maker, fetcher, llm, now)
    await engine.reconcile(maker, adapter, settings, now)
    async with maker() as db:
        users = (
            (await db.execute(select(HuntSettings.user_id).where(HuntSettings.enabled.is_(True))))
            .scalars()
            .all()
        )
    sent = 0
    for uid in users:
        try:
            out = await engine.tick_user(maker, uid, adapter, settings, llm, now)
            sent += 1 if out["sent"] == "sent" else 0
        except Exception:  # noqa: BLE001
            log.exception("startup outreach pass failed", extra={"fields": {"user": str(uid)}})
    return {"researched": researched, "users": len(users), "sent": sent}
