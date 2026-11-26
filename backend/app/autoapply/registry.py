"""Discovering jobs once, for everyone.

Every place jobs come from is a row in aa_job_sources: a company's board on Greenhouse, Lever,
Ashby, SmartRecruiters, Recruitee, Workable or Personio, or a whole public feed. The worker reads
each one on its own schedule and stores what it finds in the shared postings table; each
candidate is then matched against stored jobs instead of every candidate asking every board.

- Boards come from the settings and from the startups the outreach side has researched (their
  careers page often lives on one of these systems). A board is registered once.
- A board whose listings have not changed is not rewritten (the listing is hashed) and is read
  less often, up to once a day; a busy one is read more often, down to hourly.
- A listing that has gone from its board is marked closed, so nobody applies to it.
- A board that keeps failing is read rarely and shown as failing in the back office."""

import hashlib
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.autoapply import postings
from app.autoapply.adapters import AdapterError, DiscoveryAdapter, RawPosting
from app.config import Settings
from app.models import JobAlias, JobPosting, JobSource, Startup

log = logging.getLogger("app.autoapply.registry")

COMPANY_KINDS = (
    "greenhouse", "lever", "ashby", "smartrecruiters", "recruitee", "workable", "personio",
)  # fmt: skip
FEED_KINDS = (
    "remotive", "arbeitnow", "remoteok", "jobicy", "himalayas", "themuse", "workingnomads",
    "weworkremotely",
)  # fmt: skip
SETTING_FOR = {
    "greenhouse": "autoapply_greenhouse_boards",
    "lever": "autoapply_lever_companies",
    "ashby": "autoapply_ashby_boards",
    "smartrecruiters": "autoapply_smartrecruiters_companies",
    "recruitee": "autoapply_recruitee_companies",
    "workable": "autoapply_workable_companies",
    "personio": "autoapply_personio_companies",
}
MIN_EVERY, MAX_EVERY, START_EVERY = 60, 1440, 360  # minutes


def adapter(kind: str, board: str) -> DiscoveryAdapter:
    """The existing reader for one board (or one whole feed)."""
    from app.autoapply import discovery
    from app.autoapply import sources as feeds
    from app.autoapply import sources_more as more

    if kind == "greenhouse":
        return discovery.GreenhouseDiscovery([board])
    if kind == "lever":
        return feeds.LeverSource([board])
    if kind == "ashby":
        return feeds.AshbySource([board])
    if kind in discovery.MORE_COMPANY:
        return getattr(more, discovery.MORE_COMPANY[kind][0])([board])  # type: ignore[no-any-return]
    if kind in discovery.MORE_BROAD:
        return getattr(more, discovery.MORE_BROAD[kind])()  # type: ignore[no-any-return]
    simple = {"remotive": feeds.RemotiveSource, "arbeitnow": feeds.ArbeitnowSource,
              "remoteok": feeds.RemoteOkSource}  # fmt: skip
    if kind in simple:
        return simple[kind]()  # type: ignore[no-any-return]
    raise ValueError(f"unknown job source {kind!r}")


async def register(
    db: AsyncSession,
    kind: str,
    board: str,
    *,
    origin: str,
    now: datetime,
    company: str | None = None,
    domain: str | None = None,
) -> bool:
    """Add a board unless it is already known. True when it is new. The caller commits."""
    board = board.strip().lower()[:120]
    if kind not in (*COMPANY_KINDS, *FEED_KINDS) or (kind in COMPANY_KINDS and not board):
        return False
    res = await db.execute(
        insert(JobSource)
        .values(
            id=uuid.uuid4(),
            kind=kind,
            board=board,
            company=company,
            domain=domain,
            origin=origin,
            enabled=True,
            every_minutes=START_EVERY,
            next_sync_at=now,
            jobs_listed=0,
            failures=0,
            health="new",
            created_at=now,
        )  # fmt: skip
        .on_conflict_do_nothing(index_elements=["kind", "board"])
        .returning(JobSource.id)
    )
    return res.scalar_one_or_none() is not None


async def seed(db: AsyncSession, settings: Settings, now: datetime) -> int:
    """Register the boards and feeds named in the settings, and every hosted board a researched
    startup's careers page points to. Returns how many were new."""
    from app.hunt import jobboards

    added = 0
    names = {n.strip() for n in settings.autoapply_discovery_sources.split(",") if n.strip()}
    for kind in FEED_KINDS:
        if kind in names:
            added += await register(db, kind, "", origin="settings", now=now)
    for kind, setting in SETTING_FOR.items():
        if kind not in names:
            continue
        for board in str(getattr(settings, setting, "")).split(","):
            if board.strip():
                added += await register(db, kind, board, origin="settings", now=now)
    rows = (
        await db.execute(
            select(Startup.name, Startup.domain, Startup.research).where(
                Startup.status == "researched"
            )
        )
    ).all()
    for name, domain, research in rows:
        r: dict[str, Any] = research or {}
        urls = [r.get("careers_url") or "", *(o.get("url", "") for o in r.get("openings", []))]
        for kind, slug in jobboards.identify([u for u in urls if u]):
            if kind in COMPANY_KINDS:
                added += await register(
                    db, kind, slug, origin="startup", now=now, company=name, domain=domain
                )
    return added


