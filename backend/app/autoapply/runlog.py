"""The application run: what the candidate asked for, what is happening now, and what happened.

One place that every executor and every screen shares, so a control pressed on the phone is obeyed
by the desktop and by the server, and the progress shown on the web is the same progress the desktop
is showing:

* ``RunState``: stopped or not, speed, where applications may be carried out, a pending command
  (skip or stop) for the one running now, and a small picture of what is happening.
* ``RunEvent``: one row for each thing that happened, in order. It is the audit trail and what
  screens follow. It holds the question asked and the fact found, never an answer typed.
* ``Executor``: the computers the desktop app is open on, and when each last checked in.

Writing an event never changes what the caller does: it uses its own short transaction and a
failure is logged and dropped, like the platform event log."""

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.autoapply.adapters import AdapterError
from app.models import Executor, RunEvent, RunState, SubmissionAttempt

log = logging.getLogger("app.autoapply.runlog")

# What a screen shows for each kind, and the stage it moves the picture to.
KINDS: dict[str, str] = {
    "application_started": "Started an application",
    "form_discovered": "Found the application form",
    "field_completed": "Filled in a field",
    "document_uploaded": "Uploaded a document",
    "answer_resolved": "Chose an answer",
    "step_completed": "Finished a step of the form",
    "review_required": "Needs you",
    "application_validated": "Checked the form",
    "submission_started": "Pressed submit",
    "submission_verified": "Confirmed by the employer",
    "application_failed": "Failed",
    "application_paused": "Paused",
    "application_skipped": "Skipped",
    "application_cancelled": "Cancelled",
    "run_started": "Started",
    "run_paused": "Paused",
    "run_resumed": "Resumed",
    "run_stopped": "Stopped",
    "run_settings": "Settings changed",
}
STAGE = {
    "application_started": "Starting",
    "form_discovered": "Reading the form",
    "field_completed": "Filling in the form",
    "document_uploaded": "Filling in the form",
    "step_completed": "Filling in the form",
    "review_required": "Waiting for you",
    "application_validated": "Checking the form",
    "submission_started": "Submitting",
    "submission_verified": "Done",
}
# facts about a field that are shown as "the current question" only when it is a real question
CONTACT_FIELDS = {
    "name", "first_name", "last_name", "email", "phone", "linkedin", "github", "website",
    "location", "country", "current_company", "resume", "cover_letter",
}  # fmt: skip

SPEEDS = {"slow": 180, "normal": 75, "fast": 30}  # seconds between applications
MODES = ("auto", "desktop", "cloud")
DESKTOP_FRESH = timedelta(seconds=90)  # a desktop that checked in this recently is "open"
COMMANDS = ("skip", "stop")


async def state_for(db: AsyncSession, user_id: uuid.UUID, *, lock: bool = False) -> RunState:
    q = select(RunState).where(RunState.user_id == user_id)
    if lock:
        q = q.with_for_update()
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None:
        row = RunState(user_id=user_id)
        db.add(row)
        await db.flush()
    return row


