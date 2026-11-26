"""Jobs are read once for everyone: a registry of boards, each read on its own schedule, and each
candidate matched against the stored jobs instead of every candidate asking every board."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.autoapply import registry
from app.autoapply.adapters import AdapterError, RawPosting
from app.models import JobAlias, JobPosting, JobSource, Startup

from .conftest import apps, job, start


class Board:
    """A stand-in for one company's job board: lists what the test puts on it, counts reads."""

    name = "greenhouse"
    broad = True

    def __init__(self, jobs: list[RawPosting]) -> None:
        self.jobs = jobs
        self.reads = 0
        self.down = False

    async def search(self, criteria, now):  # type: ignore[no-untyped-def]
        self.reads += 1
        if self.down:
            raise AdapterError("unavailable", "The job board is busy.", transient=True)
        return list(self.jobs)


def listing(n: int, **over) -> RawPosting:  # type: ignore[no-untyped-def]
    return job(
        n, source="greenhouse", source_url=f"https://boards.greenhouse.io/acme/jobs/{n}", **over
    )


async def source(maker, clock, kind="greenhouse", board="acme"):  # type: ignore[no-untyped-def]
    async with maker() as db:
        await registry.register(db, kind, board, origin="settings", now=clock.now)
        await db.commit()
        return (await db.execute(select(JobSource).where(JobSource.board == board))).scalar_one()


async def test_a_board_is_registered_once_from_the_settings_and_from_researched_startups(
    maker, settings, clock
):
    settings.autoapply_discovery_sources = "greenhouse,lever,remotive"
    settings.autoapply_greenhouse_boards = "acme, Acme ,beta"
    async with maker() as db:
        db.add(
            Startup(
                name="Gamma",
                domain="gamma.io",
                website="https://gamma.io",
                directory="YC",
                directory_url="https://d.test",
                region="us",
                status="researched",
                research={
                    "careers_url": "https://jobs.lever.co/gamma",
                    "openings": [{"title": "PM", "url": "https://jobs.ashbyhq.com/gamma-ai/123"}],
                },
            )  # fmt: skip
        )
        await db.commit()
        assert await registry.seed(db, settings, clock.now) == 5
        await db.commit()
        assert await registry.seed(db, settings, clock.now) == 0  # nothing is registered twice
        rows = {
            (s.kind, s.board, s.origin) for s in (await db.execute(select(JobSource))).scalars()
        }
    assert rows == {
        ("greenhouse", "acme", "settings"),
        ("greenhouse", "beta", "settings"),
        ("remotive", "", "settings"),
        ("lever", "gamma", "startup"),
        ("ashby", "gamma-ai", "startup"),
    }


async def test_a_board_is_read_stored_and_read_less_often_while_it_does_not_change(maker, clock):
    src = await source(maker, clock)
    board = Board([listing(1), listing(2)])
    async with maker() as db:
        out = await registry.sync(db, src.id, clock.now, reader=board)
    assert out == {"changed": True, "listed": 2, "closed": 0}
    async with maker() as db:
        s = await db.get(JobSource, src.id)
        assert s.health == "ok" and s.every_minutes == 180  # busy: read more often
        aliases = (
            (await db.execute(select(JobAlias).where(JobAlias.job_source_id == src.id)))
            .scalars()
            .all()
        )
        assert len(aliases) == 2
    later = clock.now + timedelta(hours=3)
    async with maker() as db:
        out = await registry.sync(db, src.id, later, reader=board)
        s = await db.get(JobSource, src.id)
        seen = (await db.execute(select(JobPosting.last_seen_at))).scalars().all()
    assert out["changed"] is False and s.every_minutes == 270  # quiet: read less often
    assert all(t == later for t in seen)  # still listed, so still open


async def test_a_listing_that_leaves_its_board_is_closed(maker, clock):
    src = await source(maker, clock)
    board = Board([listing(1), listing(2)])
    async with maker() as db:
        await registry.sync(db, src.id, clock.now, reader=board)
    board.jobs = [listing(1)]
    async with maker() as db:
        out = await registry.sync(db, src.id, clock.now + timedelta(hours=1), reader=board)
        closed = (
            (
                await db.execute(
                    select(JobPosting.requisition_id).where(JobPosting.expires_at.is_not(None))
                )
            )
            .scalars()
            .all()
        )
    assert out["closed"] == 1 and closed == ["REQ-2"]


async def test_a_board_that_keeps_failing_is_marked_and_read_rarely(maker, clock):
    src = await source(maker, clock)
    board = Board([])
    board.down = True
    async with maker() as db:
        for _ in range(3):
            await registry.sync(db, src.id, clock.now, reader=board)
        s = await db.get(JobSource, src.id)
    assert s.health == "failing" and s.failures == 3
    assert s.next_sync_at == clock.now + timedelta(minutes=240)
    async with maker() as db:
        assert await registry.due(db, clock.now) == []


async def test_in_central_mode_a_candidate_is_matched_against_stored_jobs_without_asking_any_board(
    ada, maker, settings, clock, tick
):
    settings.autoapply_discovery_mode = "central"
    await start(ada)
    src = await source(maker, clock)
    board = Board([listing(1), listing(2, title="Head of Facilities")])
    async with maker() as db:
        await registry.sync(db, src.id, clock.now, reader=board)
    await tick()
    titles = sorted(a["posting"]["title"] for a in await apps(ada))
    assert titles == ["Senior Product Manager"]  # only roles that could fit are looked at
    assert board.reads == 1  # the candidate's run did not read the board again


@pytest.mark.parametrize("kind", ["greenhouse", "lever", "ashby", "workable", "remotive"])
def test_every_registered_kind_has_a_reader(kind) -> None:  # type: ignore[no-untyped-def]
    assert registry.adapter(kind, "acme") is not None
