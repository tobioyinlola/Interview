"""The back office's view of Auto-Apply: counts and ages, never a CV, an answer or an email."""

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import (
    Application,
    Campaign,
    DiscoveryRun,
    InterviewLink,
    JobPosting,
    KillSwitch,
    MailboxConnection,
    RecruitingEvent,
    SearchProfile,
    SubmissionAttempt,
    User,
)
from app.schemas.admin_autoapply import AutoApplyAdminOut, ExecutorRow, SwitchOut, UnresolvedRow

SENT = ("submitted", "sent_email", "confirmation_pending")


async def overview(
    db: AsyncSession, settings: Settings, now: datetime, days: int
) -> AutoApplyAdminOut:
    since = now - timedelta(days=days)

    async def count(stmt) -> int:  # type: ignore[no-untyped-def]
        return int((await db.execute(stmt)).scalar_one())

    paused = await count(
        select(func.count())
        .select_from(Campaign)
        .join(SearchProfile, SearchProfile.id == Campaign.profile_id)
        .where(Campaign.status == "active", SearchProfile.paused.is_(True))
    )
    active = await count(
        select(func.count()).select_from(Campaign).where(Campaign.status == "active")
    )
    by_status = dict(
        (
            await db.execute(
                select(Application.status, func.count())
                .where(Application.created_at >= since)
                .group_by(Application.status)
            )
        ).all()
    )
    # Of the applications sent 30 to 60 days ago (so employers have had a month to answer), how
    # many led to an interview invitation? Per 100.
    lo, hi = now - timedelta(days=60), now - timedelta(days=30)
    cohort_ids = (
        select(SubmissionAttempt.application_id)
        .where(
            SubmissionAttempt.state == "confirmed",
            SubmissionAttempt.channel != "outreach",
            SubmissionAttempt.finished_at >= lo,
            SubmissionAttempt.finished_at < hi,
        )
        .distinct()
    )
    cohort = await count(select(func.count()).select_from(cohort_ids.subquery()))
    invited = await count(
        select(func.count(func.distinct(InterviewLink.application_id))).where(
            InterviewLink.application_id.in_(cohort_ids)
        )
    )
    first = (
        (
            await db.execute(
                select(
                    func.extract(
                        "epoch", func.min(SubmissionAttempt.finished_at) - Campaign.activated_at
                    )
                    / 3600
                )
                .select_from(Campaign)
                .join(SubmissionAttempt, SubmissionAttempt.user_id == Campaign.user_id)
                .where(
                    SubmissionAttempt.state == "confirmed",
                    SubmissionAttempt.channel != "outreach",
                    SubmissionAttempt.finished_at >= Campaign.activated_at,
                    Campaign.activated_at >= since,
                )
                .group_by(Campaign.id, Campaign.activated_at)
            )
        )
        .scalars()
        .all()
    )
    unresolved_rows = (
        await db.execute(
            select(SubmissionAttempt, Application, JobPosting, User)
            .join(Application, Application.id == SubmissionAttempt.application_id)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .join(User, User.id == SubmissionAttempt.user_id)
            .where(SubmissionAttempt.state.in_(("claimed", "dispatched", "ambiguous")))
            .order_by(SubmissionAttempt.claimed_at)
            .limit(20)
        )
    ).all()
    box = dict(
        (
            await db.execute(
                select(MailboxConnection.status, func.count()).group_by(MailboxConnection.status)
            )
        ).all()
    )
    runs = dict(
        (
            await db.execute(
                select(DiscoveryRun.status, func.count())
                .where(DiscoveryRun.started_at >= now - timedelta(hours=24))
                .group_by(DiscoveryRun.status)
            )
        ).all()
    )
    switches = (await db.execute(select(KillSwitch).order_by(KillSwitch.name))).scalars().all()
    week = (
        await db.execute(
            select(
                SubmissionAttempt.executor,
                SubmissionAttempt.channel,
                func.count(),
                func.count().filter(SubmissionAttempt.state == "confirmed"),
                func.count().filter(SubmissionAttempt.state == "ambiguous"),
                func.count().filter(SubmissionAttempt.state == "failed"),
                func.avg(SubmissionAttempt.duration_ms),
                func.coalesce(func.sum(SubmissionAttempt.duration_ms), 0),
            )
            .where(
                SubmissionAttempt.claimed_at >= now - timedelta(days=7),
                SubmissionAttempt.channel.in_(("form", "email")),
            )
            .group_by(SubmissionAttempt.executor, SubmissionAttempt.channel)
            .order_by(SubmissionAttempt.executor, SubmissionAttempt.channel)
        )
    ).all()
    return AutoApplyAdminOut(
        executors=[
            ExecutorRow(
                executor=ex,
                channel=ch,
                attempts=int(n),
                confirmed=int(ok),
                ambiguous=int(amb),
                failed=int(bad),
                avg_seconds=round(float(avg) / 1000, 1) if avg is not None else None,
                total_minutes=round(float(total) / 60000, 1),
            )
            for ex, ch, n, ok, amb, bad, avg, total in week
        ],
        enabled=settings.autoapply_enabled,
        dispatch={
            "form": settings.autoapply_form_dispatch,
            "email": settings.autoapply_email_dispatch,
            "outreach": settings.autoapply_outreach_dispatch,
        },
        provider=settings.autoapply_mailbox_provider,
        campaigns_active=active - paused,
        campaigns_paused=paused,
        campaigns_started=await count(
            select(func.count()).select_from(Campaign).where(Campaign.activated_at >= since)
        ),
        campaigns_ended=await count(
            select(func.count())
            .select_from(Campaign)
            .where(Campaign.status == "ended", Campaign.ended_at >= since)
        ),
        applications_by_status={k: int(v) for k, v in by_status.items()},
        applications_sent=sum(int(by_status.get(s, 0)) for s in SENT),
        interviews=await count(
            select(func.count()).select_from(InterviewLink).where(InterviewLink.created_at >= since)
        ),
        invitations_per_100=round(100 * invited / cohort, 1) if cohort else None,
        cohort_size=cohort,
        hours_to_first_application=round(float(sum(first)) / len(first), 1) if first else None,
        attempts_unresolved=await count(
            select(func.count())
            .select_from(SubmissionAttempt)
            .where(SubmissionAttempt.state.in_(("claimed", "dispatched", "ambiguous")))
        ),
        attempts_failed=await count(
            select(func.count())
            .select_from(SubmissionAttempt)
            .where(SubmissionAttempt.state == "failed", SubmissionAttempt.claimed_at >= since)
        ),
        unresolved=[
            UnresolvedRow(
                application_id=str(a.id),
                person=u.email,
                company=p.company,
                title=p.title,
                channel=t.channel,
                state=t.state,
                age_hours=round((now - t.claimed_at).total_seconds() / 3600, 1),
            )
            for t, a, p, u in unresolved_rows
        ],
        mailboxes={k: int(v) for k, v in box.items()},
        discovery_runs={k: int(v) for k, v in runs.items()},
        events_needing_review=await count(
            select(func.count())
            .select_from(RecruitingEvent)
            .where(RecruitingEvent.status == "needs_review")
        ),
        switches=[
            SwitchOut(name=s.name, on=s.on, reason=s.reason, set_at=s.set_at) for s in switches
        ],
    )
