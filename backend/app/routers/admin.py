from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.deps import require_admin
from app.models import PracticeSession, ResearchJob, Usage, User
from app.schemas.api import UsageDay, UsageSummary, UsageUser

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
    db: AsyncSession = Depends(get_db),  # noqa: B008
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
