"""Auto-Apply: the candidate's search, authorisation and 30-day campaign. Everything here belongs to
the signed-in person; the flag `AUTOAPPLY_ENABLED` turns the whole feature off (404)."""

import re
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.interfaces import LlmProvider
from app.autoapply import campaign as camp
from app.autoapply import (
    clock,
    dashboard,
    discovery,
    facts,
    interviews,
    outbox,
    outreach,
    pipeline,
    recruiting,
    rules,
)
from app.autoapply import mailbox as mbx
from app.autoapply.adapters import AdapterError, DiscoveryAdapter, FormAdapter, MailboxAdapter
from app.autoapply.fixtures import FixtureForm, FixtureMailbox
from app.autoapply.gmail import STATE_COOKIE, GmailAdapter, GmailOAuth
from app.autoapply.schemas import (
    AnswerApplicationIn,
    AnswerIn,
    AnswerOut,
    ApplicationDetail,
    ApplicationEventOut,
    ApplicationOut,
    ApplicationPage,
    ApproveIn,
    AttemptOut,
    CampaignOut,
    CandidateApp,
    ConfirmTimeIn,
    ConnectOut,
    DashboardOut,
    Disclosure,
    EnableIn,
    FactsIn,
    FactsOut,
    InterviewOut,
    JobUrlIn,
    LinkEventIn,
    MailboxOut,
    OutreachIn,
    OutreachOut,
    PostingOut,
    PrepareOut,
    PrimaryAction,
    SearchProfileIn,
    ProfileOut,
    RecruitingOut,
    ResolveIn,
    RunOut,
    StatusOut,
    UsageOut,
)
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, get_runner
from app.errors import ApiError
from app.models import (
    Application,
    ApplicationEvent,
    CandidateAnswer,
    DiscoveryRun,
    InterviewLink,
    JobPosting,
    Note,
    Outreach,
    RecruitingEvent,
    SearchProfile,
    SubmissionAttempt,
    User,
)
from app.repositories import CompaniesRepo, UsageRepo
from app.schemas.api import StatusOut as Ok
from app.services.providers import build_answer_llm
from app.workers.research_worker import ResearchRunner


def get_now() -> datetime:
    """The current time. Tests replace this to move through a whole campaign."""
    return clock.utcnow()


def get_llm(settings: Settings = Depends(get_settings)) -> LlmProvider:  # noqa: B008
    return build_answer_llm(settings)


