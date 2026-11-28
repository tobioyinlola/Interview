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

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import metrics
from app.autoapply import answers as answers_mod
from app.autoapply import ats, campaign, clock, cvfile, mailbox, pipeline, runlog, switches
from app.autoapply.adapters import (
    AdapterError,
    FormAdapter,
    MailAttachment,
    MailboxAdapter,
)
from app.autoapply.browserform import pick
from app.autoapply.postings import apply_to
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
    llm: Any = None  # writes answers to questions only the live form asks (optional)


def dispatch_allowed(settings: Settings, channel: str, real: bool, recipient: str | None) -> bool:
    """Real submissions are off unless the matching switch is on. Outside production a real
    mailbox may only write to allowlisted recipients, so staging can never reach an employer."""
    if not real:
        return True  # fixtures have no outside effect
    switch = {
        "form": settings.autoapply_form_dispatch,
        "email": settings.autoapply_email_dispatch,
        "outreach": settings.autoapply_outreach_dispatch,
        "hunt": settings.startup_outreach_dispatch,
    }[channel]
    if not switch:
        return False
    if settings.environment == "production":
        return True
    if channel == "hunt" and settings.startup_outreach_any_recipient:
        return True  # the operator said this server may write to real startups
    allowed = {a.strip().lower() for a in settings.autoapply_allowed_recipients.split(",") if a}
    # an application may go to several addresses at once ("a@x.io, b@y.io"): each must be listed
    to = [r.strip().lower() for r in (recipient or "").split(",") if r.strip()]
    return bool(to) and all(r in allowed for r in to)


async def used_today(
    db: AsyncSession, user_id: uuid.UUID, channels: tuple[str, ...], day: Any
) -> int:
    """Attempts that count against today's limit: what is in progress now, and what was confirmed
    or may have gone (unclear) today. Definite failures and cancelled claims are released, and an
    unclear one from an earlier day no longer holds today's limit (it is still never sent again)."""
    rows = (
        await db.execute(
            select(SubmissionAttempt.state, SubmissionAttempt.local_day).where(
                SubmissionAttempt.user_id == user_id, SubmissionAttempt.channel.in_(channels)
            )
        )
    ).all()
    return sum(
        1
        for st, d in rows
        if st in ("claimed", "dispatched") or (st in ("confirmed", "ambiguous") and d == day)
    )


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
    off: set[str] | None = None,
) -> tuple[str, str] | None:
    """Why this must not go out now, as (action, reason): 'wait' keeps it queued, 'recheck'
    judges it again, 'skip' gives it up. None means all clear. Used at claim time and again just
    before dispatch."""
    channel = app.channel or ""
    names = (adapters.form.name,) if channel == "form" else (adapters.mailbox.name,)
    if (why := switches.blocked(off or set(), channel, *names)) is not None:
        return "wait", why
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
        if dest.get("to") != apply_to(posting):
            return "recheck", "the application address changed"
        conn = await mailbox.get(db, app.user_id)
        if conn is None or conn.status != "connected" or not conn.token_encrypted:
            return "wait", "your mailbox is not connected"
        if not dispatch_allowed(settings, "email", adapters.mailbox.real, dest.get("to")):
            return "wait", "email sending is switched off"
    return None


def cv_version(pkg: dict[str, Any]) -> str:
    """Which CV this is: the facts it was made from and a checksum of its exact words."""
    cv = pkg.get("cv") or {}
    digest = hashlib.sha256(str(cv.get("submitted_text") or "").encode()).hexdigest()[:8]
    return f"v{cv.get('facts_version', 0)}-{digest}"


