"""Auto-Apply: the candidate's search, authorisation and 30-day campaign. Everything here belongs to
the signed-in person; the flag `AUTOAPPLY_ENABLED` turns the whole feature off (404)."""

import re
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.interfaces import LlmProvider
from app.autoapply import campaign as camp
from app.autoapply import clock, discovery, facts, pipeline, rules
from app.autoapply.adapters import DiscoveryAdapter, FormAdapter
from app.autoapply.fixtures import FixtureForm
from app.autoapply.schemas import (
    AnswerApplicationIn,
    AnswerIn,
    AnswerOut,
    ApplicationDetail,
    ApplicationEventOut,
    ApplicationOut,
    ApplicationPage,
    ApproveIn,
    CampaignOut,
    Disclosure,
    EnableIn,
    FactsIn,
    FactsOut,
    JobUrlIn,
    PostingOut,
    ProfileIn,
    ProfileOut,
    RunOut,
    StatusOut,
)
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import (
    Application,
    ApplicationEvent,
    CandidateAnswer,
    DiscoveryRun,
    JobPosting,
    Note,
    SearchProfile,
    User,
)
from app.schemas.api import StatusOut as Ok
from app.services.providers import build_answer_llm


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
    body: ProfileIn,
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
    return ApplicationDetail(
        **_app_out(a, p).model_dump(),
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
