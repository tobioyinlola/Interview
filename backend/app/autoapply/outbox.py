"""Sending applications, safely.

The rules that make this safe:
  * one claim at a time per candidate (the campaign row is locked), so two workers never both
    take the same application or both use the last of the daily quota;
  * every attempt has a unique key, so the same intent is never dispatched twice;
  * everything is checked again immediately before dispatch, so a pause, a disconnect, a changed
    search or the end of the campaign stops work that has not started;
  * the attempt is written as 'dispatched' BEFORE the outside call, so a crash leaves an attempt
    whose outcome is unknown rather than one that looks unsent;
  * an unknown outcome is settled by looking for evidence (a receipt, the sent message), never by
    sending again, and a form is never retried by email."""

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.autoapply import campaign, clock, cvfile, mailbox, pipeline
from app.autoapply.adapters import (
    AdapterError,
    FormAdapter,
    MailAttachment,
    MailboxAdapter,
)
from app.config import Settings
from app.models import (
    Application,
    Campaign,
    JobPosting,
    SearchProfile,
    SubmissionAttempt,
    User,
)
from app.services.events import record_from

log = logging.getLogger("app.autoapply.outbox")
UNRESOLVED = ("claimed", "dispatched", "ambiguous")
MAX_TRANSIENT_RETRIES = 5
RECONCILE_DELAY = timedelta(seconds=60)  # sent mail takes a moment to show up when searched for
DISPATCH_GRACE = timedelta(minutes=2)  # a 'dispatched' attempt with no result after this is unknown


@dataclass
class Adapters:
    form: FormAdapter
    mailbox: MailboxAdapter
    settings: Settings


def dispatch_allowed(settings: Settings, channel: str, real: bool, recipient: str | None) -> bool:
    """Real submissions are off unless the matching switch is on. Outside production a real
    mailbox may only write to allowlisted recipients, so staging can never reach an employer."""
    if not real:
        return True  # fixtures have no outside effect
    switch = {
        "form": settings.autoapply_form_dispatch,
        "email": settings.autoapply_email_dispatch,
        "outreach": settings.autoapply_outreach_dispatch,
    }[channel]
    if not switch:
        return False
    if settings.environment == "production":
        return True
    allowed = {a.strip().lower() for a in settings.autoapply_allowed_recipients.split(",") if a}
    return bool(recipient) and (recipient or "").lower() in allowed


async def used_today(
    db: AsyncSession, user_id: uuid.UUID, channels: tuple[str, ...], day: Any
) -> int:
    """Attempts that count against today's limit: anything unresolved (whatever day it began),
    and what was confirmed today. Definite failures and cancelled claims are released."""
    rows = (
        await db.execute(
            select(SubmissionAttempt.state, SubmissionAttempt.local_day).where(
                SubmissionAttempt.user_id == user_id, SubmissionAttempt.channel.in_(channels)
            )
        )
    ).all()
    return sum(1 for st, d in rows if st in UNRESOLVED or (st == "confirmed" and d == day))


def email_subject(posting: JobPosting) -> str:
    """The listing's own subject-line instruction when it has one, else a plain default."""
    m = re.search(
        r"subject(?: line)?\s*[:\-]\s*[\"“]?([^\n\"”]{3,150})", posting.apply_instructions, re.I
    )
    if m:
        return m.group(1).strip().replace("{title}", posting.title)
    ref = f" ({posting.requisition_id})" if posting.requisition_id else ""
    return f"Application: {posting.title}{ref}"


def message_id(attempt_key: str) -> str:
    """The Message-ID of a send, derived from the attempt so the message can always be found."""
    return f"{re.sub(r'[^A-Za-z0-9.-]', '', attempt_key)}@interviewmeet.app"


async def outreach_settled(db: AsyncSession, attempt: SubmissionAttempt, outcome: str) -> None:
    """Tell the outreach record what became of its attempt (kept here to avoid a cycle)."""
    from app.autoapply import outreach

    await outreach.settled(db, attempt, outcome)


@dataclass
class Claim:
    attempt_id: uuid.UUID
    application_id: uuid.UUID
    channel: str