async def claim_next(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    adapters: Adapters,
    now: datetime,
    *,
    executor: str = "cloud",
    executor_id: str | None = None,
) -> Claim | None:
    """Take the next application that may go out for this candidate, or None. Everything here
    happens under a lock on the candidate's campaign, so claims are one at a time.

    `executor` says who will carry it out: this server's worker or the candidate's desktop. An
    application is only ever handed to the executor the candidate's settings name for its channel,
    and the claim is the single point where it changes hands (the row is locked, the attempt has a
    unique key and a lease), so the desktop and the server can never both send it."""
    async with maker() as db:
        camp = (
            await db.execute(
                select(Campaign)
                .where(Campaign.user_id == user_id, Campaign.status == "active")
                .with_for_update()
            )
        ).scalar_one_or_none()
        prof = await campaign.get_profile(db, user_id)
        off = await switches.active(db)
        if (
            "global" in off
            or camp is None
            or prof is None
            or not campaign.outbound_open(camp, prof, now)
        ):
            await db.rollback()
            return None
        day = clock.local_day(now, camp.timezone)
        if await used_today(db, user_id, ("form", "email"), day) >= prof.daily_application_cap:
            await db.rollback()
            return None
        state = await runlog.state_for(db, user_id, lock=True)
        if state.stopped:  # the candidate pressed stop: nothing starts until they start again
            await db.rollback()
            return None
        desk_open = await runlog.desktop_ready(db, user_id, now)
        runner = runlog.who_runs_forms(state, desk_open)
        # spacing between browser applications: the speed they chose, never faster than that
        last_form = (
            await db.execute(
                select(func.max(SubmissionAttempt.claimed_at)).where(
                    SubmissionAttempt.user_id == user_id,
                    SubmissionAttempt.channel == "form",
                    SubmissionAttempt.state != "cancelled",  # nothing was sent: no gap needed
                )
            )
        ).scalar_one()
        too_soon = (
            (executor == "desktop" or adapters.form.real)
            and last_form is not None
            and now - last_form < timedelta(seconds=runlog.gap_seconds(state))
        )
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
        moved = False
        for app, posting in rows:
            is_form = (app.channel or "form") == "form"
            if executor == "desktop" and not is_form:
                continue  # only browser forms are carried out on a computer
            if is_form and waiting_for_desktop(app):
                if now - _desktop_wait_since(app) > DESKTOP_WAIT:
                    await _give_up_waiting(db, app)  # their computer was not open in time
                    moved = True
                    continue
            wants = runner
            if is_form and state.execution_mode != "cloud":
                # a human check was met (or this system nearly always has one): only a person at
                # their own computer can pass it, so it waits for the desktop, which carries it out
                if waiting_for_desktop(app) or (
                    desk_open and ats.detect(posting.application_url or "").captcha_likely
                ):
                    wants = "desktop"
            if is_form and (wants != executor or too_soon):
                continue  # another executor's, or not yet (speed)
            blocked = await _precheck(
                db, adapters.settings, app, posting, camp, prof, adapters, now, off
            )
            if blocked == ("skip", "the listing expired"):
                # its end date passed while it waited: it is no longer "ready to send"
                app.status, app.skip_reason = "expired", "The listing expired."
                await pipeline.log(db, app, "expired", reason="the listing expired")
                moved = True
                continue
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
                executor=executor,
                executor_id=executor_id,
                lease_until=now
                + timedelta(minutes=adapters.settings.autoapply_claim_timeout_minutes),
            )
            db.add(attempt)
            app.status = "sending"
            await pipeline.log(db, app, "sending", channel=app.channel)
            await db.flush()
            await runlog.add(
                db,
                user_id,
                "application_started",
                application_id=app.id,
                attempt_id=attempt.id,
                executor=executor,
                now=now,
                company=posting.company,
                title=posting.title,
                score=_fit_fraction(app),
                ats=ats.detect(posting.application_url or "").key if is_form else "email",
                cv_version=cv_version(app.package or {}),
            )
            await db.commit()
            return Claim(attempt.id, app.id, app.channel or "form")
        if moved:
            await db.commit()
        else:
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
        app.status = "expired" if reason == "the listing expired" else "skipped"
        app.skip_reason = reason[:1].upper() + reason[1:] + "."
    else:
        app.status = "queued"
        app.not_before = not_before
    await pipeline.log(db, app, "held_back", reason=reason, action=action)
    await _event(
        db,
        attempt,
        app,
        {"skip": "application_skipped", "wait": "application_paused"}.get(
            action, "application_cancelled"
        ),
        now,
        reason=reason,
    )


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
        off = await switches.active(
            db
        )  # read again: an operator may have flipped one since the claim
        blocked = await _precheck(db, settings, app, posting, camp, prof, adapters, now, off)
        if blocked is not None:
            action, reason = blocked
            await _release(db, attempt, app, action=action, reason=reason, now=now)
            await db.commit()
            return "cancelled"
        pkg = app.package or {}
        state_mode = (await runlog.state_for(db, app.user_id)).execution_mode
        user = await db.get(User, app.user_id)
        assert user is not None
        sender_conn = await mailbox.get(db, app.user_id) if claim.channel == "email" else None
        token = mailbox.token(settings, sender_conn) if sender_conn else ""
        sender_addr = sender_conn.address if sender_conn else ""
        extra: dict[str, Any] = {}
        if claim.channel == "form":
            try:
                schema = await adapters.form.read_form(posting.application_url or "")
            except AdapterError as exc:
                if exc.code == "rejected" and not exc.transient:
                    if "human check" in exc.message.lower():
                        return await _to_desktop(db, attempt, app, state_mode, now)
                    # no form, a sign-in wall: not a failure, and nothing was sent. The
                    # application is already prepared, so it goes to the person.
                    return await _hand_over(db, attempt, app, exc.message, now)
                return await _transient(db, attempt, app, exc, now)
            # everything on file now, and answers written from the CV for the rest (never a legal
            # statement), so a question the live form adds does not stop the application
            known, facts = await answers_mod.on_file(db, app.user_id, now)
            extra = {k: v for k, v in known.items() if k not in (pkg.get("answers") or {})}
            problem = form_problem(schema, pkg, extra)
            if problem is not None and adapters.llm is not None:
                drafted = await answers_mod.draft(
                    adapters.llm,
                    [p for p in problem if p["kind"] != "unsupported"],
                    facts=facts,
                    cv_text=str((pkg.get("cv") or {}).get("submitted_text") or ""),
                    saved=known,
                    job={
                        "title": posting.title,
                        "company": posting.company,
                        "description": posting.description,
                    },
                )
                for field, value in drafted.items():
                    extra[field] = {"value": value, "source": "written from your CV"}
                problem = form_problem(schema, pkg, extra)
            if any(f.kind == "captcha" for f in schema.fields):
                return await _to_desktop(db, attempt, app, state_mode, now)
            if problem is not None and all(p["kind"] == "unsupported" for p in problem):
                why = problem[0][
                    "reason"
                ]  # nothing the person can answer here: a step only they can do
                return await _hand_over(db, attempt, app, why, now)
            if problem is not None:
                metrics.autoapply_form_changed.inc()
                await _release(
                    db, attempt, app, action="recheck", reason="the form changed", now=now
                )
                app.status, app.needs_input = "needs_input", problem
                await pipeline.log(db, app, "needs_input", reason="the form changed")
                await db.commit()
                return "cancelled"
        attempt.state, attempt.dispatched_at = "dispatched", now
        attempt.lease_until = now + DISPATCH_GRACE  # progress reports renew it while it is alive
        key = attempt.idempotency_key
        claim_user = app.user_id
        await db.commit()
    # --- the outside call (no database transaction is open)
    cv_text = pkg["cv"]["submitted_text"]
    result: Any = None
    error: AdapterError | None = None
    try:
        if claim.channel == "form":
            values = {k: v["value"] for k, v in pkg.get("answers", {}).items()}
            for k, v in extra.items():
                values[k] = v["value"]  # on file now, or put into the form's own words
            values.setdefault("cover_letter", pkg.get("cover_text", ""))
            progress = runlog.progress_for(
                maker, claim_user, claim.application_id, claim.attempt_id, "cloud"
            )
            for name, a in (pkg.get("answers") or {}).items():
                await progress("answer_resolved", field=name, label=name, source=a.get("source"))
            result = await adapters.form.submit(
                posting.application_url or "",
                idempotency_key=key,
                values=values,
                cv_text=cv_text,
                cv_filename="CV.pdf",
                progress=progress,
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


def form_problem(
    schema: Any, pkg: dict[str, Any], extra: dict[str, Any] | None = None
) -> list[dict[str, Any]] | None:
    """Questions the live form asks that the package (and what else is on file) cannot answer, or
    None if all is well."""
    answers = {**pkg.get("answers", {}), **(extra or {})}  # extra: on file now, or rewritten
    missing: list[dict[str, Any]] = []
    for f in schema.fields:
        if f.kind == "captcha" or (
            f.kind == "file" and f.required and f.name not in ("resume", "cv", "cover_letter")
        ):
            missing.append(
                {
                    "kind": "unsupported",
                    "field": f.name,
                    "question": f.label,
                    "reason": f"This form has a {f.kind} step that cannot be done automatically.",
                }
            )
        elif (
            f.kind != "file"
            and f.required
            and f.name != "cover_letter"
            and (
                f.name not in answers
                or (f.options and pick(list(f.options), str(answers[f.name]["value"])) is None)
            )
        ):
            need: dict[str, Any] = {
                "kind": "declaration" if f.kind == "declaration" else "answer",
                "field": f.name,
                "question": f.label,
                "reason": "The form now asks this and you have not answered it.",
            }
            if f.options:
                need["options"] = list(f.options)
            missing.append(need)
    return missing or None


def _fit_fraction(app: Application) -> float | None:
    """How good a fit, 0 to 1, for the run panel: only the fit score (0 to 100) says that. The
    ranking number the queue sorts by is not a percentage and is never shown as one."""
    fit = ((app.match or {}).get("fit") or {}).get("score")
    return (
        round(max(0.0, min(float(fit), 100.0)) / 100, 2) if isinstance(fit, int | float) else None
    )


DESKTOP_WAIT = timedelta(hours=24)  # how long a job waits for the candidate's computer to be open


def waiting_for_desktop(app: Application) -> bool:
    return bool((app.match or {}).get("needs_desktop"))


def _desktop_wait_since(app: Application) -> datetime:
    raw = (app.match or {}).get("needs_desktop_at")
    try:
        return datetime.fromisoformat(str(raw))
    except ValueError:
        return datetime.now().astimezone()


async def _to_desktop(
    db: AsyncSession, attempt: SubmissionAttempt, app: Application, mode: str, now: datetime
) -> str:
    """The form asks for a human check. The server never passes one, but the candidate can at their
    own computer: the application goes back in the queue marked for the desktop, which fills the
    form in and waits for them to tick the box. Nothing was sent, so this costs no quota. Someone
    who chose "our servers only" has no desktop to send it to: it goes to them as before."""
    if mode == "cloud":
        return await _hand_over(db, attempt, app, "The form asks for a human check.", now)
    attempt.state, attempt.finished_at = "cancelled", now
    attempt.failure_class, attempt.failure_message = "needs_desktop", "human check"
    app.status = "queued"
    app.match = {**(app.match or {}), "needs_desktop": True, "needs_desktop_at": now.isoformat()}
    await pipeline.log(
        db, app, "waiting_for_desktop", reason="The form asks for a human check: waiting for you."
    )
    await db.commit()
    return "cancelled"


async def _give_up_waiting(db: AsyncSession, app: Application) -> None:
    app.match = {**(app.match or {}), "needs_desktop": False}
    app.status, app.channel, app.needs_input = "apply_yourself", "manual", []
    await pipeline.log(
        db, app, "handed_over", reason="Your computer was not open to pass the check."
    )


async def _hand_over(
    db: AsyncSession, attempt: SubmissionAttempt, app: Application, why: str, now: datetime
) -> str:
    """The site's form cannot be completed by the app. Nothing was sent, so the attempt costs no
    quota; the prepared CV and note wait for the person to submit on the employer's own site."""
    attempt.state, attempt.finished_at = "cancelled", now
    attempt.failure_class, attempt.failure_message = "handed_over", why[:300]
    app.status, app.channel, app.needs_input = "apply_yourself", "manual", []
    await pipeline.log(db, app, "handed_over", reason=why)
    await _event(db, attempt, app, "review_required", now, reason=why, handed_over=True)
    await db.commit()
    return "cancelled"


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
        metrics.autoapply_dispatch.labels(attempt.channel, "failed").inc()
        app.status = "failed"
        await pipeline.log(db, app, "failed", reason=exc.message)
        await _event(db, attempt, app, "application_failed", now, reason=exc.message, code=exc.code)
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
        return await settle(db, attempt, app, claim.channel, result, error, now)


async def _event(
    db: AsyncSession,
    attempt: SubmissionAttempt,
    app: Application,
    kind: str,
    now: datetime,
    **kw: Any,
) -> None:
    await runlog.add(
        db,
        app.user_id,
        kind,
        application_id=app.id,
        attempt_id=attempt.id,
        executor=attempt.executor,
        now=now,
        **kw,
    )


async def settle(
    db: AsyncSession,
    attempt: SubmissionAttempt,
    app: Application,
    channel: str,
    result: Any,
    error: AdapterError | None,
    now: datetime,
) -> str:
    """Record how a carried-out attempt ended, whoever carried it out (this server or the desktop).
    Commits."""
    attempt.duration_ms = max(0, int((now - attempt.claimed_at).total_seconds() * 1000))
    if error is None:
        attempt.state, attempt.finished_at = "confirmed", now
        if channel == "form":
            attempt.provider_ref = result.reference
            attempt.receipt = {
                "reference": result.reference,
                "evidence": result.evidence[:300],
                "provider": result.provider,
                "steps": result.steps,
                "documents": result.documents,
                "cv_version": cv_version(app.package or {}),
                "executor": attempt.executor,
                "verified_at": now.isoformat(),
            }
            app.status = "submitted"
        else:
            attempt.provider_ref, attempt.thread_ref = result.message_id, result.thread_id
            app.status = "sent_email"
        await pipeline.log(db, app, app.status, channel=channel, reference=attempt.provider_ref)
        await _event(
            db,
            attempt,
            app,
            "submission_verified",
            now,
            reference=attempt.provider_ref,
            provider=getattr(result, "provider", "") or channel,
        )
        await db.commit()
        await record_from(db, "autoapply.application_sent", user_id=app.user_id, channel=channel)
        return "confirmed"
    if error.code == "interrupted":
        # skip or stop, pressed by the candidate before the button was reached: nothing was sent
        attempt.state, attempt.finished_at = "cancelled", now
        attempt.failure_class, attempt.failure_message = "interrupted", error.message
        if error.message == "skip":
            app.status, app.skip_reason = "skipped", pipeline.USER_SKIPPED
            await pipeline.log(db, app, "skipped", reason="by you, while it was running")
            await _event(db, attempt, app, "application_skipped", now, reason="you skipped it")
        else:
            app.status = "queued"  # stopped: it waits for the candidate to start again
            await pipeline.log(db, app, "held_back", reason="you stopped the run")
            await _event(db, attempt, app, "application_cancelled", now, reason="you stopped it")
        await db.commit()
        return "cancelled"
    if error.code == "needs_input":
        # the form asked something only the candidate can answer: nothing was sent
        attempt.state, attempt.finished_at = "cancelled", now
        attempt.failure_class, attempt.failure_message = "needs_input", error.message
        app.status, app.needs_input = "needs_input", error.need
        await pipeline.log(db, app, "needs_input", reason="the form asked something new")
        await _event(
            db,
            attempt,
            app,
            "review_required",
            now,
            reason="the form asks something only you can answer",
            questions=[str(n.get("question", ""))[:120] for n in error.need][:5],
        )
        await db.commit()
        return "cancelled"
    if error.code == "ambiguous":
        attempt.state = "ambiguous"
        attempt.failure_class, attempt.failure_message = "ambiguous", error.message
        app.status = "confirmation_pending"
        await pipeline.log(db, app, "confirmation_pending", reason=error.message)
        await _event(db, attempt, app, "application_paused", now, reason="waiting to confirm it")
        await db.commit()
        metrics.autoapply_dispatch.labels(channel, "ambiguous").inc()
        return "ambiguous"
    if error.code == "reauth":
        conn = await mailbox.get(db, app.user_id)
        if conn is not None:
            await mailbox.mark_reauth(db, conn)
        attempt.state, attempt.finished_at, attempt.failure_class = "cancelled", now, "reauth"
        app.status = "queued"
        await pipeline.log(db, app, "held_back", reason="your mailbox needs to be reconnected")
        await _event(db, attempt, app, "application_paused", now, reason="reconnect your mailbox")
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
                        # an executor still reporting progress owns it
                        or_(
                            SubmissionAttempt.lease_until.is_(None),
                            SubmissionAttempt.lease_until < now,
                        ),
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
                        or_(
                            SubmissionAttempt.lease_until.is_(None),
                            SubmissionAttempt.lease_until < now,
                        ),
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
