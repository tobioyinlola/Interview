import csv
import io
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.deps import get_notifier, require_admin
from app.errors import ApiError
from app.models import PracticeSession, Referral, ResearchJob, SessionCredit, Usage, User
from app.schemas.admin import (
    ActivityOut,
    EmailsOut,
    GrantIn,
    MarketingOut,
    OverviewOut,
    QualityOut,
    ReferralsOut,
    TemplateInfo,
    TemplatePreview,
    UserDetailOut,
    UserListOut,
)
from app.schemas.api import UsageDay, UsageSummary, UsageUser
from app.schemas.engagement import EngagementOut
from app.services import admin_engagement, admin_stats
from app.services import email_templates as emails
from app.services.events import record_from
from app.services.notify import Notifier

ADMIN_STATEMENT_TIMEOUT_MS = 20_000


async def get_admin_db(
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> AsyncIterator[AsyncSession]:
    """The back office counts across whole tables, which can take longer than a customer request is
    allowed to. Give its queries more time, for this request only."""
    await db.execute(text(f"SET LOCAL statement_timeout = {ADMIN_STATEMENT_TIMEOUT_MS}"))
    yield db


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _cost(settings: Settings, stt_seconds: int, tokens_in: int, tokens_out: int) -> float:
    return (
        stt_seconds * settings.price_stt_per_minute / 60
        + tokens_in * settings.price_llm_input_per_million / 1_000_000
        + tokens_out * settings.price_llm_output_per_million / 1_000_000
    )


@router.get("/usage")
async def usage(
    days: int = Query(default=30, ge=1, le=90),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> UsageSummary:
    """The owner's cost view: spend per day, the heaviest users, and the average cost of a session
    and of a research job. These are ESTIMATES from counted audio seconds and tokens times the
    PRICE_* settings; the provider's own billing is the source of truth."""
    since = datetime.now(UTC).date() - timedelta(days=days - 1)
    since_ts = datetime.combine(since, datetime.min.time(), UTC)

    per_day = (
        await db.execute(
            select(
                Usage.day,
                func.count(Usage.user_id),
                func.sum(Usage.stt_seconds),
                func.sum(Usage.llm_input_tokens),
                func.sum(Usage.llm_output_tokens),
                func.sum(Usage.research_jobs),
            )
            .where(Usage.day >= since)
            .group_by(Usage.day)
            .order_by(Usage.day.desc())
        )
    ).all()
    session_day = func.date(PracticeSession.started_at)
    sessions_per_day: dict[date, int] = {
        d: int(n)
        for d, n in (
            await db.execute(
                select(session_day, func.count())
                .where(PracticeSession.started_at >= since_ts)
                .group_by(session_day)
            )
        ).all()
    }
    job_day = func.date(ResearchJob.started_at)
    research_tokens_per_day: dict[date, int] = {
        d: int(n)
        for d, n in (
            await db.execute(
                select(job_day, func.coalesce(func.sum(ResearchJob.tokens), 0))
                .where(ResearchJob.started_at >= since_ts)
                .group_by(job_day)
            )
        ).all()
    }

    rows: list[UsageDay] = []
    total_cost = 0.0
    total_sessions = 0
    total_jobs = 0
    total_research_tokens = 0
    for day, users, stt, tin, tout, jobs in per_day:
        n_sessions = int(sessions_per_day.get(day, 0))
        r_tokens = int(research_tokens_per_day.get(day, 0))
        cost = _cost(settings, int(stt or 0), int(tin or 0), int(tout or 0))
        # research tokens are one combined figure, so they are priced as input tokens (approximate)
        cost += r_tokens * settings.price_llm_input_per_million / 1_000_000
        total_cost += cost
        total_sessions += n_sessions
        total_jobs += int(jobs or 0)
        total_research_tokens += r_tokens
        rows.append(
            UsageDay(
                day=day.isoformat(),
                sessions=n_sessions,
                active_users=int(users),
                stt_seconds=int(stt or 0),
                llm_input_tokens=int(tin or 0),
                llm_output_tokens=int(tout or 0),
                research_jobs=int(jobs or 0),
                research_tokens=r_tokens,
                estimated_cost_usd=round(cost, 4),
            )
        )

    per_user = (
        await db.execute(
            select(
                User.email,
                func.sum(Usage.stt_seconds),
                func.sum(Usage.llm_input_tokens),
                func.sum(Usage.llm_output_tokens),
                func.sum(Usage.research_jobs),
            )
            .join(User, User.id == Usage.user_id)
            .where(Usage.day >= since)
            .group_by(User.email)
        )
    ).all()
    top = sorted(
        (
            UsageUser(
                email=email,
                stt_seconds=int(stt or 0),
                tokens=int((tin or 0) + (tout or 0)),
                research_jobs=int(jobs or 0),
                estimated_cost_usd=round(
                    _cost(settings, int(stt or 0), int(tin or 0), int(tout or 0)), 4
                ),
            )
            for email, stt, tin, tout, jobs in per_user
        ),
        key=lambda u: u.estimated_cost_usd,
        reverse=True,
    )[:10]

    research_cost = total_research_tokens * settings.price_llm_input_per_million / 1_000_000
    session_cost = total_cost - research_cost
    return UsageSummary(
        days=rows,
        top_users=top,
        total_cost_usd=round(total_cost, 4),
        sessions=total_sessions,
        avg_cost_per_session_usd=round(session_cost / total_sessions, 4)
        if total_sessions
        else None,
        research_jobs=total_jobs,
        avg_cost_per_research_job_usd=(
            round(research_cost / total_jobs, 4) if total_jobs else None
        ),
        caps={
            "stt_seconds_daily": settings.cap_stt_seconds_daily,
            "tokens_daily": settings.cap_tokens_daily,
            "research_jobs_daily": settings.cap_research_jobs_daily,
        },
        prices={
            "stt_per_minute": settings.price_stt_per_minute,
            "llm_input_per_million": settings.price_llm_input_per_million,
            "llm_output_per_million": settings.price_llm_output_per_million,
        },
    )


# ------------------------------------------------------------------------------ the console


def _admin_emails(settings: Settings) -> set[str]:
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


@router.get("/overview")
async def overview(
    days: int = Query(default=30, ge=1, le=90),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> OverviewOut:
    """Product health at a glance: growth, activity, the funnel, and what is going wrong."""
    return await admin_stats.overview(db, days)


@router.get("/users")
async def users(
    q: str = Query(default="", max_length=100),
    sort: str = Query(default="newest", pattern="^(newest|oldest|active|sessions)$"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> UserListOut:
    return await admin_stats.list_users(
        db, q=q, sort=sort, limit=limit, offset=offset, admin_emails=_admin_emails(settings)
    )


@router.get("/users/{user_id}")
async def user_detail(
    user_id: uuid.UUID,
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> UserDetailOut:
    """One account: who they are, what they have done, and their activity. No CV text, transcripts
    or answers: an admin sees what is happening, not what anyone said."""
    out = await admin_stats.user_detail(db, user_id, _admin_emails(settings))
    if out is None:
        raise ApiError(404, "not_found", "Not found.")
    return out


@router.post("/users/{user_id}/credits", status_code=201)
async def grant_credits(
    user_id: uuid.UUID,
    body: GrantIn,
    admin: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> UserDetailOut:
    """Give someone free interviews, for support or goodwill. Logged against the admin, and the
    person is told by email unless `notify` is off."""
    target = await db.get(User, user_id)
    if target is None:
        raise ApiError(404, "not_found", "Not found.")
    for _i in range(body.count):
        db.add(SessionCredit(user_id=target.id, kind="grant"))
    await db.commit()
    await record_from(
        db,
        "admin.credit_granted",
        user_id=target.id,
        actor_id=admin.id,
        count=body.count,
        to=target.email,
        reason=body.reason,
    )
    if body.notify:
        await notifier.credit_granted(target.id, body.count, body.reason)
    out = await admin_stats.user_detail(db, user_id, set())
    assert out is not None
    return out


@router.get("/activity")
async def activity(
    kind: str | None = Query(default=None, max_length=40),
    category: str | None = Query(default=None, max_length=20),
    user_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    before: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> ActivityOut:
    """The log of everything happening on the platform, newest first."""
    cursor: tuple[datetime, uuid.UUID] | None = None
    if before:
        try:
            when, _sep, last = before.partition("|")
            cursor = (datetime.fromisoformat(when), uuid.UUID(last))
        except ValueError:
            raise ApiError(422, "bad_cursor", "That page marker is not valid.") from None
    return await admin_stats.activity(
        db, kind=kind, category=category, user_id=user_id, q=q, before=cursor, limit=limit
    )


@router.get("/activity/export.csv")
async def export_activity(
    kind: str | None = Query(default=None, max_length=40),
    category: str | None = Query(default=None, max_length=20),
    user_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    admin: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> Response:
    """The same log as a spreadsheet (up to 5,000 rows). Exporting is itself logged."""
    rows = await admin_stats.activity_rows_for_export(
        db, kind=kind, category=category, user_id=user_id, q=q
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["time", "kind", "what", "user", "detail"])
    for row in rows:
        # a cell that starts like a formula would run in a spreadsheet: quote it
        w.writerow([("'" + c if c[:1] in ("=", "+", "-", "@") else c) for c in row])
    await record_from(db, "admin.export", actor_id=admin.id, rows=len(rows), what="activity")
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": 'attachment; filename="activity.csv"'},
    )


@router.get("/referrals")
async def referrals(
    days: int = Query(default=30, ge=1, le=90),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> ReferralsOut:
    return await admin_stats.referrals(db, days, max(1, settings.referrals_per_free_session))


@router.post("/referrals/{referral_id}/approve")
async def approve_referral(
    referral_id: uuid.UUID,
    admin: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> ReferralsOut:
    """A held sign-up turned out to be a real, different person (say, a housemate): count it."""
    row = await db.get(Referral, referral_id)
    if row is None or row.status != "held":
        raise ApiError(404, "not_found", "Not found.")
    row.status = "counted"
    row.held_reason = None
    await db.commit()
    await record_from(
        db,
        "admin.referral_approved",
        user_id=row.referrer_id,
        actor_id=admin.id,
        friend_id=row.referred_id,
    )
    await notifier.friend_joined(row.referrer_id, row.referred_id)
    return await admin_stats.referrals(db, 30, max(1, settings.referrals_per_free_session))


@router.get("/marketing")
async def marketing(
    days: int = Query(default=30, ge=1, le=90),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> MarketingOut:
    """Where sign-ups come from and how far each channel gets, plus the signals for pricing."""
    return await admin_stats.marketing(db, days)


@router.get("/engagement")
async def engagement(
    days: int = Query(default=30, ge=1, le=90),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> EngagementOut:
    """How people use the app on every device: who is active, for how long, where, what they use
    and what breaks. From the app's own usage statistics; counts and times only."""
    return await admin_engagement.engagement(db, days)


@router.get("/quality")
async def quality(
    days: int = Query(default=30, ge=1, le=90),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> QualityOut:
    """How good and how fast the product is: ratings, speed, scores, and failures."""
    return await admin_stats.quality(db, days)


@router.get("/emails")
async def email_log(
    kind: str | None = Query(default=None, max_length=30),
    status: str | None = Query(default=None, pattern="^(sent|failed)$"),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> EmailsOut:
    """Which emails went out and whether the provider took them. Never the body of a message."""
    return await admin_stats.emails(db, kind=kind, status=status, q=q, limit=limit)


@router.get("/emails/templates")
async def email_templates(
    _: User = Depends(require_admin),  # noqa: B008
) -> list[TemplateInfo]:
    return [
        TemplateInfo(kind=k, title=title, when=when, audience=audience)
        for k, title, when, audience in emails.CATALOG
    ]


@router.get("/emails/templates/{kind}")
async def email_template_preview(
    kind: str,
    _: User = Depends(require_admin),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> TemplatePreview:
    """A template filled with obviously fake data, to look at before it goes to anyone."""
    brand = emails.Brand(web_origin=settings.web_origin, support_email=settings.support_email)
    try:
        m = emails.sample_message(kind, brand)
    except KeyError:
        raise ApiError(404, "not_found", "Not found.") from None
    return TemplatePreview(kind=m.kind, subject=m.subject, html=m.html, text=m.text)


# ------------------------------------------------------------------ the background worker


class WorkerKindOut(BaseModel):
    kind: str
    tasks: int
    run_seconds: float
    dead: int
    queued: int


class WorkerDeadOut(BaseModel):
    id: uuid.UUID
    kind: str
    attempts: int
    error_class: str | None
    last_error: str | None
    finished_at: datetime | None


class WorkerOut(BaseModel):
    mode: str  # where background work runs: "api" or "worker"
    by_status: dict[str, int]
    oldest_due_seconds: float
    kinds: list[WorkerKindOut]
    dead: list[WorkerDeadOut]


@router.get("/worker")
async def worker_stats(
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> WorkerOut:
    """The background queue: what is waiting, how long the oldest has waited, what gave up, and
    how much worker time each kind of task used in the last day (its share of the cost)."""
    from app.models import BgTask
    from app.workers import queue as bgq

    now = datetime.now(UTC)
    st = await bgq.stats(db, now)
    dead = (
        (
            await db.execute(
                select(BgTask)
                .where(BgTask.status == "dead")
                .order_by(BgTask.finished_at.desc().nulls_last())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return WorkerOut(
        mode=settings.background_mode,
        by_status=st["by_status"],
        oldest_due_seconds=st["oldest_due_seconds"],
        kinds=[WorkerKindOut(**k) for k in st["kinds"]],
        dead=[
            WorkerDeadOut(
                id=t.id,
                kind=t.kind,
                attempts=t.attempts,
                error_class=t.error_class,
                last_error=t.last_error,
                finished_at=t.finished_at,
            )  # fmt: skip
            for t in dead
        ],
    )


@router.post("/worker/tasks/{task_id}/retry")
async def worker_retry(
    task_id: uuid.UUID,
    admin: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> dict[str, str]:
    """Give a dead task a fresh set of attempts."""
    from app.workers import queue as bgq

    if not await bgq.retry_dead(db, task_id, datetime.now(UTC)):
        raise ApiError(404, "not_found", "No dead task with that id.")
    await db.commit()
    await record_from(db, "admin.worker_retry", actor_id=admin.id, task=str(task_id))
    return {"status": "queued"}


# ------------------------------------------------------------------ the job board registry


class JobSourceRow(BaseModel):
    kind: str
    board: str
    company: str | None
    origin: str = "settings"
    url: str | None = None
    enabled: bool = True
    health: str
    jobs_listed: int
    every_minutes: int
    last_synced_at: datetime | None
    last_error: str | None


class JobSourcesOut(BaseModel):
    mode: str  # per_candidate | central
    total: int
    by_kind: dict[str, int]
    by_health: dict[str, int]
    jobs_listed: int
    failing: list[JobSourceRow]


@router.get("/job-sources")
async def job_sources(
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> JobSourcesOut:
    """The boards jobs are read from, once for everyone: how many, how healthy, which fail."""
    from app.models import JobSource

    by_kind = dict(
        (await db.execute(select(JobSource.kind, func.count()).group_by(JobSource.kind))).all()
    )
    by_health = dict(
        (await db.execute(select(JobSource.health, func.count()).group_by(JobSource.health))).all()
    )
    listed = (
        await db.execute(select(func.coalesce(func.sum(JobSource.jobs_listed), 0)))
    ).scalar_one()
    failing = (
        (
            await db.execute(
                select(JobSource)
                .where(JobSource.health == "failing")
                .order_by(JobSource.failures.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return JobSourcesOut(
        mode=settings.autoapply_discovery_mode,
        total=sum(by_kind.values()),
        by_kind={k: int(v) for k, v in by_kind.items()},
        by_health={k: int(v) for k, v in by_health.items()},
        jobs_listed=int(listed),
        failing=[_source_row(s) for s in failing],
    )


def _source_row(s: Any) -> JobSourceRow:
    from app.autoapply.registry import board_url

    return JobSourceRow(
        kind=s.kind,
        board=s.board,
        company=s.company,
        origin=s.origin,
        url=board_url(s.kind, s.board),
        enabled=s.enabled,
        health=s.health,
        jobs_listed=s.jobs_listed,
        every_minutes=s.every_minutes,
        last_synced_at=s.last_synced_at,
        last_error=s.last_error,
    )


async def _all_sources(db: AsyncSession) -> list[JobSourceRow]:
    from app.models import JobSource

    rows = (
        (
            await db.execute(
                select(JobSource)
                .order_by(JobSource.jobs_listed.desc(), JobSource.company, JobSource.board)
                .limit(5000)
            )
        )
        .scalars()
        .all()
    )
    return [_source_row(s) for s in rows]


class JobSourceListOut(BaseModel):
    items: list[JobSourceRow]


@router.get("/job-sources/list")
async def job_source_list(
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> JobSourceListOut:
    """Every board and feed, the busiest first."""
    return JobSourceListOut(items=await _all_sources(db))


@router.get("/job-sources/export.csv")
async def export_job_sources(
    admin: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> Response:
    """The same list as a spreadsheet. Exporting is itself logged."""
    rows = await _all_sources(db)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["company", "kind", "board", "url", "found via", "health", "jobs listed",
                "last read", "read every (minutes)", "last error"])  # fmt: skip
    for r in rows:
        cells = [r.company or "", r.kind, r.board, r.url or "",
                 "startup research" if r.origin == "startup" else "settings", r.health,
                 str(r.jobs_listed), r.last_synced_at.isoformat() if r.last_synced_at else "",
                 str(r.every_minutes), r.last_error or ""]  # fmt: skip
        w.writerow([("'" + c if c[:1] in ("=", "+", "-", "@") else c) for c in cells])
    await record_from(db, "admin.export", actor_id=admin.id, rows=len(rows), what="job_sources")
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": 'attachment; filename="job-boards.csv"'},
    )