async def _precheck(
    db: AsyncSession,
    settings: Settings,
    app: Application,
    posting: JobPosting,
    camp: Campaign | None,
    prof: SearchProfile | None,
    adapters: Adapters,
    now: datetime,
) -> tuple[str, str] | None:
    """Why this must not go out now, as (action, reason): 'wait' keeps it queued, 'recheck'
    judges it again, 'skip' gives it up. None means all clear. Used at claim time and again just
    before dispatch."""
    channel = app.channel or ""
    if not campaign.outbound_open(camp, prof, now):
        reason = "paused" if prof is not None and prof.paused else "the 30-day search is over"
        return ("wait" if prof is not None and prof.paused else "skip", reason)
    assert camp is not None and prof is not None
    if not clock.within_active_hours(now, camp.timezone, prof.active_hours):
        return "wait", "outside your active hours"
    if not (prof.channels or {}).get(channel):
        return "recheck", f"the {channel} channel was switched off"
    if app.profile_version != prof.version:
        return "recheck", "your search changed after this was prepared"
    if posting.expires_at is not None and posting.expires_at <= now:
        return "skip", "the listing expired"
    pkg = app.package or {}
    dest = pkg.get("destination", {})
    if channel == "form":
        if dest.get("url") != posting.application_url:
            return "recheck", "the application address changed"
        if not dispatch_allowed(settings, "form", adapters.form.real, None):
            return "wait", "form submission is switched off"
    elif channel == "email":
        if dest.get("to") != posting.apply_email:
            return "recheck", "the application address changed"
        conn = await mailbox.get(db, app.user_id)
        if conn is None or conn.status != "connected" or not conn.token_encrypted:
            return "wait", "your mailbox is not connected"
        if not dispatch_allowed(settings, "email", adapters.mailbox.real, dest.get("to")):
            return "wait", "email sending is switched off"
    return None


async def claim_next(
    maker: async_sessionmaker[AsyncSession], user_id: uuid.UUID, adapters: Adapters, now: datetime
) -> Claim | None:
    """Take the next application that may go out for this candidate, or None. Everything here
    happens under a lock on the candidate's campaign, so claims are one at a time."""
    async with maker() as db:
        camp = (
            await db.execute(
                select(Campaign)
                .where(Campaign.user_id == user_id, Campaign.status == "active")
                .with_for_update()
            )
        ).scalar_one_or_none()
        prof = await campaign.get_profile(db, user_id)
        if camp is None or prof is None or not campaign.outbound_open(camp, prof, now):
            await db.rollback()
            return None
        day = clock.local_day(now, camp.timezone)
        if await used_today(db, user_id, ("form", "email"), day) >= prof.daily_application_cap:
            await db.rollback()
            return None
        rows = (
            await db.execute(
                select(Application, JobPosting)
                .join(JobPosting, JobPosting.id == Application.posting_id)
                .where(
                    Application.user_id == user_id,
                    Application.status == "queued",
                    (Application.not_before.is_(None)) | (Application.not_before <= now),
                )
                .order_by(Application.score.desc(), Application.created_at)
                .with_for_update(of=Application, skip_locked=True)
                .limit(10)
            )
        ).all()
        for app, posting in rows:
            blocked = await _precheck(
                db, adapters.settings, app, posting, camp, prof, adapters, now
            )
            if blocked is not None:
                continue  # this one cannot go now; another might
            n = (
                await db.execute(
                    select(SubmissionAttempt.id).where(SubmissionAttempt.application_id == app.id)
                )
            ).all()
            attempt = SubmissionAttempt(
                user_id=user_id,
                application_id=app.id,
                channel=app.channel or "form",
                idempotency_key=f"{app.id}:{app.channel}:{len(n) + 1}",
                state="claimed",
                local_day=day,
                claimed_at=now,
            )
            db.add(attempt)
            app.status = "sending"
            await pipeline.log(db, app, "sending", channel=app.channel)
            await db.commit()
            return Claim(attempt.id, app.id, app.channel or "form")
        await db.rollback()
        return None


async def _release(
    db: AsyncSession,
    attempt: SubmissionAttempt,
    app: Application,
    *,
    action: str,
    reason: str,
    now: datetime,
    not_before: datetime | None = None,
    transient: bool = False,
) -> None:
    """Give a claimed attempt back. It never reached the outside world, so it costs no quota."""
    attempt.state, attempt.finished_at = "cancelled", now
    attempt.failure_class = "transient" if transient else action
    attempt.failure_message = reason[:300]
    if action == "skip":
        app.status, app.skip_reason = "skipped", reason[:1].upper() + reason[1:] + "."
    else:
        app.status = "queued"
        app.not_before = not_before
    await pipeline.log(db, app, "held_back", reason=reason, action=action)


