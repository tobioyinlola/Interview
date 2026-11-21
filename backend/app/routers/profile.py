from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, me_out
from app.errors import ApiError
from app.models import User
from app.repositories import NotesRepo, ProfileRepo
from app.schemas.api import MeOut, OnboardingIn, ProfileIn, TourIn
from app.services.events import record_from
from app.services.names import clean_name

router = APIRouter(prefix="/api", tags=["profile"])

INVALID_NAME = ApiError(422, "invalid_name", "Please enter your full name, using letters only.")


@router.put("/profile")
async def save_profile(
    body: ProfileIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MeOut:
    name = clean_name(body.full_name)
    if name is None:
        raise INVALID_NAME
    await ProfileRepo(db, user).update(full_name=name)
    await record_from(db, "user.profile_updated", user_id=user.id)
    return me_out(user, settings)


@router.put("/tour")
async def save_tour(
    body: TourIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MeOut:
    """Remember that the first-time tour was finished or skipped, so it is not shown again. Asking
    for done=false shows it again the next time the dashboard opens."""
    await ProfileRepo(db, user).update(tour_done_at=datetime.now(UTC) if body.done else None)
    if body.done:
        await record_from(db, "tour.done", user_id=user.id)
    return me_out(user, settings)


@router.put("/onboarding")
async def save_onboarding(
    body: OnboardingIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> MeOut:
    """Finish onboarding with all four answers, or skip it. Either way the person is not asked
    again. The target role, if given, goes to the CV page."""
    values: dict[str, object] = {}
    if body.full_name is not None:
        name = clean_name(body.full_name)
        if name is None:
            raise INVALID_NAME
        values["full_name"] = name
    answers: dict[str, object] = {}
    if body.goal:
        answers["goal"] = body.goal
    if body.level:
        answers["level"] = body.level
    if body.timeline:
        answers["timeline"] = body.timeline
    if body.focus:
        answers["focus"] = list(dict.fromkeys(body.focus))  # no repeats, order kept
    if not body.skipped and not (body.goal and body.level and body.timeline and body.focus):
        raise ApiError(422, "onboarding_incomplete", "Answer all four questions, or skip for now.")
    if answers:
        values["onboarding"] = answers
    values["onboarded_at"] = user.onboarded_at or datetime.now(UTC)
    if body.role and body.role.strip():
        await NotesRepo(db, user.id).upsert(role=body.role.strip())
    first_time = user.onboarded_at is None
    await ProfileRepo(db, user).update(**values)
    if first_time:
        await record_from(
            db,
            "onboarding.skipped" if body.skipped and not answers else "onboarding.completed",
            user_id=user.id,
            goal=answers.get("goal"),
            level=answers.get("level"),
            timeline=answers.get("timeline"),
            focus=answers.get("focus", []),
        )
    return me_out(user, settings)
