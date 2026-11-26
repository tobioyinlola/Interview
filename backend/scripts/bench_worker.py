"""Measure the unified worker on this machine, with no real sending and no model calls.

    DATABASE_URL=... python scripts/bench_worker.py --candidates 200 --jobs 2000

It fills a scratch database (migrated to head) with candidates who have confirmed facts and an
active campaign, and jobs already stored centrally; fires the Auto-Apply schedule; and lets the
dispatcher run every task to the end through the fixture form filler and fixture mailbox. Prints
what it measured: tasks per second, per-kind run time, peak memory, database connections.

The model is a stand-in that answers instantly, so the numbers are the worker's own cost: real
model latency (and its price) comes on top and is limited by WORKER_MAX_AI_REQUESTS."""

import argparse
import asyncio
import json
import resource
import time
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text

import app.workers.handlers  # noqa: F401 - registers the task kinds
from app.adapters.fakes import FakeLlmProvider
from app.autoapply import postings
from app.autoapply.adapters import RawPosting
from app.autoapply.fixtures import FIXTURE_HOST, FixtureForm, FixtureMailbox
from app.config import Settings
from app.db import dispose_engine, get_sessionmaker
from app.models import BgTask, Campaign, CandidateFacts, Note, SearchProfile, User
from app.workers import schedule
from app.workers.context import WorkerContext
from app.workers.dispatcher import Dispatcher

FACTS = {
    "contact": {"name": "Bench Person", "email": "", "phone": "", "location": "Lagos, Nigeria"},
    "links": [],
    "skills": ["Product strategy", "Payments", "SQL"],
    "history": [
        {
            "title": "Senior Product Manager",
            "company": "Northwind",
            "start": "2019",
            "end": "2025",
            "summary": "Led payments.",
        },
    ],  # fmt: skip
    "education": [],
}
CRITERIA = {
    "roles": [{"value": "Product Manager", "required": True}],
    "locations": [{"value": "Nigeria", "required": True}],
}
TITLES = ["Senior Product Manager", "Product Manager", "Data Engineer", "Head of Sales"]


async def seed(maker, n: int, jobs: int, now: datetime) -> None:  # type: ignore[no-untyped-def]
    async with maker() as db:
        await db.execute(text("TRUNCATE bg_tasks, bg_schedules RESTART IDENTITY"))
        for i in range(n):
            uid = uuid.uuid4()
            db.add(User(id=uid, email=f"bench{i}-{uid.hex[:6]}@example.com", onboarded_at=now))
            await db.flush()
            db.add(Note(user_id=uid, content="Bench CV. Led payments.", role="PM"))
            db.add(CandidateFacts(user_id=uid, data={**FACTS, "contact": {**FACTS["contact"],
                   "email": f"bench{i}@example.com"}}, verified_at=now))  # fmt: skip
            prof = SearchProfile(
                user_id=uid, criteria=CRITERIA, timezone="Africa/Lagos",
                channels={"form": True, "email": False, "outreach": False},
                daily_application_cap=10, policy_version="2026-11", authorized_at=now,
            )  # fmt: skip
            db.add(prof)
            await db.flush()
            db.add(Campaign(user_id=uid, profile_id=prof.id, timezone="Africa/Lagos",
                   activated_at=now, ends_at=now + timedelta(days=30),
                   daily_application_cap=10, daily_outreach_cap=3,
                   policy_version="2026-11"))  # fmt: skip
        for j in range(jobs):
            await postings.upsert(
                db,
                RawPosting(
                    source="greenhouse",
                    source_url=f"https://boards.greenhouse.io/bench/jobs/{j}-{now.timestamp()}",
                    company=f"Company {j % 300}",
                    title=TITLES[j % len(TITLES)],
                    description="Payments product. SQL. Remote within Nigeria.",
                    requisition_id=f"B-{j}-{int(now.timestamp())}",
                    region="Nigeria",
                    arrangement="remote",
                    application_url=f"https://{FIXTURE_HOST}/bench/{j}",
                ),
                now,
            )
        await db.commit()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=int, default=100)
    ap.add_argument("--jobs", type=int, default=1000)
    ap.add_argument("--concurrency", type=int, default=5)
    a = ap.parse_args()
    settings = Settings(  # type: ignore[call-arg]
        autoapply_enabled=True, autoapply_discovery_mode="central", background_mode="worker",
        worker_max_concurrent_tasks=a.concurrency, worker_max_http_tasks=a.concurrency,
        worker_max_email_tasks=a.concurrency,
    )  # fmt: skip
    maker = get_sessionmaker()
    now = datetime.now(UTC)
    t0 = time.perf_counter()
    await seed(maker, a.candidates, a.jobs, now)
    seeded = time.perf_counter() - t0
    ctx = WorkerContext(maker=maker, settings=settings, sources=[], form=FixtureForm(),
                        mailbox=FixtureMailbox(), llm=FakeLlmProvider())  # fmt: skip
    t1 = time.perf_counter()
    queued = await schedule.fire(ctx, "autoapply", now)
    d = Dispatcher(ctx)
    peak_conn = 0
    while True:
        await d.fill()
        async with maker() as db:
            peak_conn = max(peak_conn, (await db.execute(text(
                "select count(*) from pg_stat_activity where datname = current_database()"
            ))).scalar_one())  # fmt: skip
            left = (await db.execute(select(func.count()).select_from(BgTask).where(
                BgTask.status.in_(("queued", "running"))))).scalar_one()  # fmt: skip
        if not left and not d.running:
            break
        await asyncio.sleep(0.05)
    ran = time.perf_counter() - t1
    async with maker() as db:
        cols = (BgTask.kind, BgTask.status, func.count(), func.avg(BgTask.run_seconds))
        kinds = (await db.execute(select(*cols).group_by(BgTask.kind, BgTask.status))).all()
        apps = (
            await db.execute(text("select status, count(*) from aa_applications group by 1"))
        ).all()
    done = sum(n for _, s, n, _ in kinds if s == "done")
    print(json.dumps({
        "candidates": a.candidates, "jobs": a.jobs, "concurrency": a.concurrency,
        "seed_seconds": round(seeded, 1), "tasks_queued": queued, "tasks_done": done,
        "run_seconds": round(ran, 2), "tasks_per_second": round(done / ran, 2) if ran else None,
        "candidates_per_minute": round(a.candidates / ran * 60, 1) if ran else None,
        "by_kind": {f"{k}:{s}": {"n": n, "avg_s": round(avg or 0, 3)} for k, s, n, avg in kinds},
        "applications": {s: n for s, n in apps},
        "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "peak_db_connections": peak_conn,
    }, indent=2))  # fmt: skip
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
