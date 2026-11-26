"""The background loop: once a minute, for every running campaign, find jobs (once a local day),
send what may go out within the limits, and settle anything whose outcome was unknown. Every step
is safe to run on several servers at once because each one claims its work in the database."""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
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

# One number every replica agrees on: whoever holds this Postgres lock is the one scheduler.
LEADER_LOCK = 7_204_181_001


def in_shard(user_id: uuid.UUID, now: datetime, shards: int) -> bool:
    """Whether this person is handled on this pass when the work is spread over `shards` passes."""
    return shards <= 1 or (user_id.int % shards) == (int(now.timestamp() // 60) % shards)


async def for_each(
    items: Sequence[uuid.UUID],
    work: Callable[[uuid.UUID], Awaitable[Any]],
    *,
    limit: int,
    what: str,
) -> int:
    """Run `work` for every item, `limit` at a time. One item failing never stops the others; the
    number that failed is returned."""
    gate = asyncio.Semaphore(max(1, limit))
    failed = 0

    async def one(uid: uuid.UUID) -> None:
        nonlocal failed
        async with gate:
            try:
                await work(uid)
            except Exception:  # noqa: BLE001 - one candidate's problem must not stop the others
                failed += 1
                log.exception(what, extra={"fields": {"user": str(uid)}})

    await asyncio.gather(*(one(u) for u in items))
    return failed


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


async def prepare_user(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    now: datetime,
    *,
    sources: list[DiscoveryAdapter],
    adapters: outbox.Adapters,
    llm: LlmProvider,
) -> None:
    """Find and match jobs, and plan follow-up notes: reading, no sending."""
    s = adapters.settings
    central = s.autoapply_discovery_mode == "central"
    async with maker() as db:
        await discovery.run_if_due(
            db,
            user_id,
            now=now,
            # central: the worker has already read the boards for everyone; only the fixture
            # (local and staging) is still read per person
            sources=[x for x in sources if x.name == "fixture"] if central else sources,
            llm=llm,
            form=adapters.form,
            stored=(s.discovery_lookback_days, s.discovery_max_per_run) if central else None,
        )
        camp = await campaign.current(db, user_id)
        prof = await campaign.get_profile(db, user_id)
        if camp is not None and prof is not None and camp.status == "active":
            ctx = await pipeline.load_context(
                db, user_id, camp, prof, llm=llm, form=adapters.form, now=now
            )
            await _recheck_stale(db, ctx)
            await pipeline.prepare_waiting(db, ctx)  # the best waiting matches, as room frees
        await plan_outreach(db, user_id, now)


async def send_user(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    now: datetime,
    *,
    adapters: outbox.Adapters,
) -> None:
    """Send what is approved and due: applications (forms, email) and hiring notes. Every send is
    claimed in the submission log first, so running this twice never sends twice."""
    await outbox.dispatch_user(maker, user_id, adapters, now)
    while await outreach.send_next(maker, user_id, adapters, now) == "confirmed":
        pass


async def run_user(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    now: datetime,
    *,
    sources: list[DiscoveryAdapter],
    adapters: outbox.Adapters,
    llm: LlmProvider,
) -> None:
    await prepare_user(maker, user_id, now, sources=sources, adapters=adapters, llm=llm)
    await send_user(maker, user_id, now, adapters=adapters)


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
        # only the mailboxes that are due, longest-waiting first, a bounded number per pass
        due = now - timedelta(minutes=settings.mailbox_sync_minutes)
        readers = (
            (
                await db.execute(
                    select(MailboxConnection.user_id)
                    .where(
                        MailboxConnection.status == "connected",
                        or_(
                            MailboxConnection.last_synced_at.is_(None),
                            MailboxConnection.last_synced_at <= due,
                        ),
                    )
                    .order_by(MailboxConnection.last_synced_at.asc().nulls_first())
                    .limit(settings.mailbox_sync_batch)
                )
            )
            .scalars()
            .all()
        )
    expired = await outbox.expire_unsent(maker, now) if closed else 0
    await outbox.reconcile(maker, adapters, now)  # first give back work a dead worker held
    mine = [u for u in users if in_shard(u, now, settings.autoapply_shards)]

    async def apply_for(uid: uuid.UUID) -> None:
        await run_user(maker, uid, now, sources=sources, adapters=adapters, llm=llm)

    async def read_for(uid: uuid.UUID) -> None:
        await mailsync.sync_user(maker, mailbox_adapter, settings, uid, now)

    failures = await for_each(
        mine, apply_for, limit=settings.autoapply_concurrency, what="auto-apply pass failed"
    )
    failures += await for_each(
        readers, read_for, limit=settings.autoapply_concurrency, what="mailbox read failed"
    )
    settled = await outbox.reconcile(maker, adapters, now)
    if settings.startup_outreach_enabled:
        from app.hunt import jobs

        await jobs.run(maker, now, settings=settings, adapter=mailbox_adapter, llm=llm)
    await observe(maker, now)
    metrics.autoapply_tick_timestamp.set(now.timestamp())
    return {
        "closed": closed,
        "expired": expired,
        "users": len(mine),
        "failures": failures,
        **settled,
    }


async def housekeeping(maker: async_sessionmaker[AsyncSession], settings: Settings) -> None:
    """Hourly clean-up of what only ever grows: sign-ins that ran out, and the old event log."""
    from sqlalchemy import delete

    from app.models import AuthSession
    from app.services.analytics import purge_old_client_events
    from app.services.events import purge_old_events

    try:
        async with maker() as db:
            await db.execute(delete(AuthSession).where(AuthSession.expires_at < utcnow()))
            await db.commit()
    except Exception:  # noqa: BLE001
        log.exception("expired sign-in clean-up failed")
    await purge_old_events(maker, settings.event_retention_days)
    await purge_old_client_events(maker, settings.analytics_retention_days)


async def loop(
    maker: async_sessionmaker[AsyncSession],
    *,
    settings: Settings,
    sources: list[DiscoveryAdapter],
    form: FormAdapter,
    mailbox_adapter: MailboxAdapter,
    llm: LlmProvider,
) -> None:
    """Runs for the life of the server when the feature flag is on. With several replicas every one
    runs this loop, but a Postgres advisory lock lets only one of them do the work at a time; if the
    leader dies its connection closes, the lock is freed and another takes over."""
    from app.db import get_engine

    last_housekeeping = 0.0
    while True:
        try:
            async with get_engine().connect() as lock:
                led = bool(
                    (
                        await lock.execute(select(func.pg_try_advisory_lock(LEADER_LOCK)))
                    ).scalar_one()
                )
                if led:
                    try:
                        now = utcnow()
                        await tick(
                            maker,
                            now,
                            settings=settings,
                            sources=sources,
                            form=form,
                            mailbox_adapter=mailbox_adapter,
                            llm=llm,
                        )
                        if now.timestamp() - last_housekeeping >= 3600:
                            last_housekeeping = now.timestamp()
                            await housekeeping(maker, settings)
                    finally:
                        await lock.execute(select(func.pg_advisory_unlock(LEADER_LOCK)))
        except Exception:  # noqa: BLE001
            log.exception("auto-apply tick failed")
        await asyncio.sleep(max(5, settings.autoapply_tick_seconds))