async def execute(
    maker: async_sessionmaker[AsyncSession], claim: Claim, adapters: Adapters, now: datetime
) -> str:
    """Carry out a claimed attempt: check again, mark it dispatched, send, record what happened.
    Returns the attempt's resulting state."""
    settings = adapters.settings
    # --- final check, then the point of no return
    async with maker() as db:
        attempt = await db.get(SubmissionAttempt, claim.attempt_id, with_for_update=True)
        app = await db.get(Application, claim.application_id, with_for_update=True)
        assert attempt is not None and app is not None
        posting = await db.get(JobPosting, app.posting_id)
        assert posting is not None
        camp = (
            await db.execute(
                select(Campaign).where(Campaign.user_id == app.user_id, Campaign.status == "active")
            )
        ).scalar_one_or_none()
        prof = await campaign.get_profile(db, app.user_id)
        blocked = await _precheck(db, settings, app, posting, camp, prof, adapters, now)
        if blocked is not None:
            action, reason = blocked
            await _release(db, attempt, app, action=action, reason=reason, now=now)
            await db.commit()
            return "cancelled"
        pkg = app.package or {}
        user = await db.get(User, app.user_id)
        assert user is not None
        sender_conn = await mailbox.get(db, app.user_id) if claim.channel == "email" else None
        token = mailbox.token(settings, sender_conn) if sender_conn else ""
        sender_addr = sender_conn.address if sender_conn else ""
        if claim.channel == "form":
            try:
                schema = await adapters.form.read_form(posting.application_url or "")
            except AdapterError as exc:
                return await _transient(db, attempt, app, exc, now)
            problem = form_problem(schema, pkg)
            if problem is not None:
                await _release(
                    db, attempt, app, action="recheck", reason="the form changed", now=now
                )
                app.status, app.needs_input = "needs_input", problem
                await pipeline.log(db, app, "needs_input", reason="the form changed")
                await db.commit()
                return "cancelled"
        attempt.state, attempt.dispatched_at = "dispatched", now
        key = attempt.idempotency_key
        await db.commit()
    # --- the outside call (no database transaction is open)
    cv_text = pkg["cv"]["submitted_text"]
    result: Any = None
    error: AdapterError | None = None
    try:
        if claim.channel == "form":
            values = {k: v["value"] for k, v in pkg.get("answers", {}).items()}
            values.setdefault("cover_letter", pkg.get("cover_text", ""))
            result = await adapters.form.submit(
                posting.application_url or "",
                idempotency_key=key,
                values=values,
                cv_text=cv_text,
                cv_filename="CV.pdf",
            )
        else:
            result = await adapters.mailbox.send(
                token,
                sender=sender_addr,
                to=pkg["destination"]["to"],
                subject=email_subject(posting),
                body=pkg.get("cover_text", ""),
                attachments=[MailAttachment("CV.pdf", cvfile.render_pdf(cv_text))],
                message_id=message_id(key),
            )
    except AdapterError as exc:
        error = exc
    except Exception as exc:  # noqa: BLE001 - an unexpected failure after dispatch is "unknown"
        log.warning("dispatch crashed", extra={"fields": {"error": type(exc).__name__}})
        error = AdapterError("ambiguous", "The send did not finish cleanly.")
    return await _record(maker, claim, result, error, now)


