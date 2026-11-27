"""Applications carried out on the candidate's own computer, by the desktop app.

The server stays the one owner of every decision. The desktop asks for work, does the part that
needs a browser the candidate can watch, and reports back; it is never trusted to say what is
allowed:

  claim      the same claim the server's own worker makes (outbox.claim_next), made for the
             "desktop" executor. The application row is locked, the attempt has a unique key and a
             lease, so the desktop and the server can never both send it.
  events     progress while filling in the form. Each one renews the lease and is recorded; the
             answer says whether the candidate pressed skip or stop.
  dispatch   everything is checked again by the server (consent, campaign, quotas, the listing,
             the operator's switches) immediately before the submit button; only then does the
             attempt become 'dispatched' and the desktop may press it.
  result     what the page showed. A success needs the employer's own words as proof, checked here
             against what that system's confirmation looks like.

A desktop that vanishes leaves a lease that runs out, and the ordinary reconciliation then releases
or settles the attempt exactly as it does for a server worker that died."""

import base64
import hashlib
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.autoapply import ats, campaign, cvfile, outbox, runlog, switches
from app.autoapply.adapters import AdapterError, FormReceipt, FormSchema
from app.models import Application, Executor, JobPosting, SubmissionAttempt

# the checkpoints a desktop may report while filling in a form
ALLOWED_EVENTS = {
    "form_discovered",
    "field_completed",
    "document_uploaded",
    "answer_resolved",
    "step_completed",
    "application_validated",
}
MAX_EVENTS = 60  # in one report
OUTCOMES = ("confirmed", "failed", "needs_input", "handed_over", "interrupted", "ambiguous")


class DesktopForm:
    """Stands in for the form adapter when the last checks are made for a desktop attempt: what the
    checks need to know is that this one is real and which kill switch covers it."""

    name = "desktop"
    real = True

    def supports(self, application_url: str) -> bool:
        return True

    async def read_form(self, application_url: str) -> FormSchema:
        raise NotImplementedError

    async def submit(self, *args: Any, **kw: Any) -> FormReceipt:
        raise NotImplementedError

    async def find_receipt(
        self, application_url: str, *, idempotency_key: str
    ) -> FormReceipt | None:
        return None


def _adapters(adapters: outbox.Adapters) -> outbox.Adapters:
    return outbox.Adapters(form=DesktopForm(), mailbox=adapters.mailbox, settings=adapters.settings)


# ------------------------------------------------------------------------------- check in


