"""Guards for running at a large size: nothing scans a table it should not, the scheduler's work is
spread out and bounded, and only one replica leads it."""

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select

import app.models  # noqa: F401  (registers every table)
from app.autoapply import scheduler
from app.db import Base


def test_every_foreign_key_has_an_index_that_starts_with_it() -> None:
    """Deleting an account cascades through many tables; without an index on each foreign key every
    cascade scans its table. Add `index=True` (and a migration) for any new one."""
    missing: list[tuple[str, str]] = []
    for t in Base.metadata.sorted_tables:
        lead = {list(i.columns)[0].name for i in t.indexes}
        for c in t.constraints:
            cols = list(getattr(c, "columns", []))
            if cols and c.__class__.__name__ in ("UniqueConstraint", "PrimaryKeyConstraint"):
                lead.add(cols[0].name)
        lead |= {c.name for c in t.columns if c.unique or c.index}
        missing += [(t.name, fk.parent.name) for fk in t.foreign_keys if fk.parent.name not in lead]
    assert missing == []


def test_shards_spread_people_over_passes_and_cover_everyone() -> None:
    people = [uuid.uuid4() for _ in range(600)]
    base = datetime(2026, 11, 25, 10, 0, tzinfo=UTC).timestamp()
    seen: set[uuid.UUID] = set()
    for minute in range(5):
        now = datetime.fromtimestamp(base + 60 * minute, UTC)
        turn = [p for p in people if scheduler.in_shard(p, now, 5)]
        assert 60 < len(turn) < 180  # roughly a fifth each pass
        seen |= set(turn)
    assert seen == set(people)
    assert all(scheduler.in_shard(p, datetime.now(UTC), 1) for p in people)  # one shard: everyone


async def test_for_each_is_bounded_and_one_failure_does_not_stop_the_rest() -> None:
    running = peak = 0
    done: list[uuid.UUID] = []

    async def work(uid: uuid.UUID) -> None:
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        if uid.int % 7 == 0:
            raise RuntimeError("boom")
        done.append(uid)

    items = [uuid.UUID(int=i + 1) for i in range(40)]
    failed = await scheduler.for_each(items, work, limit=4, what="test pass failed")
    assert peak <= 4
    assert failed == len([i for i in items if i.int % 7 == 0])
    assert len(done) + failed == 40


async def test_only_one_connection_can_lead_the_scheduler(engine) -> None:
    async with engine.connect() as a, engine.connect() as b:
        first = (
            await a.execute(select(func.pg_try_advisory_lock(scheduler.LEADER_LOCK)))
        ).scalar_one()
        second = (
            await b.execute(select(func.pg_try_advisory_lock(scheduler.LEADER_LOCK)))
        ).scalar_one()
        assert first is True and second is False
        await a.execute(select(func.pg_advisory_unlock(scheduler.LEADER_LOCK)))
        third = (
            await b.execute(select(func.pg_try_advisory_lock(scheduler.LEADER_LOCK)))
        ).scalar_one()
        assert third is True
        await b.execute(select(func.pg_advisory_unlock(scheduler.LEADER_LOCK)))


def test_the_live_hub_does_not_remember_every_session_forever() -> None:
    from app.services import live

    hub = live.LiveHub()
    first = uuid.uuid4()
    pin = hub.get_or_create_pin(first)
    for _ in range(live.MAX_REMEMBERED + 50):
        hub.get_or_create_pin(uuid.uuid4())
    assert len(hub.session_pins) == live.MAX_REMEMBERED == len(hub.pin_to_session)
    assert hub.get_session_by_pin(pin) is None  # the oldest was forgotten