BOARD_URLS = {  # where a person can see a board's listings themselves
    "greenhouse": "https://boards.greenhouse.io/{}",
    "lever": "https://jobs.lever.co/{}",
    "ashby": "https://jobs.ashbyhq.com/{}",
    "smartrecruiters": "https://jobs.smartrecruiters.com/{}",
    "recruitee": "https://{}.recruitee.com",
    "workable": "https://apply.workable.com/{}",
    "personio": "https://{}.jobs.personio.com",
}
FEED_URLS = {
    "remotive": "https://remotive.com",
    "arbeitnow": "https://www.arbeitnow.com",
    "remoteok": "https://remoteok.com",
    "jobicy": "https://jobicy.com",
    "himalayas": "https://himalayas.app",
    "themuse": "https://www.themuse.com",
    "workingnomads": "https://www.workingnomads.com",
    "weworkremotely": "https://weworkremotely.com",
}


def board_url(kind: str, board: str) -> str | None:
    if board and kind in BOARD_URLS:
        return BOARD_URLS[kind].format(board)
    return FEED_URLS.get(kind)


def listing_hash(raws: list[RawPosting]) -> str:
    """A fingerprint of what a board lists, so an unchanged board is not rewritten."""
    parts = sorted(
        f"{r.source_url}|{r.title}|{r.region or ''}|{len(r.description or '')}" for r in raws
    )
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


async def sync(
    db: AsyncSession, source_id: uuid.UUID, now: datetime, reader: DiscoveryAdapter | None = None
) -> dict[str, Any]:
    """Read one board and bring the stored jobs in line with it. Commits."""
    src = await db.get(JobSource, source_id)
    if src is None or not src.enabled:
        return {"skipped": True}
    try:
        raws = await (reader or adapter(src.kind, src.board)).search({}, now)
    except AdapterError as exc:
        src.failures += 1
        src.health = "failing" if src.failures >= 3 else src.health
        src.last_error = exc.message[:300]
        src.next_sync_at = now + timedelta(minutes=min(MAX_EVERY, 30 * 2 ** min(src.failures, 6)))
        await db.commit()
        return {"failed": exc.message}
    digest = listing_hash(raws)
    urls = [r.source_url for r in raws]
    changed = digest != src.content_hash
    if changed:
        for raw in raws:
            posting, _, _ = await postings.upsert(db, raw, now)
            await db.execute(
                update(JobAlias)
                .where(JobAlias.source_url == raw.source_url)
                .values(job_source_id=src.id)
            )
        # whatever this board listed before and no longer lists has closed
        gone = select(JobAlias.posting_id).where(
            JobAlias.job_source_id == src.id, JobAlias.source_url.not_in(urls or [""])
        )
        closed = await db.execute(
            update(JobPosting)
            .where(JobPosting.id.in_(gone), JobPosting.expires_at.is_(None))
            .values(expires_at=now)
        )
        src.last_changed_at = now
        src.every_minutes = max(MIN_EVERY, src.every_minutes // 2)
    else:
        # nothing new: one statement keeps the listings marked as still open
        await db.execute(
            update(JobPosting)
            .where(
                JobPosting.id.in_(
                    select(JobAlias.posting_id).where(JobAlias.job_source_id == src.id)
                )
            )
            .values(last_seen_at=now)
        )
        closed = None
        src.every_minutes = min(MAX_EVERY, int(src.every_minutes * 1.5))
    src.content_hash = digest
    src.jobs_listed = len(raws)
    src.failures, src.health, src.last_error = 0, "ok", None
    src.last_synced_at = now
    src.next_sync_at = now + timedelta(minutes=src.every_minutes)
    await db.commit()
    return {
        "changed": changed,
        "listed": len(raws),
        "closed": int(closed.rowcount or 0) if closed is not None else 0,  # type: ignore[attr-defined]
    }


async def due(db: AsyncSession, now: datetime, limit: int = 200) -> list[uuid.UUID]:
    return list(
        (
            await db.execute(
                select(JobSource.id)
                .where(JobSource.enabled.is_(True), JobSource.next_sync_at <= now)
                .order_by(JobSource.next_sync_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