def form_problem(schema: Any, pkg: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Questions the live form asks that the package cannot answer, or None if all is well."""
    answers = pkg.get("answers", {})
    missing: list[dict[str, Any]] = []
    for f in schema.fields:
        if f.kind in ("captcha",) or (f.kind == "file" and f.name not in ("resume", "cv")):
            missing.append(
                {
                    "kind": "unsupported",
                    "field": f.name,
                    "question": f.label,
                    "reason": f"This form has a {f.kind} step that cannot be done automatically.",
                }
            )
        elif f.kind != "file" and f.required and f.name not in answers and f.name != "cover_letter":
            missing.append(
                {
                    "kind": "declaration" if f.kind == "declaration" else "answer",
                    "field": f.name,
                    "question": f.label,
                    "reason": "The form now asks this and you have not answered it.",
                }
            )
    return missing or None


async def _transient(
    db: AsyncSession, attempt: SubmissionAttempt, app: Application, exc: AdapterError, now: datetime
) -> str:
    """A failure before anything was sent. Try again later, with growing waits, a few times."""
    prior = (
        await db.execute(
            select(SubmissionAttempt.id).where(
                SubmissionAttempt.application_id == app.id,
                SubmissionAttempt.failure_class == "transient",
            )
        )
    ).all()
    if len(prior) + 1 >= MAX_TRANSIENT_RETRIES or not exc.transient:
        attempt.state, attempt.finished_at = "failed", now
        attempt.failure_class, attempt.failure_message = exc.code, exc.message
        app.status = "failed"
        await pipeline.log(db, app, "failed", reason=exc.message)
        await db.commit()
        await record_from(db, "autoapply.application_failed", user_id=app.user_id, reason=exc.code)
        return "failed"
    wait = timedelta(minutes=min(2 ** len(prior), 60))
    await _release(
        db,
        attempt,
        app,
        action="wait",
        reason=exc.message,
        now=now,
        not_before=now + wait,
        transient=True,
    )
    await db.commit()
    return "cancelled"


async def _record(
    maker: async_sessionmaker[AsyncSession],
    claim: Claim,
    result: Any,
    error: AdapterError | None,
    now: datetime,
) -> str:
    async with maker() as db:
        attempt = await db.get(SubmissionAttempt, claim.attempt_id, with_for_update=True)
        app = await db.get(Application, claim.application_id, with_for_update=True)
        assert attempt is not None and app is not None
        if error is None:
            attempt.state, attempt.finished_at = "confirmed", now
            if claim.channel == "form":
                attempt.provider_ref = result.reference
                attempt.receipt = {"reference": result.reference, "evidence": result.evidence[:300]}
                app.status = "submitted"
            else:
                attempt.provider_ref, attempt.thread_ref = result.message_id, result.thread_id
                app.status = "sent_email"
            await pipeline.log(
                db, app, app.status, channel=claim.channel, reference=attempt.provider_ref
            )
            await db.commit()
            await record_from(
                db, "autoapply.application_sent", user_id=app.user_id, channel=claim.channel
            )
            return "confirmed"
        if error.code == "ambiguous":
            attempt.state = "ambiguous"
            attempt.failure_class, attempt.failure_message = "ambiguous", error.message
            app.status = "confirmation_pending"
            await pipeline.log(db, app, "confirmation_pending", reason=error.message)
            await db.commit()
            return "ambiguous"
        if error.code == "reauth":
            conn = await mailbox.get(db, app.user_id)
            if conn is not None:
                await mailbox.mark_reauth(db, conn)
            attempt.state, attempt.finished_at, attempt.failure_class = "cancelled", now, "reauth"
            app.status = "queued"
            await pipeline.log(db, app, "held_back", reason="your mailbox needs to be reconnected")
            await db.commit()
            return "cancelled"
        return await _transient(db, attempt, app, error, now)


async def reconcile(
    maker: async_sessionmaker[AsyncSession], adapters: Adapters, now: datetime
) -> dict[str, int]:
    """Settle attempts whose outcome is unknown, and recover work a dead worker left behind."""
    settings = adapters.settings
    stats = {"confirmed": 0, "still_unknown": 0, "released": 0, "asked": 0}
    async with maker() as db:
        # a claim never dispatched: the worker died before sending, so it is safe to give back
        stale = (
            (
                await db.execute(
                    select(SubmissionAttempt).where(
                        SubmissionAttempt.state == "claimed",
                        SubmissionAttempt.claimed_at
                        < now - timedelta(minutes=settings.autoapply_claim_timeout_minutes),
                    )
                )
            )
            .scalars()
            .all()
        )
        for a in stale:
            app = await db.get(Application, a.application_id)
            assert app is not None
            await _release(
                db, a, app, action="wait", reason="the worker stopped", now=now, transient=True
            )
            stats["released"] += 1
        # dispatched, no result: the call may or may not have happened
        crashed = (
            (
                await db.execute(
                    select(SubmissionAttempt).where(
                        SubmissionAttempt.state == "dispatched",
                        SubmissionAttempt.dispatched_at < now - DISPATCH_GRACE,
                    )
                )
            )
            .scalars()
            .all()
        )
        for a in crashed:
            a.state = "ambiguous"
            app = await db.get(Application, a.application_id)
            assert app is not None
            if a.channel != "outreach":
                app.status = "confirmation_pending"
        await db.commit()
    async with maker() as db:
        pending = (
            (
                await db.execute(
                    select(SubmissionAttempt).where(SubmissionAttempt.state == "ambiguous")
                )
            )
            .scalars()
            .all()
        )
        for a in pending:
            app = await db.get(Application, a.application_id)
            assert app is not None
            posting = await db.get(JobPosting, app.posting_id)
            assert posting is not None
            if now - (a.dispatched_at or a.claimed_at) < RECONCILE_DELAY:
                stats["still_unknown"] += 1
                continue
            found = await _look_for_evidence(db, adapters, a, posting)
            if found:
                a.state, a.finished_at = "confirmed", now
                if a.channel == "outreach":
                    a.provider_ref, a.thread_ref = found["ref"], found.get("thread")
                    await outreach_settled(db, a, "sent")
                elif a.channel == "form":
                    a.provider_ref, a.receipt = (
                        found["ref"],
                        {"reference": found["ref"], "found_later": True},
                    )
                    app.status = "submitted"
                else:
                    a.provider_ref, a.thread_ref = found["ref"], found.get("thread")
                    app.status = "sent_email"
                await pipeline.log(db, app, "confirmed_later", channel=a.channel)
                stats["confirmed"] += 1
            elif now - (a.dispatched_at or a.claimed_at) > timedelta(
                hours=settings.autoapply_reconcile_hours
            ):
                if not any(n.get("kind") == "confirm" for n in app.needs_input or []):
                    app.needs_input = [
                        {
                            "kind": "confirm",
                            "field": "confirm",
                            "question": "Did this application go through?",
                            "reason": "We could not confirm it. Check your email or the employer's "
                            "site, then tell us.",
                        }
                    ]
                    await pipeline.log(db, app, "needs_input", reason="could not confirm")
                    stats["asked"] += 1
                stats["still_unknown"] += 1
            else:
                stats["still_unknown"] += 1
        await db.commit()
    return stats


async def _look_for_evidence(
    db: AsyncSession, adapters: Adapters, a: SubmissionAttempt, posting: JobPosting
) -> dict[str, str] | None:
    try:
        if a.channel == "form":
            r = await adapters.form.find_receipt(
                posting.application_url or "", idempotency_key=a.idempotency_key
            )
            return {"ref": r.reference} if r else None
        conn = await mailbox.get(db, a.user_id)
        if conn is None or conn.status != "connected":
            return None
        sent = await adapters.mailbox.find_sent(
            mailbox.token(adapters.settings, conn), message_id(a.idempotency_key)
        )
        return {"ref": sent.message_id, "thread": sent.thread_id or ""} if sent else None
    except AdapterError:
        return None  # cannot look right now; try again on the next pass


async def resolve_by_candidate(
    db: AsyncSession, app: Application, *, sent: bool, now: datetime
) -> None:
    """The candidate says what really happened to an application we could not confirm."""
    attempt = (
        (
            await db.execute(
                select(SubmissionAttempt)
                .where(
                    SubmissionAttempt.application_id == app.id,
                    SubmissionAttempt.state == "ambiguous",
                )
                .order_by(SubmissionAttempt.claimed_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if attempt is None:
        return
    attempt.finished_at = now
    app.needs_input = []
    if sent:
        attempt.state = "confirmed"
        app.status = "sent_email" if attempt.channel == "email" else "submitted"
        await pipeline.log(db, app, "confirmed_by_you", channel=attempt.channel)
    else:
        attempt.state, attempt.failure_class = "failed", "reported_not_sent"
        app.status = "queued"  # only now may it be sent again, as a new attempt
        await pipeline.log(db, app, "retry_allowed", reason="you said it did not go through")
    await db.commit()


async def expire_unsent(maker: async_sessionmaker[AsyncSession], now: datetime) -> int:
    """When a campaign ends, applications still waiting to go out are given up, not left queued."""
    async with maker() as db:
        rows = (
            (
                await db.execute(
                    select(Application)
                    .join(Campaign, Campaign.id == Application.campaign_id)
                    .where(
                        Campaign.status == "ended",
                        Application.status.in_(("queued", "needs_input", "discovered", "eligible")),
                    )
                )
            )
            .scalars()
            .all()
        )
        for app in rows:
            app.status = "skipped"
            app.skip_reason = "The 30-day search ended before this went out."
            app.needs_input = []
            await pipeline.log(db, app, "skipped", reason="campaign ended")
        await db.commit()
        return len(rows)


async def dispatch_user(
    maker: async_sessionmaker[AsyncSession], user_id: uuid.UUID, adapters: Adapters, now: datetime
) -> int:
    """Send everything that may go out now for one candidate, within their limits."""
    sent = 0
    while True:
        claim = await claim_next(maker, user_id, adapters, now)
        if claim is None:
            return sent
        state = await execute(maker, claim, adapters, now)
        sent += state in ("confirmed", "ambiguous")
        if state == "cancelled":
            return sent  # something held it back; try again on the next pass