async def register(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    *,
    executor_id: str,
    name: str,
    platform: str,
    app_version: str,
    now: datetime,
) -> dict[str, Any]:
    """The desktop says it is open. Returns what it should know: whether to work, and how."""
    async with maker() as db:
        row = (
            await db.execute(
                select(Executor).where(
                    Executor.user_id == user_id, Executor.executor_id == executor_id
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = Executor(user_id=user_id, executor_id=executor_id)
            db.add(row)
        row.name, row.platform, row.app_version, row.last_seen = (
            name[:80],
            platform[:20],
            app_version[:30],
            now,
        )
        state = await runlog.state_for(db, user_id)
        out = {
            "mode": state.execution_mode,
            "stopped": state.stopped,
            "speed": state.speed,
            "forms_here": runlog.who_runs_forms(state, True) == "desktop",
        }
        await db.commit()
        return out


# ---------------------------------------------------------------------------------- claim


def _documents(pkg: dict[str, Any]) -> dict[str, Any]:
    cv = cvfile.render_pdf(str((pkg.get("cv") or {}).get("submitted_text") or ""))
    out: dict[str, Any] = {
        "resume": {
            "name": "CV.pdf",
            "b64": base64.b64encode(cv).decode(),
            "sha256": hashlib.sha256(cv).hexdigest(),
        }
    }
    cover = str(pkg.get("cover_text") or "")
    if cover.strip():
        letter = cvfile.render_letter(cover)
        out["cover_letter"] = {
            "name": "Cover letter.pdf",
            "b64": base64.b64encode(letter).decode(),
            "sha256": hashlib.sha256(letter).hexdigest(),
        }
    return out


async def claim(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    executor_id: str,
    adapters: outbox.Adapters,
    now: datetime,
) -> dict[str, Any] | None:
    """Hand the desktop the next browser application it may carry out, or None."""
    held = await outbox.claim_next(
        maker, user_id, _adapters(adapters), now, executor="desktop", executor_id=executor_id
    )
    if held is None:
        return None
    async with maker() as db:
        attempt = await db.get(SubmissionAttempt, held.attempt_id)
        app = await db.get(Application, held.application_id)
        assert attempt is not None and app is not None
        posting = await db.get(JobPosting, app.posting_id)
        assert posting is not None
        pkg = app.package or {}
        values = {k: str(v["value"]) for k, v in (pkg.get("answers") or {}).items()}
        return {
            "attempt_id": str(attempt.id),
            "application_id": str(app.id),
            "key": attempt.idempotency_key,
            "url": posting.application_url,
            "company": posting.company,
            "title": posting.title,
            "ats": ats.detect(posting.application_url or "").key,
            "values": values,
            "answers": [
                {"field": k, "source": v.get("source")}
                for k, v in (pkg.get("answers") or {}).items()
            ],
            "documents": _documents(pkg),
            "cv_version": outbox.cv_version(pkg),
            "lease_seconds": int(runlog.LEASE.total_seconds()),
        }


# -------------------------------------------------------------------------------- the rest


async def _mine(
    db: AsyncSession,
    user_id: uuid.UUID,
    attempt_id: uuid.UUID,
    executor_id: str,
    states: tuple[str, ...],
) -> tuple[SubmissionAttempt, Application] | None:
    attempt = await db.get(SubmissionAttempt, attempt_id, with_for_update=True)
    if (
        attempt is None
        or attempt.user_id != user_id
        or attempt.executor != "desktop"
        or attempt.executor_id != executor_id
        or attempt.state not in states
    ):
        return None  # not this desktop's, or it has already ended: never acted on
    app = await db.get(Application, attempt.application_id, with_for_update=True)
    assert app is not None
    return attempt, app


async def report(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    attempt_id: uuid.UUID,
    executor_id: str,
    events: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any] | None:
    """Progress from the desktop. None when the attempt is not this desktop's any more (its lease
    ran out and the server took it back): the desktop must stop."""
    async with maker() as db:
        held = await _mine(db, user_id, attempt_id, executor_id, ("claimed", "dispatched"))
        if held is None:
            return None
        attempt, app = held
        attempt.lease_until = now + runlog.LEASE
        for e in events[:MAX_EVENTS]:
            kind = str(e.get("kind") or "")
            if kind not in ALLOWED_EVENTS:
                continue
            data: dict[str, Any] = e["data"] if isinstance(e.get("data"), dict) else {}
            await runlog.add(
                db,
                user_id,
                kind,
                application_id=app.id,
                attempt_id=attempt.id,
                executor="desktop",
                now=now,
                **{k: v for k, v in data.items() if isinstance(k, str) and k != "kind"},
            )
        await db.commit()
    command = await runlog.take_command(maker, user_id, attempt_id)
    return {"command": command}


async def dispatch(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    attempt_id: uuid.UUID,
    executor_id: str,
    adapters: outbox.Adapters,
    now: datetime,
) -> dict[str, Any] | None:
    """The last checks before the submit button. {"ok": True}, or why not (and the attempt is
    given back). None when it is not this desktop's."""
    from app.models import Campaign

    wrapped = _adapters(adapters)
    async with maker() as db:
        held = await _mine(db, user_id, attempt_id, executor_id, ("claimed",))
        if held is None:
            return None
        attempt, app = held
        posting = await db.get(JobPosting, app.posting_id)
        assert posting is not None
        camp = (
            await db.execute(
                select(Campaign).where(Campaign.user_id == user_id, Campaign.status == "active")
            )
        ).scalar_one_or_none()
        prof = await campaign.get_profile(db, user_id)
        off = await switches.active(db)
        state = await runlog.state_for(db, user_id)
        if state.stopped:
            await outbox._release(
                db, attempt, app, action="wait", reason="you stopped the run", now=now
            )
            await db.commit()
            return {"ok": False, "reason": "stopped"}
        command = state.command if state.command in runlog.COMMANDS else None
        if command:
            error = AdapterError("interrupted", command)
            await outbox.settle(db, attempt, app, "form", None, error, now)
            return {"ok": False, "reason": command}
        blocked = await outbox._precheck(
            db, adapters.settings, app, posting, camp, prof, wrapped, now, off
        )
        if blocked is not None:
            action, reason = blocked
            await outbox._release(db, attempt, app, action=action, reason=reason, now=now)
            await db.commit()
            return {"ok": False, "reason": reason}
        attempt.state, attempt.dispatched_at = "dispatched", now
        attempt.lease_until = now + runlog.LEASE
        await runlog.add(
            db,
            user_id,
            "submission_started",
            application_id=app.id,
            attempt_id=attempt.id,
            executor="desktop",
            now=now,
        )
        await db.commit()
        return {"ok": True}


async def finish(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    attempt_id: uuid.UUID,
    executor_id: str,
    outcome: dict[str, Any],
    now: datetime,
) -> str | None:
    """How it ended, as the desktop saw it. A success without the employer's own words as proof is
    not a success: it is unconfirmed, and settled like any unknown outcome (never sent again)."""
    status = str(outcome.get("status") or "")
    if status not in OUTCOMES:
        return None
    async with maker() as db:
        held = await _mine(db, user_id, attempt_id, executor_id, ("claimed", "dispatched"))
        if held is None:
            return None
        attempt, app = held
        posting = await db.get(JobPosting, app.posting_id)
        assert posting is not None
        system = ats.BY_KEY.get(str(outcome.get("provider") or ""), None) or ats.detect(
            posting.application_url or ""
        )
        message = str(outcome.get("message") or "")[:300]
        result: Any = None
        error: AdapterError | None = None
        if status == "confirmed":
            proof = ats.confirmation(
                system,
                str(outcome.get("url") or ""),
                str(outcome.get("evidence") or ""),
                str(outcome.get("before_url") or ""),
            )
            if attempt.state != "dispatched" or not proof:
                error = AdapterError(
                    "ambiguous", "The page did not show the employer's confirmation."
                )
            else:
                ref = hashlib.sha256(attempt.idempotency_key.encode()).hexdigest()[:12]
                result = FormReceipt(
                    reference=f"desktop-{ref}",
                    evidence=proof,
                    provider=system.key,
                    steps=int(outcome.get("steps") or 1),
                    documents=[
                        {
                            "name": str(d.get("name"))[:80],
                            "bytes": int(d.get("bytes") or 0),
                            "sha256": str(d.get("sha256") or "")[:64],
                        }
                        for d in (outcome.get("documents") or [])[:5]
                        if isinstance(d, dict)
                    ],
                )
        elif status == "ambiguous":
            error = AdapterError("ambiguous", message or "The outcome is not known.")
        elif status == "interrupted":
            error = AdapterError(
                "interrupted", "stop" if outcome.get("command") == "stop" else "skip"
            )
        elif status == "needs_input":
            need = [n for n in (outcome.get("need") or []) if isinstance(n, dict)][:20]
            error = AdapterError("needs_input", message or "Needs your answer.", need=need)
        elif status == "handed_over":
            return await outbox._hand_over(db, attempt, app, message or "Needs you.", now)
        else:  # failed
            error = AdapterError("rejected", message or "The form did not accept it.")
            if attempt.state == "dispatched" and outcome.get("sent_unknown"):
                error = AdapterError("ambiguous", message or "The outcome is not known.")
        return await outbox.settle(db, attempt, app, "form", result, error, now)


async def stale_leases(maker: async_sessionmaker[AsyncSession], now: datetime) -> int:
    """Desktop attempts whose desktop stopped reporting are recovered by the ordinary
    reconciliation (outbox.reconcile); this only says how many are waiting for it."""
    async with maker() as db:
        rows = (
            await db.execute(
                select(SubmissionAttempt.id).where(
                    SubmissionAttempt.executor == "desktop",
                    SubmissionAttempt.state.in_(("claimed", "dispatched")),
                    SubmissionAttempt.lease_until < now - timedelta(seconds=1),
                )
            )
        ).all()
        return len(rows)