def get_sources(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> list[DiscoveryAdapter]:
    """The discovery sources, built once per process."""
    sources = getattr(request.app.state, "autoapply_sources", None)
    if sources is None:
        sources = discovery.build_sources(settings)
        request.app.state.autoapply_sources = sources
    return sources


def get_form(request: Request) -> FormAdapter:
    """The employer-form adapter. Only the fixture exists until a real one is approved."""
    form = getattr(request.app.state, "autoapply_form", None)
    if form is None:
        form = FixtureForm()
        request.app.state.autoapply_form = form
    return form


def get_mailbox_adapter(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MailboxAdapter:
    """Gmail when it is configured and chosen, else the fixture (which touches nobody)."""
    adapter = getattr(request.app.state, "autoapply_mailbox_adapter", None)
    if adapter is None:
        wants_gmail = (
            settings.autoapply_mailbox_provider == "gmail" and GmailOAuth(settings).enabled
        )
        adapter = GmailAdapter(settings) if wants_gmail else FixtureMailbox()
        request.app.state.autoapply_mailbox_adapter = adapter
    return adapter


def feature_on(settings: Settings = Depends(get_settings)) -> None:  # noqa: B008
    if not settings.autoapply_enabled:
        raise ApiError(404, "not_found", "Not found.")


router = APIRouter(prefix="/api/autoapply", tags=["autoapply"], dependencies=[Depends(feature_on)])

FIELD = re.compile(r"[^a-z0-9_]+")
Now = Callable[[], datetime]


def _problem(exc: Exception) -> ApiError:
    if isinstance(exc, camp.CampaignError):
        return ApiError(exc.status, exc.code, exc.message)
    return ApiError(422, "invalid_profile", str(exc))


async def _recheck(
    db: AsyncSession, user_id: Any, llm: LlmProvider, form: FormAdapter, now: datetime
) -> None:
    """Judge open applications again against the current rules, facts and answers."""
    c = await camp.current(db, user_id)
    prof = await camp.get_profile(db, user_id)
    if c is None or prof is None or c.status != "active" or c.ends_at <= now:
        return
    ctx = await pipeline.load_context(db, user_id, c, prof, llm=llm, form=form, now=now)
    await pipeline.reevaluate_open(db, ctx)


def _profile_out(p: SearchProfile) -> ProfileOut:
    return ProfileOut(
        criteria=p.criteria,
        timezone=p.timezone,
        active_hours=p.active_hours,
        channels=rules.clean_channels(p.channels),
        daily_application_cap=p.daily_application_cap,
        daily_outreach_cap=p.daily_outreach_cap,
        paused=p.paused,
        version=p.version,
    )


async def mailbox_address(db: AsyncSession, user_id: Any) -> str | None:
    """The connected mailbox, if any. Replaced by the real lookup once mailboxes exist."""
    from app.autoapply import mailbox  # local: mailbox support is added in a later step

    return await mailbox.connected_address(db, user_id)


@router.get("/status")
async def status(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> StatusOut:
    prof = await camp.get_profile(db, user.id)
    c = await camp.current(db, user.id)
    return StatusOut(enabled=True, campaign=CampaignOut(**camp.progress(c, prof, now)))


@router.get("/profile")
async def read_profile(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> ProfileOut:
    prof = await camp.get_profile(db, user.id)
    if prof is None:
        return ProfileOut(
            criteria={},
            timezone="UTC",
            active_hours={},
            channels=rules.clean_channels({}),
            daily_application_cap=10,
            daily_outreach_cap=3,
            paused=False,
            version=0,
        )
    return _profile_out(prof)


@router.put("/profile")
async def write_profile(
    body: SearchProfileIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> ProfileOut:
    before = await camp.get_profile(db, user.id)
    old_version = before.version if before else 0
    try:
        prof = await camp.save_profile(db, user.id, **body.model_dump())
    except (rules.ProfileProblem, camp.CampaignError) as exc:
        raise _problem(exc) from None
    if prof.version != old_version:
        await _recheck(db, user.id, llm, form, now)  # new rules apply to work not yet sent
    return _profile_out(prof)


# ----------------------------------------------------------------------------- CV facts


async def _cv(db: AsyncSession, user_id: Any) -> str:
    return (
        await db.execute(select(Note.content).where(Note.user_id == user_id))
    ).scalar_one_or_none() or ""


@router.get("/facts")
async def read_facts(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> FactsOut | None:
    row = await facts.get(db, user.id)
    if row is None:
        return None
    changed = row.cv_hash is not None and row.cv_hash != facts.cv_hash(await _cv(db, user.id))
    return FactsOut(
        data=row.data, version=row.version, verified_at=row.verified_at, cv_changed=changed
    )


@router.post("/facts/extract")
async def extract_facts(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
) -> FactsOut:
    """Read the CV into a draft for the person to check. Nothing is confirmed by this call."""
    cv = await _cv(db, user.id)
    if not cv.strip():
        raise ApiError(422, "no_cv", "Upload your CV first.")
    draft, from_model = await facts.extract(llm, cv, email=user.email, name=user.full_name)
    return FactsOut(data=draft, version=0, verified_at=None, from_model=from_model)


@router.put("/facts")
async def write_facts(
    body: FactsIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
) -> FactsOut:
    cv = await _cv(db, user.id)
    if not cv.strip():
        raise ApiError(422, "no_cv", "Upload your CV first.")
    row = await facts.save(db, user.id, body.data, cv=cv, now=now, verified=body.verified)
    await _recheck(db, user.id, llm, form, now)
    return FactsOut(data=row.data, version=row.version, verified_at=row.verified_at)


# ----------------------------------------------------------------------- reusable answers


def _answer_out(a: CandidateAnswer) -> AnswerOut:
    return AnswerOut(
        field=a.field,
        question=a.question,
        value=a.value,
        provenance=a.provenance,
        reusable=a.reusable,
        confirmed_at=a.confirmed_at,
        version=a.version,
    )


@router.get("/answers")
async def list_answers(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> list[AnswerOut]:
    rows = (
        (
            await db.execute(
                select(CandidateAnswer)
                .where(CandidateAnswer.user_id == user.id)
                .order_by(CandidateAnswer.field)
            )
        )
        .scalars()
        .all()
    )
    return [_answer_out(a) for a in rows]


@router.put("/answers/{field}")
async def save_answer(
    field: str,
    body: AnswerIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> AnswerOut:
    key = FIELD.sub("_", field.lower()).strip("_")[:60]
    if not key:
        raise ApiError(422, "invalid_field", "That answer needs a name.")
    row = (
        await db.execute(
            select(CandidateAnswer).where(
                CandidateAnswer.user_id == user.id, CandidateAnswer.field == key
            )
        )
    ).scalar_one_or_none()
    value = body.value.strip()
    if row is None:
        row = CandidateAnswer(user_id=user.id, field=key, version=1)
        db.add(row)
    elif row.value != value:
        row.version += 1
    row.value = value
    row.normalized = value.lower()[:200]
    row.question = body.question.strip() or row.question or ""
    row.provenance = "candidate"
    row.confirmed_at = now
    row.reusable = body.reusable  # only ever true because the person said so
    await db.commit()
    return _answer_out(row)


@router.delete("/answers/{field}")
async def delete_answer(
    field: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> Ok:
    row = (
        await db.execute(
            select(CandidateAnswer).where(
                CandidateAnswer.user_id == user.id, CandidateAnswer.field == field
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Ok(status="ok")


# --------------------------------------------------------- authorisation and the campaign


@router.get("/authorization")
async def disclosure(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> Disclosure:
    """What the person is agreeing to, and what is still missing, shown before they switch on."""
    prof = await camp.get_profile(db, user.id)
    mailbox = await mailbox_address(db, user.id)
    channels = rules.clean_channels(prof.channels if prof else {})
    problems = rules.readiness_problems(
        prof.criteria if prof else {}, channels, bool((await _cv(db, user.id)).strip())
    )
    if (channels["email"] or channels["outreach"]) and not mailbox:
        problems.append("Connect your email to apply or reach out by email.")
    summary = camp.authorization_summary(prof, mailbox) if prof else {"shared": []}
    return Disclosure(
        policy_version=settings.autoapply_policy_version,
        shared=summary["shared"],
        channels=channels,
        daily_application_cap=prof.daily_application_cap if prof else 10,
        daily_outreach_cap=prof.daily_outreach_cap if prof else 3,
        mailbox=mailbox,
        problems=problems,
    )


@router.post("/campaign/enable", status_code=201)
async def enable(
    body: EnableIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> CampaignOut:
    if not body.accept:
        raise ApiError(422, "not_accepted", "Confirm that you agree before switching it on.")
    try:
        c = await camp.enable(
            db,
            user.id,
            now=now,
            policy_version=body.policy_version,
            expected_policy=settings.autoapply_policy_version,
            mailbox=await mailbox_address(db, user.id),
        )
    except camp.CampaignError as exc:
        raise _problem(exc) from None
    prof = await camp.get_profile(db, user.id)
    return CampaignOut(**camp.progress(c, prof, now))


@router.post("/campaign/pause")
async def pause(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> CampaignOut:
    try:
        prof = await camp.pause(db, user.id, now)
    except camp.CampaignError as exc:
        raise _problem(exc) from None
    return CampaignOut(**camp.progress(await camp.current(db, user.id), prof, now))


@router.post("/campaign/resume")
async def resume(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> CampaignOut:
    try:
        prof = await camp.resume(db, user.id, now)
    except camp.CampaignError as exc:
        raise _problem(exc) from None
    return CampaignOut(**camp.progress(await camp.current(db, user.id), prof, now))


# ------------------------------------------------------------------ discovery and applications


def _posting_out(p: JobPosting) -> PostingOut:
    return PostingOut(
        id=str(p.id),
        company=p.company,
        title=p.title,
        region=p.region,
        arrangement=p.arrangement,
        application_url=p.application_url,
        source=p.source,
    )


def _app_out(a: Application, p: JobPosting) -> ApplicationOut:
    return ApplicationOut(
        id=str(a.id),
        status=a.status,
        channel=a.channel,
        posting=_posting_out(p),
        score=a.score,
        needs_input=a.needs_input or [],
        skip_reason=a.skip_reason,
        recruiting_stage=a.recruiting_stage,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


def _run_out(r: DiscoveryRun) -> RunOut:
    return RunOut(
        local_day=r.local_day.isoformat(),
        status=r.status,
        found=r.found,
        new=r.new,
        eligible=r.eligible,
        needs_input=r.needs_input,
        skipped=r.skipped,
        error=r.error,
        started_at=r.started_at,
        finished_at=r.finished_at,
    )


@router.post("/discovery/run")
async def run_discovery(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    sources: list[DiscoveryAdapter] = Depends(get_sources),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
) -> RunOut | None:
    """Run today's search now. If it already ran today, nothing changes and that run is returned."""
    run = await discovery.run_if_due(db, user.id, now=now, sources=sources, llm=llm, form=form)
    if run is None:
        return await _last_run(db, user.id)
    return _run_out(run)


async def _last_run(db: AsyncSession, user_id: Any) -> RunOut | None:
    run = (
        await db.execute(
            select(DiscoveryRun)
            .where(DiscoveryRun.user_id == user_id)
            .order_by(DiscoveryRun.started_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return _run_out(run) if run else None


@router.get("/discovery/last")
async def last_run(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> RunOut | None:
    return await _last_run(db, user.id)


@router.post("/jobs", status_code=201)
async def add_job(
    body: JobUrlIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    sources: list[DiscoveryAdapter] = Depends(get_sources),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
) -> ApplicationOut:
    """A job address pasted by the candidate goes through the same checks as a discovered one."""
    try:
        found = await discovery.intake_url(
            db, user.id, body.url.strip(), now=now, sources=sources, llm=llm, form=form
        )
    except camp.CampaignError as exc:
        raise _problem(exc) from None
    if found is None:
        raise ApiError(422, "unreadable_job", "That job page could not be read.")
    app, _outcome = found
    posting = await db.get(JobPosting, app.posting_id)
    assert posting is not None
    return _app_out(app, posting)


async def _owned(
    db: AsyncSession, user_id: Any, application_id: str
) -> tuple[Application, JobPosting]:
    try:
        key = uuid.UUID(application_id)
    except ValueError:
        raise ApiError(404, "not_found", "Application not found.") from None
    row = (
        await db.execute(
            select(Application, JobPosting)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .where(Application.id == key, Application.user_id == user_id)
        )
    ).first()
    if row is None:
        raise ApiError(404, "not_found", "Application not found.")  # never says it exists
    return row[0], row[1]


@router.get("/applications")
async def list_applications(
    status: str | None = None,
    limit: int = 30,
    before: str | None = None,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> ApplicationPage:
    limit = max(1, min(limit, 100))
    q = (
        select(Application, JobPosting)
        .join(JobPosting, JobPosting.id == Application.posting_id)
        .where(Application.user_id == user.id)
        .order_by(Application.created_at.desc(), Application.id.desc())
        .limit(limit + 1)
    )
    if status:
        q = q.where(Application.status.in_(status.split(",")))
    if before:
        try:
            ts, ident = before.split("|")
            q = q.where(
                tuple_(Application.created_at, Application.id)
                < tuple_(datetime.fromisoformat(ts), uuid.UUID(ident))
            )
        except ValueError:
            raise ApiError(422, "bad_cursor", "That page marker is not valid.") from None
    rows = (await db.execute(q)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    cursor = f"{rows[-1][0].created_at.isoformat()}|{rows[-1][0].id}" if more and rows else None
    return ApplicationPage(items=[_app_out(a, p) for a, p in rows], next_cursor=cursor)


@router.get("/applications/{application_id}")
async def application_detail(
    application_id: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> ApplicationDetail:
    a, p = await _owned(db, user.id, application_id)
    history = (
        (
            await db.execute(
                select(ApplicationEvent)
                .where(ApplicationEvent.application_id == a.id)
                .order_by(ApplicationEvent.created_at, ApplicationEvent.id)
            )
        )
        .scalars()
        .all()
    )
    attempts = (
        (
            await db.execute(
                select(SubmissionAttempt)
                .where(SubmissionAttempt.application_id == a.id)
                .order_by(SubmissionAttempt.claimed_at)
            )
        )
        .scalars()
        .all()
    )
    note = (
        await db.execute(
            select(Outreach).where(Outreach.user_id == user.id, Outreach.posting_id == p.id)
        )
    ).scalar_one_or_none()
    return ApplicationDetail(
        **_app_out(a, p).model_dump(),
        attempts=[
            AttemptOut(
                channel=t.channel,
                state=t.state,
                provider_ref=t.provider_ref,
                failure_message=t.failure_message,
                claimed_at=t.claimed_at,
                finished_at=t.finished_at,
            )
            for t in attempts
        ],
        outreach=_outreach_out(note, p) if note else None,
        match=a.match,
        package=a.package,
        package_frozen_at=a.package_frozen_at,
        history=[
            ApplicationEventOut(kind=h.kind, detail=h.detail, created_at=h.created_at)
            for h in history
        ],
    )


async def _rerun(
    db: AsyncSession,
    user_id: Any,
    a: Application,
    p: JobPosting,
    llm: LlmProvider,
    form: FormAdapter,
    now: datetime,
) -> ApplicationOut:
    c = await camp.current(db, user_id)
    prof = await camp.get_profile(db, user_id)
    if c is None or prof is None or c.status != "active" or c.ends_at <= now:
        raise ApiError(409, "not_active", "Auto-Apply is not running.")
    ctx = await pipeline.load_context(db, user_id, c, prof, llm=llm, form=form, now=now)
    app, _ = await pipeline.process(db, ctx, p)
    await db.commit()
    return _app_out(app, p)


@router.post("/applications/{application_id}/answer")
async def answer_question(
    application_id: str,
    body: AnswerApplicationIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
) -> ApplicationOut:
    """Answer the question the application is waiting on, then prepare it again."""
    a, p = await _owned(db, user.id, application_id)
    if a.status != "needs_input":
        raise ApiError(409, "not_waiting", "This application is not waiting for an answer.")
    value = body.value.strip()
    a.answers = {**(a.answers or {}), body.field: value}
    await pipeline.log(db, a, "answered", field=body.field)  # never the answer itself
    if body.save_for_reuse:
        row = (
            await db.execute(
                select(CandidateAnswer).where(
                    CandidateAnswer.user_id == user.id, CandidateAnswer.field == body.field
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = CandidateAnswer(user_id=user.id, field=body.field, version=1)
            db.add(row)
        elif row.value != value:
            row.version += 1
        row.value, row.normalized = value, value.lower()[:200]
        row.provenance, row.confirmed_at, row.reusable = "candidate", now, True
    await db.commit()
    return await _rerun(db, user.id, a, p, llm, form, now)


@router.post("/applications/{application_id}/approve")
async def approve_rule(
    application_id: str,
    body: ApproveIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
) -> ApplicationOut:
    """The candidate has looked at a criterion the listing did not settle and says to go ahead."""
    a, p = await _owned(db, user.id, application_id)
    open_rules = {n.get("field") for n in a.needs_input or []}
    if a.status != "needs_input" or body.rule not in open_rules:
        raise ApiError(409, "not_waiting", "That is not something this application is waiting on.")
    a.answers = {**(a.answers or {}), f"approve:{body.rule}": "yes"}
    await pipeline.log(db, a, "approved", rule=body.rule)
    await db.commit()
    return await _rerun(db, user.id, a, p, llm, form, now)


@router.post("/applications/{application_id}/skip")
async def skip_application(
    application_id: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> ApplicationOut:
    a, p = await _owned(db, user.id, application_id)
    if a.status in ("sending", "submitted", "sent_email", "confirmation_pending"):
        raise ApiError(409, "already_sent", "This application has already gone out.")
    a.status, a.skip_reason, a.needs_input = "skipped", pipeline.USER_SKIPPED, []
    await pipeline.log(db, a, "skipped", reason="by you")
    await db.commit()
    return _app_out(a, p)


@router.post("/applications/{application_id}/retry")
async def retry_application(
    application_id: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
) -> ApplicationOut:
    """Check an application again, including one the candidate skipped earlier."""
    a, p = await _owned(db, user.id, application_id)
    if a.status in ("sending", "submitted", "sent_email", "confirmation_pending"):
        raise ApiError(409, "already_sent", "This application has already gone out.")
    if a.status == "skipped" and a.skip_reason == pipeline.USER_SKIPPED:
        a.skip_reason = None
    return await _rerun(db, user.id, a, p, llm, form, now)


# ----------------------------------------------------------------------------------- mailbox


@router.get("/mailbox")
async def read_mailbox(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MailboxOut:
    conn = await mbx.get(db, user.id)
    can = settings.autoapply_mailbox_provider != "gmail" or GmailOAuth(settings).enabled
    if conn is None or conn.status == "disconnected":
        return MailboxOut(connected=False, status="disconnected" if conn else None, can_connect=can)
    return MailboxOut(
        connected=conn.status == "connected",
        provider=conn.provider,
        address=conn.address,
        status=conn.status,
        last_synced_at=conn.last_synced_at,
        can_connect=can,
    )


@router.post("/mailbox/connect")
async def connect_mailbox(
    response: Response,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> ConnectOut:
    """Gmail: returns the Google address to approve access at. Fixture mode connects at once."""
    if settings.autoapply_mailbox_provider == "gmail":
        oauth = GmailOAuth(settings)
        if not oauth.enabled:
            raise ApiError(503, "mailbox_unavailable", "Email connection is not set up yet.")
        url, cookie = oauth.begin(str(user.id))
        response.set_cookie(
            STATE_COOKIE,
            cookie,
            max_age=600,
            httponly=True,
            samesite="lax",
            secure=settings.environment != "local",
            path="/api/autoapply/mailbox",
        )
        return ConnectOut(connected=False, url=url)
    if settings.environment == "production":
        raise ApiError(503, "mailbox_unavailable", "Email connection is not set up yet.")
    await mbx.connect(
        db, settings, user.id, provider="fixture", address=user.email, credential="fixture", now=now
    )
    return ConnectOut(connected=True)


@router.get("/mailbox/callback")
async def mailbox_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> RedirectResponse:
    """Google sends the browser back here. The state must match the cookie set when this person
    started, and that cookie must name this very account."""
    oauth = GmailOAuth(settings)
    back = f"{settings.web_origin}/auto-apply"
    resp = RedirectResponse(f"{back}?mailbox=failed", status_code=303)
    if not oauth.check_state(request.cookies.get(STATE_COOKIE), state, str(user.id)):
        return resp  # not from the flow this browser started: leave that flow alone
    resp.delete_cookie(STATE_COOKIE, path="/api/autoapply/mailbox")  # a state works only once
    if error or not code:
        return resp
    try:
        address, credential = await oauth.exchange(code)
    except AdapterError:
        return resp
    await mbx.connect(
        db, settings, user.id, provider="gmail", address=address, credential=credential, now=now
    )
    resp.headers["location"] = f"{back}?mailbox=connected"
    return resp


@router.post("/mailbox/disconnect")
async def disconnect_mailbox(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    adapter: MailboxAdapter = Depends(get_mailbox_adapter),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> MailboxOut:
    """Stop sends and reads, revoke access, delete the credential. Other channels stay on."""
    await mbx.disconnect(db, settings, adapter, user.id)
    prof = await camp.get_profile(db, user.id)
    if prof is not None and any((prof.channels or {}).get(c) for c in ("email", "outreach")):
        channels = {**rules.clean_channels(prof.channels), "email": False, "outreach": False}
        await camp.save_profile(db, user.id, channels=channels)
        await _recheck(db, user.id, llm, form, now)  # email-only work is given up or re-judged
    return MailboxOut(connected=False, status="disconnected", can_connect=True)


# ---------------------------------------------------------------- outreach and unknown outcomes


def _outreach_out(o: Outreach, p: JobPosting) -> OutreachOut:
    return OutreachOut(
        id=str(o.id),
        application_id=str(o.application_id) if o.application_id else None,
        company=p.company,
        title=p.title,
        recipient=o.recipient,
        recipient_source=o.recipient_source,
        subject=o.subject,
        body=o.body,
        status=o.status,
        reason=o.reason,
        sent_at=o.sent_at,
    )


@router.get("/outreach")
async def list_outreach(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> list[OutreachOut]:
    rows = (
        await db.execute(
            select(Outreach, JobPosting)
            .join(JobPosting, JobPosting.id == Outreach.posting_id)
            .where(Outreach.user_id == user.id)
            .order_by(Outreach.created_at.desc())
            .limit(100)
        )
    ).all()
    return [_outreach_out(o, p) for o, p in rows]


@router.post("/applications/{application_id}/outreach", status_code=201)
async def request_outreach(
    application_id: str,
    body: OutreachIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> OutreachOut:
    """Name a hiring contact for this role. One note per role, under its own daily limit."""
    a, p = await _owned(db, user.id, application_id)
    try:
        row = await outreach.request(db, user.id, a, p, body.recipient, now)
    except outreach.OutreachError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from None
    return _outreach_out(row, p)


@router.post("/applications/{application_id}/resolve")
async def resolve_unknown(
    application_id: str,
    body: ResolveIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> ApplicationOut:
    """The candidate says what really happened to an application we could not confirm."""
    a, p = await _owned(db, user.id, application_id)
    if a.status != "confirmation_pending":
        raise ApiError(409, "not_waiting", "This application is not waiting to be confirmed.")
    await outbox.resolve_by_candidate(db, a, sent=body.sent, now=now)
    return _app_out(a, p)


# ------------------------------------------------------------- employer replies and interviews


def _interview_out(link: InterviewLink, p: JobPosting, now: datetime) -> InterviewOut:
    return InterviewOut(
        id=str(link.id),
        application_id=str(link.application_id),
        company=p.company,
        title=p.title,
        round=link.round,
        status=link.status,
        scheduling_url=link.scheduling_url,
        meeting_url=link.meeting_url,
        scheduled_at=link.scheduled_at,
        time_zone_unclear=link.time_zone_unclear,
        company_id=str(link.company_id) if link.company_id else None,
        last_event_id=str(link.last_event_id) if link.last_event_id else None,
        action=dashboard.action_for(link, now),
        history=link.history or [],
    )


async def _interviews(db: AsyncSession, user_id: Any) -> list[tuple[InterviewLink, JobPosting]]:
    rows = (
        await db.execute(
            select(InterviewLink, JobPosting)
            .join(Application, Application.id == InterviewLink.application_id)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .where(InterviewLink.user_id == user_id)
            .order_by(InterviewLink.scheduled_at.asc().nulls_last(), InterviewLink.created_at)
        )
    ).all()
    return [(r[0], r[1]) for r in rows]


@router.get("/interviews")
async def list_interviews(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> list[InterviewOut]:
    return [_interview_out(link, p, now) for link, p in await _interviews(db, user.id)]


@router.post("/interviews/{interview_id}/prepare")
async def prepare_interview(
    interview_id: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    runner: ResearchRunner = Depends(get_runner),  # noqa: B008
) -> PrepareOut:
    """Open this interview in the preparation part of the app: its company is created (or found)
    and researched, and the session starts with the submitted CV and application."""
    try:
        key = uuid.UUID(interview_id)
        company_id, _role, _snapshot = await interviews.session_context(db, user.id, key)
    except ValueError:
        raise ApiError(404, "interview_not_found", "Interview not found.") from None
    except interviews.HandoffError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from None
    repo = CompaniesRepo(db, user.id)
    started = False
    if await repo.latest_job(company_id) is None:
        if await UsageRepo(db, user.id).consume_research_job(settings.cap_research_jobs_daily):
            job = repo.add_job(company_id, refresh=False)
            await db.flush()
            started = True
    await db.commit()
    if started:
        runner.start(job.id)
    return PrepareOut(
        interview_id=str(key),
        company_id=str(company_id),
        session_url=f"/session/new?interview={key}",
        research_started=started,
    )


async def _review_out(db: AsyncSession, user_id: Any, ev: RecruitingEvent) -> RecruitingOut:
    ids = [uuid.UUID(i) for i in (ev.evidence or {}).get("candidates", [])]
    cands: list[CandidateApp] = []
    if ids:
        rows = (
            await db.execute(
                select(Application.id, JobPosting.company, JobPosting.title)
                .join(JobPosting, JobPosting.id == Application.posting_id)
                .where(Application.user_id == user_id, Application.id.in_(ids))
            )
        ).all()
        cands = [CandidateApp(id=str(i), company=c, title=t) for i, c, t in rows]
    return RecruitingOut(
        id=str(ev.id),
        kind=ev.kind,
        status=ev.status,
        received_at=ev.received_at,
        sender=(ev.evidence or {}).get("from", ""),
        subject=(ev.evidence or {}).get("subject", ""),
        matched_by=(ev.evidence or {}).get("matched_by"),
        application_id=str(ev.application_id) if ev.application_id else None,
        candidates=cands,
        scheduled_at=ev.scheduled_at,
        time_zone_unclear=ev.time_zone_unclear,
        links=ev.links or {},
    )


async def _event(db: AsyncSession, user_id: Any, event_id: str) -> RecruitingEvent:
    try:
        key = uuid.UUID(event_id)
    except ValueError:
        raise ApiError(404, "not_found", "Not found.") from None
    ev = (
        await db.execute(
            select(RecruitingEvent).where(
                RecruitingEvent.id == key, RecruitingEvent.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if ev is None:
        raise ApiError(404, "not_found", "Not found.")
    return ev


@router.get("/recruiting")
async def list_recruiting(
    status: str | None = None,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> list[RecruitingOut]:
    q = (
        select(RecruitingEvent)
        .where(RecruitingEvent.user_id == user.id)
        .order_by(RecruitingEvent.received_at.desc())
        .limit(100)
    )
    if status:
        q = q.where(RecruitingEvent.status == status)
    return [await _review_out(db, user.id, e) for e in (await db.execute(q)).scalars().all()]


@router.post("/recruiting/{event_id}/link")
async def link_event(
    event_id: str,
    body: LinkEventIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> RecruitingOut:
    """Settle an ambiguous employer message by choosing the application it belongs to."""
    ev = await _event(db, user.id, event_id)
    if ev.status != "needs_review":
        raise ApiError(409, "not_waiting", "This message is already settled.")
    a, p = await _owned(db, user.id, body.application_id)
    ev.application_id, ev.status = a.id, "matched"
    from app.autoapply import mailsync

    await mailsync._apply(db, ev, a, p, now)
    await db.commit()
    return await _review_out(db, user.id, ev)


@router.post("/recruiting/{event_id}/dismiss")
async def dismiss_event(
    event_id: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> RecruitingOut:
    ev = await _event(db, user.id, event_id)
    if ev.status == "needs_review":
        ev.status = "dismissed"
        await db.commit()
    return await _review_out(db, user.id, ev)


@router.post("/recruiting/{event_id}/confirm-time")
async def confirm_time(
    event_id: str,
    body: ConfirmTimeIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> RecruitingOut:
    """The message named no clear time zone, so the candidate says which one it was written in."""
    ev = await _event(db, user.id, event_id)
    local = (ev.evidence or {}).get("local_time")
    try:
        zone_name = rules.clean_timezone(body.timezone)
    except rules.ProfileProblem as exc:
        raise ApiError(422, "invalid_timezone", str(exc)) from None
    if not ev.time_zone_unclear or not local:
        raise ApiError(409, "not_waiting", "This time does not need confirming.")
    ev.scheduled_at, ev.time_zone_unclear = recruiting.at_zone(local, zone_name), False
    for link in (
        await db.execute(select(InterviewLink).where(InterviewLink.last_event_id == ev.id))
    ).scalars():
        link.scheduled_at, link.time_zone_unclear = ev.scheduled_at, False
    await db.commit()
    return await _review_out(db, user.id, ev)


# ---------------------------------------------------------------------------- the dashboard


@router.get("/dashboard")
async def read_dashboard(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> DashboardOut:
    """Next interview, what needs the candidate, and recent applications, in that order."""
    prof = await camp.get_profile(db, user.id)
    c = await camp.current(db, user.id)
    progress = camp.progress(c, prof, now)
    box = await mbx.get(db, user.id)
    channels = rules.clean_channels(prof.channels if prof else {})
    mailbox_out = MailboxOut(
        connected=bool(box and box.status == "connected"),
        provider=box.provider if box else None,
        address=box.address if box else None,
        status=box.status if box else None,
        last_synced_at=box.last_synced_at if box else None,
    )
    all_interviews = await _interviews(db, user.id)
    upcoming = next(
        ((link, p) for link, p in all_interviews if dashboard.is_upcoming(link, now)), None
    )
    invites = [(link, p) for link, p in all_interviews if link.status == "invited"]
    waiting = (
        await db.execute(
            select(Application, JobPosting)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .where(Application.user_id == user.id, Application.status == "needs_input")
            .order_by(Application.updated_at.desc())
            .limit(5)
        )
    ).all()
    recent = (
        await db.execute(
            select(Application, JobPosting)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .where(
                Application.user_id == user.id,
                Application.status.in_(
                    (
                        "submitted",
                        "sent_email",
                        "confirmation_pending",
                        "failed",
                        "queued",
                        "sending",
                    )
                ),
            )
            .order_by(Application.updated_at.desc())
            .limit(10)
        )
    ).all()
    counts_rows = (
        await db.execute(
            select(Application.status, func.count())
            .where(Application.user_id == user.id)
            .group_by(Application.status)
        )
    ).all()
    run = await _last_run(db, user.id)
    run_count = (
        await db.execute(
            select(func.count()).select_from(DiscoveryRun).where(DiscoveryRun.user_id == user.id)
        )
    ).scalar_one()
    needs_reconnect = bool(
        box and box.status == "reauth_needed" and (channels["email"] or channels["outreach"])
    )
    state, kind, label = dashboard.decide(
        campaign=c,
        campaign_state=progress["state"],
        paused=bool(prof and prof.paused),
        has_profile=prof is not None,
        needs_reconnect=needs_reconnect,
        upcoming=upcoming[0] if upcoming else None,
        open_invite=next((link for link, _ in invites if link.scheduling_url), None),
        first_waiting=str(waiting[0][0].id) if waiting else None,
        last_run_status=run.status if run else None,
        last_run_eligible=run.eligible if run else 0,
        run_count=run_count,
    )
    href = {
        "setup": "/auto-apply/setup",
        "preferences": "/auto-apply/setup",
        "reconnect": "/auto-apply/setup#email",
        "results": "/auto-apply/applications",
        "last_run": "/auto-apply/applications",
    }.get(kind)
    primary = PrimaryAction(kind=kind, label=label, href=href)
    if kind in ("prepare", "book") and (upcoming or invites):
        link = upcoming or next(((link, p) for link, p in invites if link.scheduling_url), None)
        if link:
            primary.interview_id = str(link[0].id)
            primary.href = link[0].scheduling_url if kind == "book" else None
    if kind == "answer" and waiting:
        primary.application_id = str(waiting[0][0].id)
        primary.href = f"/auto-apply/applications/{waiting[0][0].id}"
    usage = None
    if c is not None and prof is not None:
        day = clock.local_day(now, c.timezone)
        usage = UsageOut(
            applications_used=await outbox.used_today(db, user.id, ("form", "email"), day),
            applications_cap=prof.daily_application_cap,
            outreach_used=await outbox.used_today(db, user.id, ("outreach",), day),
            outreach_cap=prof.daily_outreach_cap,
        )
    review = (
        await db.execute(
            select(func.count())
            .select_from(RecruitingEvent)
            .where(RecruitingEvent.user_id == user.id, RecruitingEvent.status == "needs_review")
        )
    ).scalar_one()
    return DashboardOut(
        state=state,
        primary=primary,
        campaign=CampaignOut(**progress),
        paused=bool(prof and prof.paused),
        mailbox=mailbox_out,
        channels=channels,
        last_run=run,
        usage=usage,
        next_interview=_interview_out(*upcoming, now) if upcoming else None,
        open_invites=[_interview_out(link, p, now) for link, p in invites],
        needs_input=[_app_out(a, p) for a, p in waiting],
        recent=[_app_out(a, p) for a, p in recent],
        counts={status: n for status, n in counts_rows},
        review_count=review,
    )
