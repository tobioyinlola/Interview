"""From a discovered posting to an application that is skipped, waiting for the candidate, or
frozen and queued. The same path serves the daily run, a pasted URL and a re-check after the
candidate changes their search or answers a question."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import metrics
from app.adapters.interfaces import LlmProvider
from app.autoapply import matching, package
from app.autoapply.adapters import FormAdapter
from app.models import (
    Application,
    ApplicationEvent,
    Campaign,
    CandidateAnswer,
    CandidateFacts,
    JobPosting,
    Note,
    SearchProfile,
)

USER_SKIPPED = "You skipped this role."
OPEN_STATES = ("discovered", "eligible", "needs_input", "queued")


@dataclass
class Context:
    """What is needed to judge and prepare applications for one candidate."""

    user_id: uuid.UUID
    campaign: Campaign
    profile: SearchProfile
    facts: CandidateFacts | None
    cv_text: str
    saved: dict[str, CandidateAnswer]
    llm: LlmProvider
    form: FormAdapter
    now: datetime


async def load_context(
    db: AsyncSession,
    user_id: uuid.UUID,
    campaign: Campaign,
    profile: SearchProfile,
    *,
    llm: LlmProvider,
    form: FormAdapter,
    now: datetime,
) -> Context:
    facts = (
        await db.execute(select(CandidateFacts).where(CandidateFacts.user_id == user_id))
    ).scalar_one_or_none()
    cv = (
        await db.execute(select(Note.content).where(Note.user_id == user_id))
    ).scalar_one_or_none()
    answers = (
        (await db.execute(select(CandidateAnswer).where(CandidateAnswer.user_id == user_id)))
        .scalars()
        .all()
    )
    return Context(
        user_id, campaign, profile, facts, cv or "", {a.field: a for a in answers}, llm, form, now
    )


async def log(db: AsyncSession, app: Application, kind: str, **detail: Any) -> None:
    db.add(ApplicationEvent(application_id=app.id, kind=kind, detail=detail))


def routes_for(posting: JobPosting, form: FormAdapter) -> set[str]:
    """How this listing can be applied to. Email counts only when the listing itself gave the
    address as an application route, and we kept the evidence of where it said so."""
    routes: set[str] = set()
    if posting.application_url and form.supports(posting.application_url):
        routes.add("form")
    if posting.apply_email and posting.evidence.get("apply_email"):
        routes.add("email")
    return routes


async def get_or_create(
    db: AsyncSession, user_id: uuid.UUID, posting: JobPosting, campaign_id: uuid.UUID, now: datetime
) -> tuple[Application, bool]:
    res = await db.execute(
        pg_insert(Application)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            posting_id=posting.id,
            campaign_id=campaign_id,
            status="discovered",
            match={},
            score=0.0,
            needs_input=[],
            answers={},
            profile_version=0,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "posting_id"])
        .returning(Application.id)
    )
    created = res.scalar_one_or_none() is not None
    if not created:
        metrics.autoapply_duplicates.inc()  # the same job seen again did not become a second one
    app = (
        await db.execute(
            select(Application).where(
                Application.user_id == user_id, Application.posting_id == posting.id
            )
        )
    ).scalar_one()
    return app, created


def overrides(app: Application) -> set[str]:
    return {k[len("approve:") :] for k in (app.answers or {}) if k.startswith("approve:")}


async def process(
    db: AsyncSession,
    ctx: Context,
    posting: JobPosting,
    *,
    possible_duplicate: uuid.UUID | None = None,
) -> tuple[Application, str]:
    """Judge one posting for one candidate and move its application as far as it can go on its
    own. Returns the application and a short outcome: new, eligible, needs_input, skipped, kept."""
    app, created = await get_or_create(db, ctx.user_id, posting, ctx.campaign.id, ctx.now)
    if created:
        await log(db, app, "discovered", source=posting.source)
    if app.status in package.FROZEN or app.status in ("failed",) or app.skip_reason == USER_SKIPPED:
        return app, "kept"  # already out the door, or the candidate decided
    approved = overrides(app)
    routes = routes_for(posting, ctx.form)
    result = matching.evaluate(
        ctx.profile.criteria or {},
        posting,
        now=ctx.now,
        routes=routes,
        channels=ctx.profile.channels or {},
        overrides=approved,
    )
    app.match = result.as_dict()
    app.score = result.score
    app.profile_version = ctx.profile.version
    app.campaign_id = ctx.campaign.id
    if possible_duplicate is not None and "duplicate" not in approved and result.decision != "skip":
        app.status = "needs_input"
        app.needs_input = [
            {
                "kind": "duplicate",
                "field": "duplicate",
                "question": "Is this the same job as one you already have?",
                "reason": "Another listing has the same company, title and place.",
            }
        ]
        await log(db, app, "needs_input", reason="possible duplicate")
        return app, "needs_input"
    if result.decision == "skip":
        app.status, app.skip_reason, app.needs_input = "skipped", result.reason[:300], []
        await log(db, app, "skipped", reason=result.reason)
        return app, "skipped"
    if result.decision == "review":
        app.status = "needs_input"
        app.needs_input = [
            {
                "kind": "rule",
                "field": r.key,
                "question": r.label,
                "reason": r.evidence[0].upper() + r.evidence[1:] + ".",
            }
            for r in result.rules
            if r.required and r.status == matching.UNKNOWN
        ]
        await log(db, app, "needs_input", rules=[n["field"] for n in app.needs_input])
        return app, "needs_input"
    channel = next(
        c for c in ("form", "email") if c in routes and (ctx.profile.channels or {}).get(c)
    )
    built, missing = await package.build(
        app=app,
        posting=posting,
        facts_row=ctx.facts,
        cv_text=ctx.cv_text,
        saved=ctx.saved,
        llm=ctx.llm,
        channel=channel,
        match=app.match,
        profile_version=ctx.profile.version,
        now=ctx.now,
    )
    app.channel = channel
    if built is None:
        app.status, app.needs_input = "needs_input", missing
        await log(db, app, "needs_input", missing=[m["field"] or m["kind"] for m in missing])
        return app, "needs_input"
    package.freeze(app, built, ctx.now)
    app.status, app.needs_input, app.skip_reason = "queued", [], None
    await log(db, app, "queued", channel=channel)
    return app, "eligible"


async def reevaluate_open(db: AsyncSession, ctx: Context) -> int:
    """Run every open application again, after the candidate changed their search or answered
    something. Applications already sent, failed, or skipped by the candidate are left alone."""
    rows = (
        (
            await db.execute(
                select(JobPosting)
                .join(Application, JobPosting.id == Application.posting_id)
                .where(Application.user_id == ctx.user_id, Application.status.in_(OPEN_STATES))
            )
        )
        .scalars()
        .all()
    )
    for posting in rows:
        await process(db, ctx, posting)
    await db.commit()
    return len(rows)
