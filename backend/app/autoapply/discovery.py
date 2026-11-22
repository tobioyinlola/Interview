"""Finding jobs: one run per candidate per local day, through every configured source."""

import json
import logging
import re
import uuid
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import metrics
from app.autoapply import campaign, clock, matching, pipeline, postings
from app.autoapply.adapters import AdapterError, DiscoveryAdapter, RawPosting
from app.autoapply.fixtures import FixtureDiscovery
from app.config import Settings
from app.models import Application, DiscoveryRun
from app.services.events import record_from

log = logging.getLogger("app.autoapply.discovery")


class GreenhouseDiscovery:
    """Public job boards hosted by Greenhouse (boards-api.greenhouse.io). Each employer's board is
    listed by its token in AUTOAPPLY_GREENHOUSE_BOARDS. Reading is public and needs no key."""

    name = "greenhouse"
    broad = True  # a whole company board: keep only roles that could fit

    def __init__(
        self, boards: list[str], transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.boards = boards
        self._transport = transport

    async def _get(self, url: str) -> Any:
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=15) as c:
                r = await c.get(url, headers={"accept": "application/json"})
        except httpx.HTTPError:
            raise AdapterError(
                "network", "The job board could not be reached.", transient=True
            ) from None
        if r.status_code == 404:
            return None
        if r.status_code >= 500 or r.status_code == 429:
            raise AdapterError("unavailable", "The job board is busy.", transient=True)
        if r.status_code != 200:
            raise AdapterError("rejected", f"The job board answered {r.status_code}.")
        return r.json()

    @staticmethod
    def parse(board: str, job: dict[str, Any]) -> RawPosting:
        html = unescape(job.get("content") or "")
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()
        url = job.get("absolute_url") or ""
        location = (job.get("location") or {}).get("name") or ""
        updated = job.get("updated_at")
        return RawPosting(
            source="greenhouse",
            source_url=url or f"https://boards.greenhouse.io/{board}/jobs/{job.get('id')}",
            company=job.get("company_name") or board.replace("-", " ").title(),
            title=job.get("title") or "",
            description=text,
            requisition_id=str(job.get("requisition_id") or job.get("internal_job_id") or "")
            or None,
            region=location or None,
            arrangement="remote" if "remote" in location.lower() else None,
            posted_at=datetime.fromisoformat(updated.replace("Z", "+00:00")) if updated else None,
            application_url=url or None,
            evidence={"title": "the job board", "region": "the job board's location field"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        found: list[RawPosting] = []
        for board in self.boards:
            data = await self._get(
                f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"
            )
            for job in (data or {}).get("jobs", []):
                found.append(self.parse(board, job))
        return found

    async def fetch(self, url: str) -> RawPosting | None:
        m = re.search(r"greenhouse\.io/(?:embed/job_app\?for=)?([\w-]+)/jobs/(\d+)", url)
        if not m:
            return None
        data = await self._get(f"https://boards-api.greenhouse.io/v1/boards/{m[1]}/jobs/{m[2]}")
        return self.parse(m[1], data) if data else None


def _fixture_jobs(settings: Settings) -> list[RawPosting]:
    """Listings for the fixture source, read from AUTOAPPLY_FIXTURE_JOBS_FILE (a JSON list). Local
    and staging only: it lets a whole journey be tried with no real job board."""
    path = settings.autoapply_fixture_jobs_file
    if settings.environment == "production":
        return []
    if not path:
        if not settings.autoapply_sample_jobs:
            return []
        path = str(Path(__file__).with_name("sample_jobs.json"))
    out: list[RawPosting] = []
    for item in json.loads(open(path).read()):  # noqa: SIM115, PTH123
        for k in ("posted_at", "expires_at"):
            if item.get(k):
                item[k] = datetime.fromisoformat(item[k])
        out.append(RawPosting(**item))
    return out


def _names(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def build_sources(settings: Settings) -> list[DiscoveryAdapter]:
    """The discovery sources named in AUTOAPPLY_DISCOVERY_SOURCES, in that order. Several can run
    together: the same job found twice becomes one posting. Outside production only the fixture
    ever returns anything it was handed, so a staging run cannot apply for a real job."""
    from app.autoapply import sources as feeds

    out: list[DiscoveryAdapter] = []
    for name in _names(settings.autoapply_discovery_sources):
        if name == "fixture":
            out.append(FixtureDiscovery(_fixture_jobs(settings)))
        elif name == "greenhouse":
            out.append(GreenhouseDiscovery(_names(settings.autoapply_greenhouse_boards)))
        elif name == "lever":
            out.append(feeds.LeverSource(_names(settings.autoapply_lever_companies)))
        elif name == "ashby":
            out.append(feeds.AshbySource(_names(settings.autoapply_ashby_boards)))
        elif name == "remotive":
            out.append(feeds.RemotiveSource())
        elif name == "arbeitnow":
            out.append(feeds.ArbeitnowSource())
        elif name == "remoteok":
            out.append(feeds.RemoteOkSource())
        else:
            log.warning("unknown discovery source", extra={"fields": {"source": name}})
    return out


KNOWN_SOURCES = ("fixture", "greenhouse", "lever", "ashby", "remotive", "arbeitnow", "remoteok")


async def _claim(
    db: AsyncSession, user_id: uuid.UUID, camp_id: uuid.UUID, day: Any, now: datetime
) -> uuid.UUID | None:
    """Take today's run for this candidate, or None when another worker already has it or it is
    done. A run that failed earlier today may be taken again."""
    res = await db.execute(
        pg_insert(DiscoveryRun)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            campaign_id=camp_id,
            local_day=day,
            status="running",
            found=0,
            new=0,
            eligible=0,
            needs_input=0,
            skipped=0,
            started_at=now,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "local_day"])
        .returning(DiscoveryRun.id)
    )
    run_id = res.scalar_one_or_none()
    if run_id is None:
        retry = await db.execute(
            update(DiscoveryRun)
            .where(
                DiscoveryRun.user_id == user_id,
                DiscoveryRun.local_day == day,
                DiscoveryRun.status == "failed",
            )
            .values(status="running", error=None, started_at=now)
            .returning(DiscoveryRun.id)
        )
        run_id = retry.scalar_one_or_none()
    await db.commit()
    return run_id


async def run_if_due(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    now: datetime,
    sources: list[DiscoveryAdapter],
    llm: Any,
    form: Any,
) -> DiscoveryRun | None:
    """Run today's discovery for one candidate unless it already ran, the search is paused, or the
    campaign is over. At most one run per candidate per local day, however many schedulers ask."""
    camp = await campaign.current(db, user_id)
    prof = await campaign.get_profile(db, user_id)
    if not campaign.outbound_open(camp, prof, now):
        return None
    assert camp is not None and prof is not None
    day = clock.local_day(now, camp.timezone)
    run_id = await _claim(db, user_id, camp.id, day, now)
    if run_id is None:
        return None
    run = await db.get(DiscoveryRun, run_id)
    assert run is not None
    ctx = await pipeline.load_context(db, user_id, camp, prof, llm=llm, form=form, now=now)
    raws: list[RawPosting] = []
    errors: list[str] = []
    for src in sources:
        try:
            found_here = await src.search(prof.criteria or {}, now)
        except AdapterError as exc:
            errors.append(f"{src.name}: {exc.message}")
            continue
        if getattr(src, "broad", False):
            # a big public feed: keep only jobs whose title could be a role the candidate wants,
            # so their list is not buried under thousands of unrelated listings
            found_here = [
                r for r in found_here if matching.role_could_fit(prof.criteria or {}, r.title)
            ]
        raws.extend(found_here)
    if errors and not raws and len(errors) == len(sources):
        run.status, run.error, run.finished_at = "failed", "; ".join(errors)[:500], now
        await db.commit()
        metrics.autoapply_discovery.labels("failed").inc()
        await record_from(db, "autoapply.discovery_failed", user_id=user_id, errors=len(errors))
        return run
    seen: set[uuid.UUID] = set()
    for raw in raws:
        run.found += 1
        posting, created, dup = await postings.upsert(db, raw, now)
        if posting.id in seen:
            continue  # the same job from two sources in one run counts once
        seen.add(posting.id)
        existed = (
            await db.execute(
                select(Application.id).where(
                    Application.user_id == user_id, Application.posting_id == posting.id
                )
            )
        ).first()
        app, outcome = await pipeline.process(db, ctx, posting, possible_duplicate=dup)
        if existed is None:
            run.new += 1
        run.eligible += outcome == "eligible"
        run.needs_input += outcome == "needs_input"
        run.skipped += outcome == "skipped"
    run.status, run.finished_at = "done", now
    run.error = "; ".join(errors)[:500] if errors else None
    await db.commit()
    metrics.autoapply_discovery.labels("done").inc()
    await record_from(
        db,
        "autoapply.discovery_done",
        user_id=user_id,
        found=run.found,
        new=run.new,
        eligible=run.eligible,
    )
    return run


async def intake_url(
    db: AsyncSession,
    user_id: uuid.UUID,
    url: str,
    *,
    now: datetime,
    sources: list[DiscoveryAdapter],
    llm: Any,
    form: Any,
) -> tuple[Application, str] | None:
    """A job address pasted by the candidate goes through exactly the same checks as a discovered
    one. None when no source can read the address."""
    camp = await campaign.current(db, user_id)
    prof = await campaign.get_profile(db, user_id)
    if camp is None or prof is None or camp.status != "active":
        raise campaign.CampaignError("not_active", "Start Auto-Apply before adding a job.")
    raw: RawPosting | None = None
    for src in sources:
        try:
            raw = await src.fetch(url)
        except AdapterError:
            raw = None
        if raw is not None:
            break
    if raw is None:
        return None
    posting, _created, dup = await postings.upsert(db, raw, now)
    ctx = await pipeline.load_context(db, user_id, camp, prof, llm=llm, form=form, now=now)
    result = await pipeline.process(db, ctx, posting, possible_duplicate=dup)
    await db.commit()
    return result
