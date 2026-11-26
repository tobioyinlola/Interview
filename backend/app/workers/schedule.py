"""The scheduler inside the unified worker. Recurring jobs live in bg_schedules with the time each
next falls due, so a restart neither skips nor repeats one. A due row is locked (SKIP LOCKED) while
it fires, so with several workers only one fires it. Firing only adds tasks to the queue; with a
key per person, a person whose previous pass is still waiting is not queued twice."""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.autoapply.scheduler import in_shard
from app.models import BgSchedule, Campaign, HuntSettings, MailboxConnection
from app.workers import queue, registry
from app.workers.context import WorkerContext


def schedules(ctx: WorkerContext) -> dict[str, int]:
    s = ctx.settings
    tick = max(15, s.autoapply_tick_seconds or 60)
    out = {"maintenance": 3600}
    if s.autoapply_enabled:
        out["autoapply"] = tick
    if s.startup_outreach_enabled:
        out["hunt"] = tick
    if s.autoapply_enabled and s.autoapply_discovery_mode == "central":
        out["discovery"] = 300  # boards that are due
        out["discovery.registry"] = 3600  # new boards from the settings and startups
    return out


async def due(ctx: WorkerContext, now: datetime) -> list[str]:
    """Take the schedules that are due (and move their next time on), in one short transaction."""
    wanted = schedules(ctx)
    async with ctx.maker() as db:
        for name, every in wanted.items():
            await db.execute(
                insert(BgSchedule)
                .values(name=name, every_seconds=every, next_run_at=now)
                .on_conflict_do_update(index_elements=["name"], set_={"every_seconds": every})
            )
        rows = (
            (
                await db.execute(
                    select(BgSchedule)
                    .where(BgSchedule.name.in_(wanted), BgSchedule.next_run_at <= now)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for r in rows:
            r.last_run_at = now
            r.next_run_at = now + timedelta(seconds=r.every_seconds)
        names = [r.name for r in rows]
        await db.commit()
    return names


async def next_due_in(ctx: WorkerContext, now: datetime) -> float:
    """Seconds until the next schedule falls due, so an idle worker sleeps instead of polling."""
    async with ctx.maker() as db:
        nxt = (await db.execute(select(func.min(BgSchedule.next_run_at)))).scalar_one()
    return max(1.0, min(60.0, (nxt - now).total_seconds())) if nxt else 5.0


def _new(ctx: WorkerContext, kind: str, *, key: str, user: uuid.UUID | None = None,
         resource: str | None = None) -> queue.NewTask:  # fmt: skip
    spec = registry.spec(kind)
    assert spec is not None, kind
    prio = registry.priorities(ctx.settings.worker_priorities).get(kind, spec.priority)
    return queue.NewTask(
        kind=kind,
        priority=prio,
        resource=resource or spec.resource,
        user_id=user,
        key=key,
        max_attempts=spec.max_attempts,
        timeout_seconds=spec.timeout_seconds,
    )


async def _add(db: AsyncSession, task: queue.NewTask, now: datetime) -> int:
    return 1 if await queue.enqueue(db, task, now) else 0


async def fire(ctx: WorkerContext, name: str, now: datetime) -> int:
    """Queue what a schedule stands for. Returns how many tasks were added."""
    s = ctx.settings
    added = 0
    async with ctx.maker() as db:
        if name == "maintenance":
            added += await _add(db, _new(ctx, "maintenance.housekeeping", key="maintenance"), now)
        elif name == "autoapply":
            for kind in ("autoapply.campaigns", "autoapply.reconcile", "autoapply.observe"):
                added += await _add(db, _new(ctx, kind, key=kind), now)
            users = (
                (await db.execute(select(Campaign.user_id).where(Campaign.status == "active")))
                .scalars()
                .all()
            )
            send_on = "browser" if getattr(ctx.form, "name", "") == "browser" else "email"
            for uid in users:
                if not in_shard(uid, now, s.autoapply_shards):
                    continue
                added += await _add(
                    db, _new(ctx, "autoapply.prepare", key=f"aa.prepare:{uid}", user=uid), now
                )
                added += await _add(
                    db,
                    _new(ctx, "autoapply.send", key=f"aa.send:{uid}", user=uid, resource=send_on),
                    now,
                )
            last = MailboxConnection.last_synced_at
            readers = (
                (
                    await db.execute(
                        select(MailboxConnection.user_id)
                        .where(
                            MailboxConnection.status == "connected",
                            or_(
                                last.is_(None),
                                last <= now - timedelta(minutes=s.mailbox_sync_minutes),
                            ),
                        )
                        .order_by(last.asc().nulls_first())
                        .limit(s.mailbox_sync_batch)
                    )
                )
                .scalars()
                .all()
            )
            for uid in readers:
                added += await _add(db, _new(ctx, "mailbox.sync", key=f"mail:{uid}", user=uid), now)
        elif name == "discovery.registry":
            added += await _add(db, _new(ctx, "discovery.registry", key="discovery.registry"), now)
        elif name == "discovery":
            from app.autoapply import registry as boards

            for sid in await boards.due(db, now):
                task = _new(ctx, "discovery.sync_source", key=f"src:{sid}")
                task.payload = {"source": str(sid)}
                added += await _add(db, task, now)
        elif name == "hunt":
            for kind in ("hunt.reconcile", "hunt.directories", "hunt.research"):
                added += await _add(db, _new(ctx, kind, key=kind), now)
            users = (
                (
                    await db.execute(
                        select(HuntSettings.user_id).where(HuntSettings.enabled.is_(True))
                    )
                )
                .scalars()
                .all()
            )
            for uid in users:
                if in_shard(uid, now, s.autoapply_shards):
                    added += await _add(
                        db, _new(ctx, "hunt.user_pass", key=f"hunt:{uid}", user=uid), now
                    )
        await db.commit()
    return added
