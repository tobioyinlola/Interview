"""The durable task queue, in Postgres. Nothing here holds a transaction open while work runs: a
task is claimed in one short statement, worked on, then finished in another.

Statuses: queued -> running -> done; a failure goes back to queued with a later run_at until
max_attempts is used up, then to dead (the dead-letter list the back office shows). A running task
whose lease runs out belonged to a worker that died, and is given back."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement, and_, delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import BgTask

CRITICAL, HIGH, NORMAL, LOW = 0, 10, 20, 30
LIVE = ("queued", "running")


@dataclass
class NewTask:
    kind: str
    priority: int = NORMAL
    resource: str = "light"
    user_id: uuid.UUID | None = None
    campaign_id: uuid.UUID | None = None
    application_id: uuid.UUID | None = None
    key: str | None = None  # at most one queued or running task per key
    payload: dict[str, Any] = field(default_factory=dict)
    run_at: datetime | None = None
    max_attempts: int = 3
    timeout_seconds: int = 300


async def enqueue(db: AsyncSession, task: NewTask, now: datetime) -> uuid.UUID | None:
    """Add a task. With a key that already has a waiting or running task, nothing is added and
    None is returned: asking twice is the same as asking once. The caller commits."""
    row = {
        "id": uuid.uuid4(),
        "kind": task.kind,
        "priority": task.priority,
        "status": "queued",
        "resource": task.resource,
        "user_id": task.user_id,
        "campaign_id": task.campaign_id,
        "application_id": task.application_id,
        "idempotency_key": task.key,
        "payload": task.payload,
        "run_at": task.run_at or now,
        "attempts": 0,
        "max_attempts": task.max_attempts,
        "timeout_seconds": task.timeout_seconds,
        "created_at": now,
    }
    stmt = insert(BgTask).values(**row)
    if task.key is not None:
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["idempotency_key"],
            index_where=text("status IN ('queued', 'running')"),
        )
    res = await db.execute(stmt.returning(BgTask.id))
    return res.scalar_one_or_none()


async def claim(
    maker: async_sessionmaker[AsyncSession],
    *,
    worker: str,
    now: datetime,
    limit: int,
    resources: tuple[str, ...],
    lease: timedelta,
    aging_seconds: int,
    skip_kinds: tuple[str, ...] = (),
) -> list[BgTask]:
    """Take up to `limit` due tasks this worker can run now, most urgent first. A task that has
    waited longer counts as more urgent (one priority step per `aging_seconds`, at most two, and
    never ahead of critical work), so low-priority work is never starved. Other workers skip rows
    this one has locked."""
    if limit <= 0 or not resources:
        return []
    waited = func.extract("epoch", now - BgTask.run_at) / max(1, aging_seconds)
    boost = func.least(func.greatest(waited, 0), 2) * 10  # at most two steps up
    # aged work can overtake other normal work, never a critical task
    effective = func.greatest(BgTask.priority - boost, func.least(BgTask.priority, 5))
    pick = (
        select(BgTask.id)
        .where(
            BgTask.status == "queued",
            BgTask.run_at <= now,
            BgTask.resource.in_(resources),
            *([BgTask.kind.not_in(skip_kinds)] if skip_kinds else []),
        )
        .order_by(effective, BgTask.run_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
        .scalar_subquery()
    )
    async with maker() as db:
        rows = (
            (
                await db.execute(
                    update(BgTask)
                    .where(BgTask.id.in_(pick))
                    .values(
                        status="running",
                        attempts=BgTask.attempts + 1,
                        locked_by=worker,
                        started_at=now,
                        heartbeat_at=now,
                        lease_until=now + lease,
                    )
                    .returning(BgTask)
                )
            )
            .scalars()
            .all()
        )
        await db.commit()
        for r in rows:
            db.expunge(r)
    return list(rows)


async def heartbeat(
    maker: async_sessionmaker[AsyncSession],
    task_id: uuid.UUID,
    worker: str,
    now: datetime,
    lease: timedelta,
) -> bool:
    """Renew the lease. False when the task is no longer ours to run (cancelled, or given away
    because the lease had already run out): the caller stops working on it."""
    async with maker() as db:
        res = await db.execute(
            update(BgTask)
            .where(BgTask.id == task_id, BgTask.status == "running", BgTask.locked_by == worker)
            .values(heartbeat_at=now, lease_until=now + lease)
            .returning(BgTask.id)
        )
        ok = res.scalar_one_or_none() is not None
        await db.commit()
    return ok


async def complete(
    maker: async_sessionmaker[AsyncSession], task: BgTask, worker: str, now: datetime
) -> None:
    async with maker() as db:
        await db.execute(
            update(BgTask)
            .where(BgTask.id == task.id, BgTask.locked_by == worker, BgTask.status == "running")
            .values(
                status="done",
                finished_at=now,
                lease_until=None,
                error_class=None,
                last_error=None,
                run_seconds=(now - (task.started_at or now)).total_seconds(),
            )
        )
        await db.commit()


def backoff(attempt: int) -> timedelta:
    """30 s, 2 min, 8 min, 32 min ... capped at 2 hours."""
    return timedelta(seconds=min(7200, 30 * 4 ** max(0, attempt - 1)))


async def fail(
    maker: async_sessionmaker[AsyncSession],
    task: BgTask,
    worker: str,
    now: datetime,
    *,
    error_class: str,
    message: str,
    retry: bool,
) -> str:
    """Record a failure. Retries later with a growing wait while attempts remain and the error is
    worth retrying; otherwise the task is dead and waits for a person. Returns the new status."""
    again = retry and task.attempts < task.max_attempts
    status = "queued" if again else "dead"
    async with maker() as db:
        await db.execute(
            update(BgTask)
            .where(BgTask.id == task.id, BgTask.locked_by == worker, BgTask.status == "running")
            .values(
                status=status,
                run_at=now + backoff(task.attempts) if again else BgTask.run_at,
                finished_at=None if again else now,
                lease_until=None,
                locked_by=None,
                error_class=error_class[:40],
                last_error=message[:500],
                run_seconds=(now - (task.started_at or now)).total_seconds(),
            )
        )
        await db.commit()
    return status


async def release(
    maker: async_sessionmaker[AsyncSession], task_ids: list[uuid.UUID], worker: str
) -> None:
    """Give unfinished tasks back on a clean shutdown, without counting it as an attempt."""
    if not task_ids:
        return
    async with maker() as db:
        await db.execute(
            update(BgTask)
            .where(BgTask.id.in_(task_ids), BgTask.locked_by == worker, BgTask.status == "running")
            .values(
                status="queued",
                attempts=func.greatest(BgTask.attempts - 1, 0),
                lease_until=None,
                locked_by=None,
            )
        )
        await db.commit()


async def recover_expired(maker: async_sessionmaker[AsyncSession], now: datetime) -> int:
    """A running task whose lease ran out belonged to a worker that stopped. Queue it again, or mark
    it dead if it has used all its attempts. Work that may have reached an employer is protected by
    its own records (submission attempts), which are reconciled before anything is sent again."""
    async with maker() as db:
        expired = and_(BgTask.status == "running", BgTask.lease_until < now)
        dead = await db.execute(
            update(BgTask)
            .where(expired, BgTask.attempts >= BgTask.max_attempts)
            .values(
                status="dead",
                finished_at=now,
                locked_by=None,
                error_class="lease_expired",
                last_error="The worker stopped while running this task.",
            )
        )
        back = await db.execute(
            update(BgTask)
            .where(expired, BgTask.attempts < BgTask.max_attempts)
            .values(
                status="queued",
                run_at=now,
                locked_by=None,
                lease_until=None,
                error_class="lease_expired",
                last_error="The worker stopped while running this task.",
            )
        )
        await db.commit()
    return int(dead.rowcount or 0) + int(back.rowcount or 0)  # type: ignore[attr-defined]


async def cancel(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    kinds: tuple[str, ...] = (),
    task_id: uuid.UUID | None = None,
    now: datetime,
) -> int:
    """Cancel waiting tasks (and flag running ones, whose next heartbeat stops them). The caller
    commits."""
    conds: list[ColumnElement[bool]] = [BgTask.status.in_(LIVE)]
    if task_id is not None:
        conds.append(BgTask.id == task_id)
    if user_id is not None:
        conds.append(BgTask.user_id == user_id)
    if kinds:
        conds.append(BgTask.kind.in_(kinds))
    res = await db.execute(
        update(BgTask).where(*conds).values(status="cancelled", finished_at=now, lease_until=None)
    )
    return int(res.rowcount or 0)  # type: ignore[attr-defined]


async def retry_dead(db: AsyncSession, task_id: uuid.UUID, now: datetime) -> bool:
    """Put a dead task back in the queue with a fresh set of attempts (an operator's decision)."""
    res = await db.execute(
        update(BgTask)
        .where(BgTask.id == task_id, BgTask.status == "dead")
        .values(status="queued", run_at=now, attempts=0, finished_at=None)
        .returning(BgTask.id)
    )
    return res.scalar_one_or_none() is not None


async def purge_finished(db: AsyncSession, now: datetime, keep_days: int = 7) -> int:
    """Finished tasks are history; keep a week of it (dead ones for a month)."""
    res = await db.execute(
        delete(BgTask).where(
            or_(
                and_(
                    BgTask.status.in_(("done", "cancelled")),
                    BgTask.finished_at < now - timedelta(days=keep_days),
                ),
                and_(BgTask.status == "dead", BgTask.finished_at < now - timedelta(days=30)),
            )
        )
    )
    return int(res.rowcount or 0)  # type: ignore[attr-defined]


async def stats(db: AsyncSession, now: datetime) -> dict[str, Any]:
    """What the back office shows to decide when to add capacity: backlog, oldest waiting task, dead
    tasks, and how much worker time each kind used over the last day (its share of the cost)."""
    by_status = dict(
        (await db.execute(select(BgTask.status, func.count()).group_by(BgTask.status))).all()
    )
    oldest = (
        await db.execute(
            select(func.min(BgTask.run_at)).where(BgTask.status == "queued", BgTask.run_at <= now)
        )
    ).scalar_one()
    day = now - timedelta(days=1)
    kinds = (
        await db.execute(
            select(
                BgTask.kind,
                func.count(),
                func.coalesce(func.sum(BgTask.run_seconds), 0.0),
                func.count().filter(BgTask.status == "dead"),
                func.count().filter(BgTask.status == "queued"),
            )
            .where(or_(BgTask.created_at >= day, BgTask.status.in_(("queued", "running", "dead"))))
            .group_by(BgTask.kind)
            .order_by(BgTask.kind)
        )
    ).all()
    return {
        "by_status": {k: int(v) for k, v in by_status.items()},
        "oldest_due_seconds": (now - oldest).total_seconds() if oldest else 0.0,
        "kinds": [
            {
                "kind": k,
                "tasks": int(n),
                "run_seconds": float(sec or 0),
                "dead": int(d),
                "queued": int(q),
            }
            for k, n, sec, d, q in kinds
        ],
    }
