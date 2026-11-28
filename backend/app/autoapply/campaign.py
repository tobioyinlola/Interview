"""The search profile, its authorisation and the 30-day campaign."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.autoapply import clock, rules
from app.models import Campaign, Note, SearchProfile
from app.services.events import record_from


class CampaignError(Exception):
    """An action that cannot be done now. `code` is stable; `message` is for the person."""

    def __init__(self, code: str, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


async def get_profile(db: AsyncSession, user_id: uuid.UUID) -> SearchProfile | None:
    return (
        await db.execute(select(SearchProfile).where(SearchProfile.user_id == user_id))
    ).scalar_one_or_none()


async def save_profile(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    criteria: dict[str, Any] | None = None,
    timezone: str | None = None,
    active_hours: Any = None,
    channels: Any = None,
    daily_application_cap: int | None = None,
    daily_outreach_cap: int | None = None,
) -> SearchProfile:
    """Create or update the profile. Changing criteria bumps `version`, which invalidates queued
    work that was matched against the old rules (see outbox.final_check)."""
    prof = await get_profile(db, user_id)
    if prof is None:
        prof = SearchProfile(
            user_id=user_id, criteria={}, active_hours={}, channels={}, timezone="UTC", version=0
        )
        db.add(prof)
    changed = False
    if criteria is not None:
        new = rules.clean_criteria(criteria)
        changed = changed or new != prof.criteria
        prof.criteria = new
    if timezone is not None:
        tz = rules.clean_timezone(timezone)
        changed = changed or tz != prof.timezone
        prof.timezone = tz
    if active_hours is not None:
        prof.active_hours = rules.clean_hours(active_hours)
    if channels is not None:
        new_channels = rules.clean_channels(channels)
        changed = changed or new_channels != prof.channels
        prof.channels = new_channels
    for name, value, high in (
        ("daily_application_cap", daily_application_cap, 50),
        ("daily_outreach_cap", daily_outreach_cap, 20),
    ):
        if value is not None:
            if not 0 <= value <= high:
                raise rules.ProfileProblem(f"The daily limit must be between 0 and {high}.")
            setattr(prof, name, value)
    if changed:
        prof.version += 1
    await db.commit()
    return prof


async def current(db: AsyncSession, user_id: uuid.UUID) -> Campaign | None:
    """The active campaign, or else the most recent one (so its results can still be shown)."""
    rows = (
        (
            await db.execute(
                select(Campaign)
                .where(Campaign.user_id == user_id)
                .order_by(Campaign.activated_at.desc())
                .limit(1)
            )
        )
        .scalars()
        .all()
    )
    return rows[0] if rows else None


async def close_expired(db: AsyncSession, now: datetime) -> int:
    """End every campaign whose day 30 is over. Replies keep arriving afterwards; only outbound
    work stops."""
    rows = (
        (
            await db.execute(
                select(Campaign).where(Campaign.status == "active", Campaign.ends_at <= now)
            )
        )
        .scalars()
        .all()
    )
    for c in rows:
        c.status = "ended"
        c.ended_at = c.ends_at
        await record_from(db, "autoapply.ended", user_id=c.user_id, campaign=str(c.id))
    await db.commit()
    return len(rows)


def authorization_summary(prof: SearchProfile, mailbox: str | None) -> dict[str, Any]:
    """What the candidate is told before switching on. Stored with the campaign so it is always
    possible to say exactly what was authorised."""
    return {
        "shared": [
            "your name, email address and phone number",
            "your CV, exactly as you uploaded it",
            "your verified work history, skills and links",
            "answers you approved, for questions employers ask",
        ],
        "channels": rules.clean_channels(prof.channels),
        "daily_application_cap": prof.daily_application_cap,
        "daily_outreach_cap": prof.daily_outreach_cap,
        "mailbox": mailbox,
    }


async def enable(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    now: datetime,
    policy_version: str,
    expected_policy: str,
    mailbox: str | None,
) -> Campaign:
    """Start a campaign after explicit authorisation. Renewing after one ends is the same call."""
    prof = await get_profile(db, user_id)
    if prof is None:
        raise CampaignError("no_profile", "Set up your search first.", 422)
    if policy_version != expected_policy:
        raise CampaignError(
            "policy_changed", "The terms changed. Read them again and confirm.", 409
        )
    has_cv = bool(
        (await db.execute(select(Note.content).where(Note.user_id == user_id))).scalar_one_or_none()
    )
    channels = rules.clean_channels(prof.channels)
    problems = rules.readiness_problems(prof.criteria or {}, channels, has_cv)
    if (channels["email"] or channels["outreach"]) and not mailbox:
        problems.append("Connect your email to apply or reach out by email.")
    if problems:
        raise CampaignError("not_ready", " ".join(problems), 422)
    existing = await current(db, user_id)
    if existing is not None and existing.status == "active":
        raise CampaignError("already_active", "Auto-Apply is already running.")
    camp = Campaign(
        user_id=user_id,
        profile_id=prof.id,
        timezone=prof.timezone,
        activated_at=now,
        ends_at=clock.campaign_end(now, prof.timezone),
        status="active",
        daily_application_cap=prof.daily_application_cap,
        daily_outreach_cap=prof.daily_outreach_cap,
        channels=channels,
        policy_version=policy_version,
        authorization=authorization_summary(prof, mailbox),
    )
    db.add(camp)
    prof.policy_version = policy_version
    prof.authorized_at = now
    prof.paused = False
    prof.paused_at = None
    await db.commit()
    await record_from(
        db, "autoapply.enabled", user_id=user_id, campaign=str(camp.id), policy=policy_version
    )
    return camp


async def pause(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> SearchProfile:
    """Pausing stops queued sends that have not started. It does not extend the end date."""
    prof = await get_profile(db, user_id)
    if prof is None:
        raise CampaignError("no_profile", "Set up your search first.", 422)
    if not prof.paused:
        prof.paused, prof.paused_at = True, now
        await db.commit()
        await record_from(db, "autoapply.paused", user_id=user_id)
    return prof


async def resume(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> SearchProfile:
    prof = await get_profile(db, user_id)
    camp = await current(db, user_id)
    if prof is None or camp is None or camp.status != "active":
        raise CampaignError("not_active", "There is no running search to resume.")
    if camp.ends_at <= now:
        raise CampaignError("campaign_over", "This 30-day search has finished. Start a new one.")
    if prof.paused:
        prof.paused, prof.paused_at = False, None
        await db.commit()
        await record_from(db, "autoapply.resumed", user_id=user_id)
    return prof


def progress(camp: Campaign | None, prof: SearchProfile | None, now: datetime) -> dict[str, Any]:
    """Where the campaign stands, for the dashboard."""
    if camp is None:
        return {"state": "none"}
    day = clock.campaign_day(camp.activated_at, now, camp.timezone)
    over = camp.status == "ended" or camp.ends_at <= now
    state = "ended" if over else ("paused" if prof and prof.paused else "active")
    return {
        "state": state,
        "day": min(max(day, 1), clock.CAMPAIGN_DAYS),
        "days_total": clock.CAMPAIGN_DAYS,
        "activated_at": camp.activated_at,
        "ends_at": camp.ends_at,
        "timezone": camp.timezone,
    }


def outreach_open(camp: Campaign | None, prof: SearchProfile | None, now: datetime) -> bool:
    """May a note to a hiring manager go out? Like applications, except that pausing Auto-Apply
    does not stop it: outreach has its own pause (see hunt.engine.paused)."""
    return camp is not None and camp.status == "active" and now < camp.ends_at and prof is not None


def outbound_open(camp: Campaign | None, prof: SearchProfile | None, now: datetime) -> bool:
    """May anything new be sent for this candidate right now?"""
    return (
        camp is not None
        and camp.status == "active"
        and now < camp.ends_at
        and prof is not None
        and not prof.paused
    )
