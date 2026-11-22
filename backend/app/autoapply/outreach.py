"""A short first-contact note to a hiring contact, sent from the candidate's own mailbox.

Only when the candidate switched outreach on, only to a contact the listing publishes or the
candidate supplied, at most one note per role, never to an address their application already
went to, and under its own daily limit. The note is plain text built from verified facts."""

import re
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.autoapply import campaign, clock, mailbox, outbox, switches
from app.autoapply.adapters import AdapterError
from app.models import (
    Application,
    Campaign,
    CandidateFacts,
    JobPosting,
    Outreach,
    SubmissionAttempt,
)
from app.services.events import record_from

EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[A-Za-z]{2,}$")


class OutreachError(Exception):
    def __init__(self, code: str, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def write_note(posting: JobPosting, facts: dict[str, Any] | None) -> tuple[str, str]:
    """(subject, body). Plain, short and built only from the posting and verified facts."""
    contact = (facts or {}).get("contact", {})
    name = contact.get("name") or ""
    history = (facts or {}).get("history") or []
    background = (
        f"I most recently worked as {history[0]['title']} at {history[0]['company']}. "
        if history
        else ""
    )
    ref = f" ({posting.requisition_id})" if posting.requisition_id else ""
    body = (
        f"Hello,\n\nI have applied for the {posting.title} role{ref} at {posting.company} and "
        f"wanted to introduce myself directly. {background}I would be glad to answer any "
        f"questions about my application.\n\nThank you for your time.\n\n{name}".rstrip()
    )
    return f"Interested in the {posting.title} role at {posting.company}", body


async def _already_emailed(db: AsyncSession, user_id: uuid.UUID, recipient: str) -> bool:
    """Has this candidate's own application already gone, or been queued, to that address?"""
    rows = (
        (
            await db.execute(
                select(Application.package).where(
                    Application.user_id == user_id,
                    Application.channel == "email",
                    Application.status.in_(
                        ("queued", "sending", "sent_email", "confirmation_pending", "needs_input")
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    return any(
        ((p or {}).get("destination", {}).get("to") or "").lower() == recipient.lower()
        for p in rows
    )


async def plan(
    db: AsyncSession,
    app: Application,
    posting: JobPosting,
    *,
    recipient: str | None,
    source: str,
    now: datetime,
) -> Outreach | None:
    """Queue a note for this role if all the rules allow it. Returns None when there is no
    contact; a skipped record (with its reason) when a rule says no."""
    contact = (recipient or posting.hiring_contact or "").strip().lower()
    if not contact:
        return None
    existing = (
        await db.execute(
            select(Outreach).where(
                Outreach.user_id == app.user_id, Outreach.posting_id == posting.id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing  # at most one first-contact note per role
    facts = (
        await db.execute(select(CandidateFacts).where(CandidateFacts.user_id == app.user_id))
    ).scalar_one_or_none()
    subject, body = write_note(posting, facts.data if facts else None)
    row = Outreach(
        user_id=app.user_id,
        posting_id=posting.id,
        application_id=app.id,
        recipient=contact,
        recipient_source=source,
        subject=subject[:300],
        body=body,
        created_at=now,
    )
    if not EMAIL.match(contact):
        row.status, row.reason = "skipped", "That is not an email address."
    elif await _already_emailed(db, app.user_id, contact):
        row.status, row.reason = "skipped", "Your application already goes to this address."
    db.add(row)
    await db.flush()
    return row


async def request(
    db: AsyncSession,
    user_id: uuid.UUID,
    app: Application,
    posting: JobPosting,
    recipient: str,
    now: datetime,
) -> Outreach:
    """The candidate names a hiring contact themselves."""
    prof = await campaign.get_profile(db, user_id)
    if prof is None or not (prof.channels or {}).get("outreach"):
        raise OutreachError("outreach_off", "Turn on outreach in your search first.")
    row = await plan(db, app, posting, recipient=recipient, source="candidate", now=now)
    assert row is not None
    await db.commit()
    return row


async def settled(db: AsyncSession, attempt: SubmissionAttempt, outcome: str) -> None:
    row = (
        await db.execute(
            select(Outreach).where(Outreach.id == _outreach_id(attempt.idempotency_key))
        )
    ).scalar_one_or_none()
    if row is None:
        return
    if outcome == "sent":
        row.status, row.sent_at = "sent", attempt.finished_at
    elif outcome == "released":
        row.status = "queued"
    elif outcome == "failed":
        row.status = "failed"


def _outreach_id(key: str) -> uuid.UUID:
    return uuid.UUID(key.split(":")[1])


async def send_next(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    adapters: outbox.Adapters,
    now: datetime,
) -> str | None:
    """Send one queued note for this candidate if every rule still allows it. Returns the
    attempt's state, or None when nothing was sent."""
    settings = adapters.settings
    async with maker() as db:
        camp = (
            await db.execute(
                select(Campaign)
                .where(Campaign.user_id == user_id, Campaign.status == "active")
                .with_for_update()
            )
        ).scalar_one_or_none()
        prof = await campaign.get_profile(db, user_id)
        conn = await mailbox.get(db, user_id)
        off = await switches.active(db)
        if (
            switches.blocked(off, "outreach", adapters.mailbox.name) is not None
            or camp is None
            or prof is None
            or not campaign.outbound_open(camp, prof, now)
            or not (prof.channels or {}).get("outreach")
            or not clock.within_active_hours(now, camp.timezone, prof.active_hours)
            or conn is None
            or conn.status != "connected"
            or not conn.token_encrypted
        ):
            await db.rollback()
            return None
        day = clock.local_day(now, camp.timezone)
        if await outbox.used_today(db, user_id, ("outreach",), day) >= prof.daily_outreach_cap:
            await db.rollback()
            return None
        rows = (
            (
                await db.execute(
                    select(Outreach)
                    .where(Outreach.user_id == user_id, Outreach.status == "queued")
                    .order_by(Outreach.created_at)
                    .with_for_update(skip_locked=True)
                    .limit(5)
                )
            )
            .scalars()
            .all()
        )
        chosen: Outreach | None = None
        for row in rows:
            if not outbox.dispatch_allowed(
                settings, "outreach", adapters.mailbox.real, row.recipient
            ):
                continue
            if await _already_emailed(db, user_id, row.recipient):
                row.status, row.reason = "skipped", "Your application already goes to this address."
                continue
            chosen = row
            break
        if chosen is None or chosen.application_id is None:
            await db.commit()
            return None
        chosen.status = "sending"
        attempt = SubmissionAttempt(
            id=uuid.uuid4(),
            user_id=user_id,
            application_id=chosen.application_id,
            channel="outreach",
            idempotency_key=f"outreach:{chosen.id}:1",
            state="dispatched",
            local_day=day,
            claimed_at=now,
            dispatched_at=now,
        )
        db.add(attempt)
        token = mailbox.token(settings, conn)
        sender, to, subject, body = conn.address, chosen.recipient, chosen.subject, chosen.body
        key, attempt_id, outreach_id = attempt.idempotency_key, attempt.id, chosen.id
        await db.commit()
    error: AdapterError | None = None
    try:
        sent = await adapters.mailbox.send(
            token,
            sender=sender,
            to=to,
            subject=subject,
            body=body,
            attachments=[],
            message_id=outbox.message_id(key),
        )
    except AdapterError as exc:
        error = exc
    except Exception:  # noqa: BLE001
        error = AdapterError("ambiguous", "The send did not finish cleanly.")
    async with maker() as db:
        done = await db.get(SubmissionAttempt, attempt_id, with_for_update=True)
        found = await db.get(Outreach, outreach_id, with_for_update=True)
        assert done is not None and found is not None
        attempt, row = done, found
        if error is None:
            attempt.state, attempt.finished_at = "confirmed", now
            attempt.provider_ref, attempt.thread_ref = sent.message_id, sent.thread_id
            row.status, row.sent_at = "sent", now
            await db.commit()
            await record_from(db, "autoapply.outreach_sent", user_id=user_id)
            return "confirmed"
        if error.code == "ambiguous":
            attempt.state, attempt.failure_class = "ambiguous", "ambiguous"  # stays 'sending'
            await db.commit()
            return "ambiguous"
        attempt.state, attempt.finished_at = "failed", now
        attempt.failure_class, attempt.failure_message = error.code, error.message
        row.status, row.reason = "failed", error.message[:300]
        if error.code == "reauth" and conn is not None:
            c = await mailbox.get(db, user_id)
            if c is not None:
                await mailbox.mark_reauth(db, c)
        await db.commit()
        return "failed"
