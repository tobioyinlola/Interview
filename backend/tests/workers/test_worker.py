"""The unified background worker: the durable queue, the dispatcher's limits and recovery, and the
database-backed scheduler."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import app.workers.handlers  # noqa: F401
from app.models import BgTask, Campaign, SearchProfile, User
from app.workers import queue, registry, schedule
from app.workers.context import WorkerContext
from app.workers.dispatcher import BREAKER_FAILURES, Dispatcher
from app.workers.queue import CRITICAL, LOW, NORMAL, NewTask

T0 = datetime(2026, 11, 26, 10, 0, tzinfo=UTC)
LEASE = timedelta(seconds=60)


@pytest.fixture
def maker(engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(engine, expire_on_commit=False)


async def add(maker, task: NewTask, now: datetime = T0):  # type: ignore[no-untyped-def]
    async with maker() as db:
        tid = await queue.enqueue(db, task, now)
        await db.commit()
    return tid


async def row(maker, tid) -> BgTask:  # type: ignore[no-untyped-def]
    async with maker() as db:
        return (await db.execute(select(BgTask).where(BgTask.id == tid))).scalar_one()


async def take(maker, now=T0, limit=1, resources=("light",), worker="w1"):  # type: ignore[no-untyped-def]
    return await queue.claim(
        maker, worker=worker, now=now, limit=limit, resources=resources, lease=LEASE,
        aging_seconds=300,
    )  # fmt: skip


# ------------------------------------------------------------------ the queue


async def test_a_key_allows_one_waiting_task_and_a_finished_one_does_not_block_the_next(maker):
    first = await add(maker, NewTask("t.x", key="k"))
    assert first is not None
    assert await add(maker, NewTask("t.x", key="k")) is None  # asking twice is asking once
    (t,) = await take(maker)
    assert await add(maker, NewTask("t.x", key="k")) is None  # still running: still one
    await queue.complete(maker, t, "w1", T0)
    assert await add(maker, NewTask("t.x", key="k")) is not None


async def test_most_urgent_first_and_waiting_long_enough_makes_low_work_urgent(maker):
    low_old = await add(maker, NewTask("t.low", priority=LOW, run_at=T0 - timedelta(hours=2)))
    normal = await add(maker, NewTask("t.normal", priority=NORMAL))
    crit = await add(maker, NewTask("t.crit", priority=CRITICAL))
    order = [(await take(maker))[0].id for _ in range(3)]
    # critical first; the low task that waited two hours has aged past the fresh normal one
    assert order == [crit, low_old, normal]


async def test_two_workers_never_claim_the_same_task(maker):
    ids = {await add(maker, NewTask("t.x")) for _ in range(6)}
    got = await asyncio.gather(*(take(maker, worker=f"w{i}", limit=2) for i in range(4)))
    claimed = [t.id for batch in got for t in batch]
    assert len(claimed) == len(set(claimed)) == 6 and set(claimed) == ids


async def test_only_resources_with_a_free_slot_are_claimed_and_future_tasks_wait(maker):
    await add(maker, NewTask("t.b", resource="browser"))
    await add(maker, NewTask("t.later", run_at=T0 + timedelta(minutes=5)))
    assert await take(maker, resources=("light",)) == []
    assert len(await take(maker, resources=("browser",))) == 1
    assert len(await take(maker, now=T0 + timedelta(minutes=6))) == 1


async def test_a_failure_retries_with_a_growing_wait_then_goes_to_the_dead_letter_list(maker):
    tid = await add(maker, NewTask("t.x", max_attempts=2))
    (t,) = await take(maker)
    assert (
        await queue.fail(maker, t, "w1", T0, error_class="Boom", message="x", retry=True)
        == "queued"
    )
    r = await row(maker, tid)
    assert r.status == "queued" and r.run_at == T0 + timedelta(seconds=30) and r.attempts == 1
    (t,) = await take(maker, now=T0 + timedelta(minutes=1))
    assert (
        await queue.fail(maker, t, "w1", T0, error_class="Boom", message="x", retry=True) == "dead"
    )
    r = await row(maker, tid)
    assert r.status == "dead" and r.error_class == "Boom" and r.attempts == 2


async def test_a_task_whose_worker_died_is_given_back_or_buried(maker):
    again = await add(maker, NewTask("t.x", max_attempts=3))
    spent = await add(maker, NewTask("t.y", max_attempts=1))
    await take(maker, limit=2)
    assert await queue.recover_expired(maker, T0 + timedelta(seconds=30)) == 0  # lease still good
    assert await queue.recover_expired(maker, T0 + timedelta(minutes=5)) == 2
    assert (await row(maker, again)).status == "queued"
    assert (await row(maker, spent)).status == "dead"


async def test_a_clean_shutdown_gives_work_back_without_using_an_attempt(maker):
    tid = await add(maker, NewTask("t.x"))
    (t,) = await take(maker)
    await queue.release(maker, [t.id], "w1")
    r = await row(maker, tid)
    assert r.status == "queued" and r.attempts == 0 and r.locked_by is None


async def test_a_cancelled_task_stops_at_its_next_heartbeat(maker):
    tid = await add(maker, NewTask("t.x"))
    (t,) = await take(maker)
    assert await queue.heartbeat(maker, t.id, "w1", T0, LEASE) is True
    async with maker() as db:
        assert await queue.cancel(db, task_id=tid, now=T0) == 1
        await db.commit()
    assert await queue.heartbeat(maker, t.id, "w1", T0, LEASE) is False


# ------------------------------------------------------------------ the dispatcher

RUNNING: dict[str, int] = {}
PEAK: dict[str, int] = {}
SEEN: list[str] = []


def _counting(name: str, pause: float):  # type: ignore[no-untyped-def]
    async def handler(ctx, t):  # type: ignore[no-untyped-def]
        RUNNING[name] = RUNNING.get(name, 0) + 1
        PEAK[name] = max(PEAK.get(name, 0), RUNNING[name])
        await asyncio.sleep(pause)
        RUNNING[name] -= 1
        SEEN.append(name)

    return handler


registry.task("test.browser", resource="browser")(_counting("browser", 0.05))
registry.task("test.light", resource="light")(_counting("light", 0.05))
registry.task("test.slow", resource="light", timeout_seconds=1)(_counting("slow", 5))


async def _boom(ctx, t):  # type: ignore[no-untyped-def]
    raise RuntimeError("the site is down")


async def _refuse(ctx, t):  # type: ignore[no-untyped-def]
    raise registry.Permanent("not allowed")


registry.task("test.boom")(_boom)
registry.task("test.refuse")(_refuse)


def ctx_for(maker, settings) -> WorkerContext:  # type: ignore[no-untyped-def]
    settings.worker_max_concurrent_tasks = 4
    settings.worker_max_browser_sessions = 1
    return WorkerContext(maker=maker, settings=settings)


async def drain(d: Dispatcher, rounds: int = 200) -> None:
    for _ in range(rounds):
        await d.fill()
        if not d.running:
            return
        await asyncio.sleep(0.02)


@pytest.fixture(autouse=True)
def _reset() -> None:
    RUNNING.clear()
    PEAK.clear()
    SEEN.clear()


async def test_browser_work_runs_one_at_a_time_while_light_work_shares_the_rest(maker, settings):
    for _ in range(3):
        await add(maker, NewTask("test.browser", resource="browser"), datetime.now(UTC))
    for _ in range(6):
        await add(maker, NewTask("test.light"), datetime.now(UTC))
    d = Dispatcher(ctx_for(maker, settings))
    await drain(d)
    assert SEEN.count("browser") == 3 and SEEN.count("light") == 6
    assert PEAK["browser"] == 1
    assert 1 < PEAK["light"] <= 4


async def test_heavy_work_waits_while_the_machine_is_short_of_room(maker, settings, monkeypatch):
    monkeypatch.setattr("app.workers.dispatcher.heavy_allowed", lambda s, p: False)
    await add(maker, NewTask("test.browser", resource="browser"), datetime.now(UTC))
    await add(maker, NewTask("test.light"), datetime.now(UTC))
    d = Dispatcher(ctx_for(maker, settings))
    await drain(d)
    assert SEEN == ["light"]
    async with maker() as db:
        left = (
            await db.execute(select(BgTask.status).where(BgTask.kind == "test.browser"))
        ).scalar_one()
    assert left == "queued"


async def test_a_task_that_runs_too_long_is_stopped_and_retried_later(maker, settings):
    tid = await add(maker, NewTask("test.slow", timeout_seconds=1), datetime.now(UTC))
    d = Dispatcher(ctx_for(maker, settings))
    await drain(d)
    r = await row(maker, tid)
    assert r.status == "queued" and r.error_class == "timeout" and "slow" not in SEEN


async def test_a_refusal_goes_straight_to_dead_and_an_unknown_kind_too(maker, settings):
    a = await add(maker, NewTask("test.refuse"), datetime.now(UTC))
    b = await add(maker, NewTask("no.such.kind"), datetime.now(UTC))
    d = Dispatcher(ctx_for(maker, settings))
    await drain(d)
    assert (await row(maker, a)).status == "dead" and (await row(maker, a)).attempts == 1
    assert (await row(maker, b)).error_class == "unknown_kind"


async def test_a_kind_that_keeps_failing_is_paused_and_others_carry_on(maker, settings):
    now = datetime.now(UTC)
    for _ in range(BREAKER_FAILURES + 2):
        await add(maker, NewTask("test.boom", max_attempts=1), now)
    d = Dispatcher(ctx_for(maker, settings))
    await drain(d)
    async with maker() as db:
        statuses = (
            (await db.execute(select(BgTask.status).where(BgTask.kind == "test.boom")))
            .scalars()
            .all()
        )
    # the first failures may overlap (several run at once); after that the kind is paused
    assert statuses.count("dead") >= BREAKER_FAILURES and statuses.count("queued") >= 1
    await add(maker, NewTask("test.light"), now)
    await drain(d)
    assert "light" in SEEN


async def test_shutdown_hands_running_work_back(maker, settings):
    tid = await add(maker, NewTask("test.slow", timeout_seconds=60), datetime.now(UTC))
    d = Dispatcher(ctx_for(maker, settings))
    await d.fill()
    await asyncio.sleep(0.05)
    await d.shutdown(grace=0.1)
    r = await row(maker, tid)
    assert r.status == "queued" and r.attempts == 0


# ------------------------------------------------------------------ the scheduler


async def test_a_schedule_fires_once_however_many_workers_ask(maker, settings):
    settings.autoapply_enabled = True
    c = WorkerContext(maker=maker, settings=settings)
    first = await asyncio.gather(*(schedule.due(c, T0) for _ in range(3)))
    fired = [n for names in first for n in names]
    assert sorted(fired) == ["autoapply", "maintenance"]
    assert await schedule.due(c, T0 + timedelta(seconds=30)) == []  # not due again yet
    assert await schedule.due(c, T0 + timedelta(seconds=61)) == ["autoapply"]


async def test_firing_queues_each_person_once_and_never_twice_while_waiting(maker, settings):
    settings.autoapply_enabled = True
    async with maker() as db:
        uid = uuid.uuid4()
        db.add(User(id=uid, email="ada@example.com"))
        await db.flush()
        prof = SearchProfile(user_id=uid)
        db.add(prof)
        await db.flush()
        db.add(
            Campaign(
                user_id=uid,
                profile_id=prof.id,
                timezone="UTC",
                activated_at=T0,
                ends_at=T0 + timedelta(days=30),
                daily_application_cap=10,
                daily_outreach_cap=5,
                policy_version="t",
            )
        )
        await db.commit()
    c = WorkerContext(maker=maker, settings=settings)
    added = await schedule.fire(c, "autoapply", T0)
    assert added == 5  # campaigns, reconcile, observe, and this person's prepare and send
    assert await schedule.fire(c, "autoapply", T0 + timedelta(minutes=1)) == 0
    async with maker() as db:
        kinds = sorted(
            (await db.execute(select(BgTask.kind).where(BgTask.user_id == uid))).scalars()
        )
    assert kinds == ["autoapply.prepare", "autoapply.send"]


async def test_the_real_housekeeping_and_campaign_tasks_run_through_the_worker(maker, settings):
    settings.autoapply_enabled = True
    c = WorkerContext(maker=maker, settings=settings)
    now = datetime.now(UTC)
    await schedule.fire(c, "maintenance", now)
    async with maker() as db:
        await queue.enqueue(db, schedule._new(c, "autoapply.campaigns", key="c"), now)
        await db.commit()
    d = Dispatcher(c)
    await drain(d)
    async with maker() as db:
        done = dict((await db.execute(select(BgTask.kind, BgTask.status))).all())
    assert done == {"maintenance.housekeeping": "done", "autoapply.campaigns": "done"}


async def test_the_worker_refuses_to_start_unless_the_api_has_handed_background_work_over(settings):
    from app.workers import main

    settings.background_mode = "api"
    with pytest.raises(SystemExit):
        await main.run(settings)


# ------------------------------------------------------------------ the back office


@pytest.fixture
async def boss(new_client, staff_sign_in, settings):  # type: ignore[no-untyped-def]
    settings.admin_emails = "boss@example.com"
    async with new_client() as c:
        await staff_sign_in(c, "boss@example.com")
        yield c


async def test_the_back_office_sees_the_queue_and_can_retry_a_task_that_gave_up(
    maker, boss, new_client
):  # type: ignore[no-untyped-def]
    now = datetime.now(UTC)
    tid = await add(maker, NewTask("t.x", resource="http", max_attempts=1), now)
    await add(maker, NewTask("t.y"), now - timedelta(minutes=10))
    (t,) = await take(maker, now=now, resources=("http",))
    await queue.fail(maker, t, "w1", now, error_class="Boom", message="broke", retry=True)
    r = await boss.get("/api/admin/worker")
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] == "api" and d["by_status"] == {"queued": 1, "dead": 1}
    assert d["oldest_due_seconds"] >= 600
    assert d["dead"][0]["id"] == str(tid) and d["dead"][0]["last_error"] == "broke"
    assert (await boss.post(f"/api/admin/worker/tasks/{tid}/retry")).json() == {"status": "queued"}
    assert (await row(maker, tid)).status == "queued"
    async with new_client() as stranger:
        assert (await stranger.get("/api/admin/worker")).status_code in (401, 403)


async def test_the_back_office_lists_every_job_board_and_downloads_them(maker, boss, new_client):  # type: ignore[no-untyped-def]
    from app.autoapply import registry
    from app.models import JobSource

    now = datetime.now(UTC)
    async with maker() as db:
        await registry.register(db, "greenhouse", "acme", origin="startup", now=now, company="Acme")
        await registry.register(db, "jobicy", "", origin="settings", now=now)
        await db.commit()
        src = (await db.execute(select(JobSource).where(JobSource.board == "acme"))).scalar_one()
        src.jobs_listed = 12
        await db.commit()
    items = (await boss.get("/api/admin/job-sources/list")).json()["items"]
    assert [(i["kind"], i["board"]) for i in items] == [("greenhouse", "acme"), ("jobicy", "")]
    assert (
        items[0]["url"] == "https://boards.greenhouse.io/acme" and items[0]["origin"] == "startup"
    )
    assert items[1]["url"] == "https://jobicy.com"
    r = await boss.get("/api/admin/job-sources/export.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("company,kind,board,url") and len(lines) == 3
    assert "Acme,greenhouse,acme,https://boards.greenhouse.io/acme,startup research" in lines[1]
    async with new_client() as stranger:
        assert (await stranger.get("/api/admin/job-sources/list")).status_code in (401, 403)
        assert (await stranger.get("/api/admin/job-sources/export.csv")).status_code in (401, 403)
