"""The background loop: once a minute, for every running campaign, find jobs (once a local day),
send what may go out within the limits, and settle anything whose outcome was unknown. Every step
is safe to run on several servers at once because each one claims its work in the database."""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import metrics
from app.adapters.interfaces import LlmProvider
from app.autoapply import campaign, discovery, mailsync, outbox, outreach, pipeline
from app.autoapply.adapters import DiscoveryAdapter, FormAdapter, MailboxAdapter
from app.autoapply.clock import utcnow
from app.config import Settings
from app.models import (
    Application,
    Campaign,
    JobPosting,
    MailboxConnection,
    Outreach,
    RecruitingEvent,
    SubmissionAttempt,
)

log = logging.getLogger("app.autoapply.scheduler")


async def plan_outreach(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """Queue a note for each sent application whose listing publishes a hiring contact."""
    prof = await campaign.get_profile(db, user_id)
    if prof is None or not (prof.channels or {}).get("outreach"):
        return 0
    rows = (
        await db.execute(
            select(Application, JobPosting)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .outerjoin(
                Outreach,
                (Outreach.posting_id == Application.posting_id)
                & (Outreach.user_id == Application.user_id),
            )
            .where(
                Application.user_id == user_id,
                Application.status.in_(("submitted", "sent_email")),
                JobPosting.hiring_contact.is_not(None),
                Outreach.id.is_(None),
            )
        )
    ).all()
    for app, posting in rows:
        await outreach.plan(db, app, posting, recipient=None, source="listing", now=now)
    await db.commit()
    return len(rows)


async def _recheck_stale(db: AsyncSession, ctx: pipeline.Context) -> None:
    stale = (
        await db.execute(
            select(Application.id).where(
                Application.user_id == ctx.user_id,
                Application.status == "queued",
                Application.profile_version != ctx.profile.version,
            )
        )
    ).first()
    if stale is not None:
        await pipeline.reevaluate_open(db, ctx)


async def run_user(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    now: datetime,
    *,
    sources: list[DiscoveryAdapter],
    adapters: outbox.Adapters,
    llm: LlmProvider,
) -> None:
    async with maker() as db:
        await discovery.run_if_due(
            db, user_id, now=now, sources=sources, llm=llm, form=adapters.form
        )
        camp = await campaign.current(db, user_id)
        prof = await campaign.get_profile(db, user_id)
        if camp is not None and prof is not None and camp.status == "active":
            ctx = await pipeline.load_context(
                db, user_id, camp, prof, llm=llm, form=adapters.form, now=now
            )
            await _recheck_stale(db, ctx)
        await plan_outreach(db, user_id, now)
    await outbox.dispatch_user(maker, user_id, adapters, now)
    while await outreach.send_next(maker, user_id, adapters, now) == "confirmed":
        pass


async def observe(maker: async_sessionmaker[AsyncSession], now: datetime) -> None:
    """Publish how healthy the system is: queue age, unknown outcomes, stale mailboxes."""
    async with maker() as db:
        oldest = (
            await db.execute(
                select(func.min(Application.updated_at)).where(Application.status == "queued")
            )
        ).scalar_one()
        metrics.autoapply_queue_age.set((now - oldest).total_seconds() if oldest else 0)
        unresolved = (
            await db.execute(
                select(func.count(), func.min(SubmissionAttempt.claimed_at)).where(
                    SubmissionAttempt.state.in_(("claimed", "dispatched", "ambiguous"))
                )
            )
        ).one()
        metrics.autoapply_unresolved.set(unresolved[0])
        metrics.autoapply_unresolved_age.set(
            (now - unresolved[1]).total_seconds() if unresolved[1] else 0
        )
        synced = (
            await db.execute(
                select(
                    func.min(
                        func.coalesce(
                            MailboxConnection.last_synced_at, MailboxConnection.connected_at
                        )
                    )
                ).where(MailboxConnection.status == "connected")
            )
        ).scalar_one()
        metrics.autoapply_mailbox_staleness.set((now - synced).total_seconds() if synced else 0)
        metrics.autoapply_review_events.set(
            (
                await db.execute(
                    select(func.count())
                    .select_from(RecruitingEvent)
                    .where(RecruitingEvent.status == "needs_review")
                )
            ).scalar_one()
        )


async def tick(
    maker: async_sessionmaker[AsyncSession],
    now: datetime,
    *,
    settings: Settings,
    sources: list[DiscoveryAdapter],
    form: FormAdapter,
    mailbox_adapter: MailboxAdapter,
    llm: LlmProvider,
) -> dict[str, Any]:
    """One pass over everything that is due. Returns counts, for logs and tests."""
    adapters = outbox.Adapters(form=form, mailbox=mailbox_adapter, settings=settings)
    async with maker() as db:
        closed = await campaign.close_expired(db, now)
        users = (
            (await db.execute(select(Campaign.user_id).where(Campaign.status == "active")))
            .scalars()
            .all()
        )
        # replies keep arriving after a campaign ends, for as long as the mailbox stays connected
        readers = (
            (
                await db.execute(
                    select(MailboxConnection.user_id).where(MailboxConnection.status == "connected")
                )
            )
            .scalars()
            .all()
        )
    expired = await outbox.expire_unsent(maker, now) if closed else 0
    await outbox.reconcile(maker, adapters, now)  # first give back work a dead worker held
    failures = 0
    for uid in users:
        try:
            await run_user(maker, uid, now, sources=sources, adapters=adapters, llm=llm)
        except Exception:  # noqa: BLE001 - one candidate's problem must not stop the others
            failures += 1
            log.exception("auto-apply pass failed", extra={"fields": {"user": str(uid)}})
    for uid in readers:
        try:
            await mailsync.sync_user(maker, mailbox_adapter, settings, uid, now)
        except Exception:  # noqa: BLE001
            failures += 1
            log.exception("mailbox read failed", extra={"fields": {"user": str(uid)}})
    settled = await outbox.reconcile(maker, adapters, now)
    await observe(maker, now)
    metrics.autoapply_tick_timestamp.set(now.timestamp())
    return {
        "closed": closed,
        "expired": expired,
        "users": len(users),
        "failures": failures,
        **settled,
    }


async def loop(
    maker: async_sessionmaker[AsyncSession],
    *,
    settings: Settings,
    sources: list[DiscoveryAdapter],
    form: FormAdapter,
    mailbox_adapter: MailboxAdapter,
    llm: LlmProvider,
) -> None:
    """Runs for the life of the server when the feature flag is on."""
    while True:
        try:
            await tick(
                maker,
                utcnow(),
                settings=settings,
                sources=sources,
                form=form,
                mailbox_adapter=mailbox_adapter,
                llm=llm,
            )
        except Exception:  # noqa: BLE001
            log.exception("auto-apply tick failed")
        await asyncio.sleep(max(5, settings.autoapply_tick_seconds))
