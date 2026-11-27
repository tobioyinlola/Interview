"""The application run: a live view of what Auto-Apply is doing, controls that act on it, and the
endpoints the desktop app uses to carry out browser applications on the candidate's own computer.

Controls act on the shared run state (autoapply/runlog), which every executor reads: the server's
worker looks before it claims anything, and the desktop is told at every report, so a button pressed
on the phone really does stop work on the desktop."""

import asyncio
import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.autoapply import ats, campaign, desktop, outbox, runlog
from app.autoapply.adapters import FormAdapter, MailboxAdapter
from app.config import Settings, get_settings
from app.db import get_db, get_sessionmaker
from app.deps import current_user
from app.errors import ApiError
from app.models import Application, Executor, SubmissionAttempt, User
from app.routers.autoapply import feature_on, get_form, get_mailbox_adapter, get_now

router = APIRouter(
    prefix="/api/autoapply", tags=["autoapply-run"], dependencies=[Depends(feature_on)]
)

LONG_POLL_MAX = 25.0


# ---------------------------------------------------------------------------------- schemas


class RunEventOut(BaseModel):
    id: int
    kind: str
    text: str
    executor: str
    data: dict[str, Any]
    at: datetime
    application_id: uuid.UUID | None = None


class RunCurrentOut(BaseModel):
    company: str | None = None
    title: str | None = None
    score: float | None = None
    ats: str | None = None
    ats_label: str | None = None
    stage: str | None = None
    fields_done: int = 0
    fields_total: int = 0
    step: int = 1
    question: str | None = None
    cv_version: str | None = None
    executor: str | None = None
    progress: int = 0  # percent of the form filled in


class RunCountersOut(BaseModel):
    queued: int
    verified: int
    verified_today: int
    failed: int
    skipped: int
    needs_you: int


class RunExecutorOut(BaseModel):
    name: str
    platform: str
    online: bool


class RunViewOut(BaseModel):
    state: Literal["idle", "running", "paused", "stopped", "ended"]
    speed: str
    execution_mode: str
    forms_run_on: Literal["desktop", "cloud"]
    desktop_open: bool
    executors: list[RunExecutorOut]
    counters: RunCountersOut
    current: RunCurrentOut | None
    events: list[RunEventOut]
    last_seq: int


class RunEventsOut(BaseModel):
    events: list[RunEventOut]
    last_seq: int


class RunSettingsIn(BaseModel):
    speed: Literal["slow", "normal", "fast"] | None = None
    execution_mode: Literal["auto", "desktop", "cloud"] | None = None


# ----------------------------------------------------------------------------------- helpers


def _event(e: Any) -> RunEventOut:
    return RunEventOut(
        id=e.id,
        kind=e.kind,
        text=runlog.KINDS.get(e.kind, e.kind),
        executor=e.executor,
        data=e.data or {},
        at=e.at,
        application_id=e.application_id,
    )


async def _counters(db: AsyncSession, user_id: uuid.UUID, today: Any) -> RunCountersOut:
    rows = (
        await db.execute(
            select(Application.status, func.count())
            .where(Application.user_id == user_id)
            .group_by(Application.status)
        )
    ).all()
    n = {s: int(c) for s, c in rows}
    verified_today = (
        await db.execute(
            select(func.count())
            .select_from(SubmissionAttempt)
            .where(
                SubmissionAttempt.user_id == user_id,
                SubmissionAttempt.state == "confirmed",
                SubmissionAttempt.local_day == today,
            )
        )
    ).scalar_one()
    return RunCountersOut(
        queued=n.get("queued", 0) + n.get("sending", 0),
        verified=n.get("submitted", 0) + n.get("sent_email", 0),
        verified_today=int(verified_today),
        failed=n.get("failed", 0),
        skipped=n.get("skipped", 0) + n.get("expired", 0),
        needs_you=n.get("needs_input", 0)
        + n.get("apply_yourself", 0)
        + n.get("confirmation_pending", 0),
    )


def _current(raw: dict[str, Any] | None) -> RunCurrentOut | None:
    if not raw:
        return None
    system = ats.BY_KEY.get(str(raw.get("ats") or ""))
    total = int(raw.get("fields_total") or 0)
    done = int(raw.get("fields_done") or 0)
    stage = str(raw.get("stage") or "")
    pct = 100 if stage == "Done" else min(95, round(100 * done / total)) if total else 0
    return RunCurrentOut(
        company=raw.get("company"),
        title=raw.get("title"),
        score=raw.get("score"),
        ats=raw.get("ats"),
        ats_label=system.label if system else ("Email" if raw.get("ats") == "email" else None),
        stage=stage or None,
        fields_done=done,
        fields_total=total,
        step=int(raw.get("step") or 1),
        question=raw.get("question"),
        cv_version=raw.get("cv_version"),
        executor=raw.get("executor"),
        progress=pct,
    )