async def desktop_ready(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
    """Is the candidate's desktop app open and checking in?"""
    seen = (
        await db.execute(select(func.max(Executor.last_seen)).where(Executor.user_id == user_id))
    ).scalar_one()
    return seen is not None and seen >= now - DESKTOP_FRESH


def gap_seconds(state: RunState) -> int:
    return SPEEDS.get(state.speed, SPEEDS["normal"])


def who_runs_forms(state: RunState, desktop_open: bool) -> str:
    """Where a browser form is carried out: 'desktop' or 'cloud'. Email never uses a browser."""
    if state.execution_mode == "desktop":
        return "desktop"
    if state.execution_mode == "cloud":
        return "cloud"
    return (
        "desktop" if desktop_open else "cloud"
    )  # auto: save server work when the desktop is ready


# ----------------------------------------------------------------------------------- events


def _picture(state: RunState, kind: str, data: dict[str, Any]) -> None:
    """Move the 'what is happening now' picture along with an event."""
    cur = dict(state.current or {})
    if kind == "application_started":
        cur = {
            k: data.get(k) for k in ("company", "title", "score", "ats", "cv_version", "executor")
        } | {"stage": STAGE[kind], "fields_done": 0, "fields_total": 0, "step": 1, "question": None}
        state.current_attempt_id = data.get("attempt_id")
    elif kind in ("submission_verified", "application_failed", "application_skipped",
                  "application_cancelled", "review_required"):  # fmt: skip
        cur["stage"] = {
            "submission_verified": "Done",
            "application_failed": "Failed",
            "application_skipped": "Skipped",
            "application_cancelled": "Cancelled",
            "review_required": "Waiting for you",
        }[kind]
        state.current_attempt_id = None
        state.command = None
    elif cur:
        cur["stage"] = STAGE.get(kind, cur.get("stage"))
        if kind == "form_discovered":
            cur["fields_total"] = int(data.get("fields") or 0)
            cur["ats"] = data.get("provider") or cur.get("ats")
        elif kind == "field_completed":
            cur["fields_done"] = int(cur.get("fields_done") or 0) + 1
            if data.get("field") not in CONTACT_FIELDS:
                cur["question"] = str(data.get("label") or "")[:200]
        elif kind == "step_completed":
            cur["step"] = int(data.get("step") or 1) + 1
        elif kind == "answer_resolved" and data.get("field") not in CONTACT_FIELDS:
            cur["question"] = str(data.get("label") or "")[:200]
    state.current = cur or None


async def add(
    db: AsyncSession,
    user_id: uuid.UUID,
    kind: str,
    *,
    application_id: uuid.UUID | None = None,
    attempt_id: uuid.UUID | None = None,
    executor: str = "",
    now: datetime | None = None,
    **data: Any,
) -> int:
    """Write one event inside the caller's transaction, and move the picture. Returns its number."""
    if kind not in KINDS:
        raise ValueError(f"unknown run event {kind!r}")
    clean = {k: _clean(v) for k, v in data.items() if v is not None}
    row = RunEvent(
        user_id=user_id,
        application_id=application_id,
        attempt_id=attempt_id,
        kind=kind,
        executor=executor,
        data=clean,
    )
    if now is not None:
        row.at = now
    db.add(row)
    state = await state_for(db, user_id, lock=True)
    _picture(
        state,
        kind,
        {**clean, "attempt_id": attempt_id, "executor": executor or clean.get("executor")},
    )
    state.updated_at = now or row.at or datetime.now().astimezone()
    await db.flush()
    return int(row.id)


def _clean(v: Any) -> Any:
    if isinstance(v, str):
        return v[:300]
    if isinstance(v, bool | int | float):
        return v
    if isinstance(v, list):
        return [_clean(x) for x in v[:20]]
    if isinstance(v, dict):
        return {str(k)[:40]: _clean(x) for k, x in list(v.items())[:20]}
    return str(v)[:300]


async def emit(
    maker: async_sessionmaker[AsyncSession], user_id: uuid.UUID, kind: str, **kw: Any
) -> int | None:
    """Write one event in its own transaction. Never raises."""
    try:
        async with maker() as db:
            n = await add(db, user_id, kind, **kw)
            await db.commit()
            return n
    except Exception as exc:  # noqa: BLE001 - recording progress must never stop the work
        log.warning("run event not written", extra={"fields": {"error": type(exc).__name__}})
        return None


# --------------------------------------------------------------------------------- commands


async def take_command(
    maker: async_sessionmaker[AsyncSession], user_id: uuid.UUID, attempt_id: uuid.UUID
) -> str | None:
    """The pending skip or stop for this attempt, if any. Looking does not clear it: whoever acts
    on it clears it when the attempt has actually ended (see `_picture`)."""
    async with maker() as db:
        row = (
            await db.execute(select(RunState).where(RunState.user_id == user_id))
        ).scalar_one_or_none()
        if row is None or row.command not in COMMANDS:
            return None
        if row.current_attempt_id not in (None, attempt_id):
            return None  # it was for a different attempt
        return row.command


def progress_for(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    application_id: uuid.UUID,
    attempt_id: uuid.UUID,
    executor: str,
) -> Callable[..., Awaitable[None]]:
    """The progress callback a form adapter calls at its checkpoints. Each call is recorded, and a
    skip or stop the candidate pressed ends the run at the next checkpoint, before the submit button
    is pressed. After that it cannot be taken back, so it is not looked for."""

    names = {"submitting": "submission_started", "validated": "application_validated"}

    async def progress(kind: str, **data: Any) -> None:
        await extend_lease(maker, attempt_id)  # still alive: nobody else may take it over
        event = names.get(kind, kind)
        if event in KINDS:
            await emit(
                maker,
                user_id,
                event,
                application_id=application_id,
                attempt_id=attempt_id,
                executor=executor,
                **data,
            )
        if event != "submission_started":
            command = await take_command(maker, user_id, attempt_id)
            if command:
                raise AdapterError("interrupted", command)

    return progress


LEASE = timedelta(minutes=3)  # how long an executor owns an attempt after its last sign of life


async def extend_lease(
    maker: async_sessionmaker[AsyncSession], attempt_id: uuid.UUID, now: datetime | None = None
) -> None:
    try:
        async with maker() as db:
            await db.execute(
                update(SubmissionAttempt)
                .where(
                    SubmissionAttempt.id == attempt_id,
                    SubmissionAttempt.state.in_(("claimed", "dispatched")),
                )
                .values(lease_until=(now or datetime.now().astimezone()) + LEASE)
            )
            await db.commit()
    except Exception as exc:  # noqa: BLE001 - a missed renewal only makes recovery earlier
        log.warning("lease not renewed", extra={"fields": {"error": type(exc).__name__}})


# ----------------------------------------------------------------------------------- reading


async def events_after(
    db: AsyncSession, user_id: uuid.UUID, after: int, limit: int = 100
) -> list[RunEvent]:
    rows = (
        (
            await db.execute(
                select(RunEvent)
                .where(RunEvent.user_id == user_id, RunEvent.id > after)
                .order_by(RunEvent.id)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def latest(db: AsyncSession, user_id: uuid.UUID, limit: int = 40) -> list[RunEvent]:
    rows = (
        (
            await db.execute(
                select(RunEvent)
                .where(RunEvent.user_id == user_id)
                .order_by(RunEvent.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(reversed(rows))
