"""Auto-Apply: the candidate's search, authorisation and 30-day campaign. Everything here belongs to
the signed-in person; the flag `AUTOAPPLY_ENABLED` turns the whole feature off (404)."""

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.interfaces import LlmProvider
from app.autoapply import campaign as camp
from app.autoapply import clock, facts, rules
from app.autoapply.schemas import (
    AnswerIn,
    AnswerOut,
    CampaignOut,
    Disclosure,
    EnableIn,
    FactsIn,
    FactsOut,
    ProfileIn,
    ProfileOut,
    StatusOut,
)
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import CandidateAnswer, Note, SearchProfile, User
from app.schemas.api import StatusOut as Ok
from app.services.providers import build_answer_llm


def get_now() -> datetime:
    """The current time. Tests replace this to move through a whole campaign."""
    return clock.utcnow()


def get_llm(settings: Settings = Depends(get_settings)) -> LlmProvider:  # noqa: B008
    return build_answer_llm(settings)


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
) -> ProfileOut:
    try:
        prof = await camp.save_profile(db, user.id, **body.model_dump())
    except (rules.ProfileProblem, camp.CampaignError) as exc:
        raise _problem(exc) from None
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
) -> FactsOut:
    cv = await _cv(db, user.id)
    if not cv.strip():
        raise ApiError(422, "no_cv", "Upload your CV first.")
    row = await facts.save(db, user.id, body.data, cv=cv, now=now, verified=body.verified)
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