async def _snapshot(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> RunViewOut:
    from app.autoapply import clock

    camp = await campaign.current(db, user_id)
    prof = await campaign.get_profile(db, user_id)
    state = await runlog.state_for(db, user_id)
    open_ = await runlog.desktop_ready(db, user_id, now)
    if camp is None:
        label = "idle"
    elif camp.status == "ended" or camp.ends_at <= now:
        label = "ended"
    elif state.stopped:
        label = "stopped"
    elif prof is not None and prof.paused:
        label = "paused"
    else:
        label = "running"
    today = clock.local_day(now, camp.timezone) if camp is not None else now.date()
    seen = (
        (
            await db.execute(
                select(Executor)
                .where(Executor.user_id == user_id)
                .order_by(Executor.last_seen.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    events = await runlog.latest(db, user_id, 40)
    await db.commit()  # the row created for a first-time user
    return RunViewOut(
        state=label,
        speed=state.speed,
        execution_mode=state.execution_mode,
        forms_run_on=runlog.who_runs_forms(state, open_),
        desktop_open=open_,
        executors=[
            RunExecutorOut(
                name=e.name or "Desktop",
                platform=e.platform,
                online=e.last_seen >= now - runlog.DESKTOP_FRESH,
            )
            for e in seen
        ],
        counters=await _counters(db, user_id, today),
        current=_current(state.current),
        events=[_event(e) for e in events],
        last_seq=events[-1].id if events else 0,
    )


# ------------------------------------------------------------------------- the live view


@router.get("/run")
async def run_view(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> RunViewOut:
    return await _snapshot(db, user.id, now)


@router.get("/run/events")
async def run_events(
    after: int = 0,
    wait: float = 0.0,
    user: User = Depends(current_user),  # noqa: B008
    maker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
) -> RunEventsOut:
    """Events after number `after`. With `wait`, holds the request open (up to 25 seconds) until
    there is one, so a screen follows the run live over plain HTTP, on the web and in every app."""
    waited = 0.0
    wait = max(0.0, min(wait, LONG_POLL_MAX))
    while True:
        async with maker() as db:
            rows = await runlog.events_after(db, user.id, max(after, 0))
        if rows or waited >= wait:
            return RunEventsOut(
                events=[_event(e) for e in rows], last_seq=rows[-1].id if rows else max(after, 0)
            )
        await asyncio.sleep(0.6)
        waited += 0.6


# ------------------------------------------------------------------------------- controls


async def _control(db: AsyncSession, user_id: uuid.UUID, now: datetime, action: str) -> RunViewOut:
    state = await runlog.state_for(db, user_id, lock=True)
    camp = await campaign.current(db, user_id)
    prof = await campaign.get_profile(db, user_id)
    if action in ("start", "resume") and (camp is None or camp.status != "active"):
        raise ApiError(409, "not_active", "There is no running search. Set one up first.")
    if action in ("start", "resume") and camp is not None and camp.ends_at <= now:
        raise ApiError(409, "campaign_over", "This 30-day search has finished.")
    if action == "start":
        state.stopped = False
        if prof is not None and prof.paused:
            prof.paused, prof.paused_at = False, None
        kind = "run_started"
    elif action == "resume":
        state.stopped = False
        if prof is not None and prof.paused:
            prof.paused, prof.paused_at = False, None
        kind = "run_resumed"
    elif action == "pause":
        if prof is None:
            raise ApiError(422, "no_profile", "Set up your search first.")
        if not prof.paused:
            prof.paused, prof.paused_at = True, now
        kind = "run_paused"
    elif action == "stop":
        state.stopped = True
        if state.current_attempt_id is not None:
            state.command, state.command_at = "stop", now  # the one running ends at its next step
        kind = "run_stopped"
    else:  # skip: the application running now, and nothing else
        if state.current_attempt_id is None:
            raise ApiError(409, "nothing_running", "Nothing is being applied for right now.")
        state.command, state.command_at = "skip", now
        kind = ""
    if kind:
        await runlog.add(db, user_id, kind, now=now)
    state.updated_at = now
    await db.commit()
    return await _snapshot(db, user_id, now)


@router.post("/run/{action}")
async def run_control(
    action: Literal["start", "pause", "resume", "skip", "stop"],
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> RunViewOut:
    return await _control(db, user.id, now, action)


@router.put("/run/settings")
async def run_settings(
    body: RunSettingsIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> RunViewOut:
    state = await runlog.state_for(db, user.id, lock=True)
    changed: dict[str, Any] = {}
    if body.speed is not None and body.speed != state.speed:
        state.speed = changed["speed"] = body.speed
    if body.execution_mode is not None and body.execution_mode != state.execution_mode:
        state.execution_mode = changed["mode"] = body.execution_mode
    if changed:
        await runlog.add(db, user.id, "run_settings", now=now, **changed)
    await db.commit()
    return await _snapshot(db, user.id, now)


# ------------------------------------------------------------------ the desktop app's side


class RegisterIn(BaseModel):
    executor_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(default="", max_length=80)
    platform: str = Field(default="", max_length=20)
    app_version: str = Field(default="", max_length=30)


class ClaimIn(BaseModel):
    executor_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ReportIn(BaseModel):
    executor_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    events: list[dict[str, Any]] = Field(default_factory=list, max_length=60)


class DispatchIn(BaseModel):
    executor_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ResultIn(BaseModel):
    executor_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    status: Literal["confirmed", "failed", "needs_input", "handed_over", "interrupted", "ambiguous"]
    message: str = Field(default="", max_length=300)
    provider: str = Field(default="", max_length=24)
    evidence: str = Field(default="", max_length=3000)
    url: str = Field(default="", max_length=500)
    before_url: str = Field(default="", max_length=500)
    steps: int = Field(default=1, ge=1, le=20)
    documents: list[dict[str, Any]] = Field(default_factory=list, max_length=5)
    need: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    command: str = Field(default="", max_length=8)
    sent_unknown: bool = False


def _attempt_key(attempt_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(attempt_id)
    except ValueError:
        raise ApiError(404, "not_found", "Not found.") from None


def _outbox_adapters(
    form: FormAdapter, mailbox: MailboxAdapter, settings: Settings
) -> outbox.Adapters:
    return outbox.Adapters(form=form, mailbox=mailbox, settings=settings)


@router.post("/desktop/register")
async def desktop_register(
    body: RegisterIn,
    user: User = Depends(current_user),  # noqa: B008
    maker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> dict[str, Any]:
    return await desktop.register(
        maker,
        user.id,
        executor_id=body.executor_id,
        name=body.name,
        platform=body.platform,
        app_version=body.app_version,
        now=now,
    )


@router.post("/desktop/claim")
async def desktop_claim(
    body: ClaimIn,
    user: User = Depends(current_user),  # noqa: B008
    maker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
    mailbox: MailboxAdapter = Depends(get_mailbox_adapter),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> dict[str, Any]:
    job = await desktop.claim(
        maker, user.id, body.executor_id, _outbox_adapters(form, mailbox, settings), now
    )
    return {"job": job}


@router.post("/desktop/attempts/{attempt_id}/events")
async def desktop_events(
    attempt_id: str,
    body: ReportIn,
    user: User = Depends(current_user),  # noqa: B008
    maker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> dict[str, Any]:
    out = await desktop.report(
        maker, user.id, _attempt_key(attempt_id), body.executor_id, body.events, now
    )
    if out is None:
        raise ApiError(409, "not_yours", "This application is no longer yours to carry out.")
    return out


@router.post("/desktop/attempts/{attempt_id}/dispatch")
async def desktop_dispatch(
    attempt_id: str,
    body: DispatchIn,
    user: User = Depends(current_user),  # noqa: B008
    maker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    form: FormAdapter = Depends(get_form),  # noqa: B008
    mailbox: MailboxAdapter = Depends(get_mailbox_adapter),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> dict[str, Any]:
    out = await desktop.dispatch(
        maker,
        user.id,
        _attempt_key(attempt_id),
        body.executor_id,
        _outbox_adapters(form, mailbox, settings),
        now,
    )
    if out is None:
        raise ApiError(409, "not_yours", "This application is no longer yours to carry out.")
    return out


@router.post("/desktop/attempts/{attempt_id}/result")
async def desktop_result(
    attempt_id: str,
    body: ResultIn,
    user: User = Depends(current_user),  # noqa: B008
    maker: async_sessionmaker[AsyncSession] = Depends(get_sessionmaker),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> dict[str, Any]:
    state = await desktop.finish(
        maker, user.id, _attempt_key(attempt_id), body.executor_id, body.model_dump(), now
    )
    if state is None:
        raise ApiError(409, "not_yours", "This application is no longer yours to carry out.")
    return {"state": state}
