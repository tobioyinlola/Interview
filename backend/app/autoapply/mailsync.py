"""Reading the candidate's mailbox for replies from employers.

Messages stay in the mailbox. For each one that looks like a recruiting message we keep only
evidence (sender, subject, kind, times, links), never the body, and we match it to the right
application by the strongest evidence available. If more than one application fits, a person
decides; nothing is guessed."""

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.autoapply import interviews, mailbox, pipeline, recruiting
from app.autoapply.adapters import AdapterError, InboundMessage, MailboxAdapter
from app.config import Settings
from app.models import (
    Application,
    JobPosting,
    MailboxConnection,
    RecruitingEvent,
    SearchProfile,
    SubmissionAttempt,
)

log = logging.getLogger("app.autoapply.mailsync")
ATS_DOMAINS = {
    "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com",
    "icims.com", "myworkday.com", "jobvite.com", "bamboohr.com", "recruitee.com",
    "teamtailor.com", "breezy.hr", "applytojob.com",
}  # fmt: skip
STAGE = {
    "acknowledgment": ("acknowledged", 1),
    "assessment": ("assessment", 2),
    "shortlist": ("shortlisted", 3),
    "invitation": ("invited", 4),
    "confirmation": ("interview_scheduled", 5),
    "reschedule": ("interview_scheduled", 5),
    "cancellation": ("interview_cancelled", 5),
    "rejection": ("rejected", 9),
}
ALWAYS_APPLY = {"reschedule", "cancellation", "rejection"}


def registrable(host: str) -> str:
    """example.co.uk -> example.co.uk, careers.acme.com -> acme.com."""
    labels = [p for p in host.lower().split(".") if p]
    if len(labels) <= 2:
        return ".".join(labels)
    if len(labels[-1]) == 2 and labels[-2] in ("co", "com", "org", "ac", "gov", "net"):
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def sender_domain(from_addr: str) -> str:
    m = re.search(r"[\w.+-]+@([\w.-]+)", from_addr)
    return registrable(m.group(1)) if m else ""


@dataclass
class Known:
    """One of the candidate's applications with what identifies its replies."""

    app: Application
    posting: JobPosting
    refs: set[str]  # Message-IDs we sent for it
    threads: set[str]
    domains: set[str]


def _domains(p: JobPosting) -> set[str]:
    found: set[str] = set()
    for addr in (p.apply_email, p.hiring_contact):
        if addr and "@" in addr:
            found.add(registrable(addr.split("@", 1)[1]))
    if p.application_url:
        found.add(registrable(urlsplit(p.application_url).hostname or ""))
    return {d for d in found if d and d not in ATS_DOMAINS}


async def load_known(db: AsyncSession, user_id: uuid.UUID) -> list[Known]:
    rows = (
        await db.execute(
            select(Application, JobPosting)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .where(Application.user_id == user_id, Application.status.in_(interviews.SENT))
        )
    ).all()
    attempts = (
        (await db.execute(select(SubmissionAttempt).where(SubmissionAttempt.user_id == user_id)))
        .scalars()
        .all()
    )
    by_app: dict[uuid.UUID, list[SubmissionAttempt]] = {}
    for a in attempts:
        by_app.setdefault(a.application_id, []).append(a)
    out = []
    for app, posting in rows:
        mine = by_app.get(app.id, [])
        out.append(
            Known(
                app,
                posting,
                {a.provider_ref for a in mine if a.provider_ref and a.channel != "form"},
                {a.thread_ref for a in mine if a.thread_ref},
                _domains(posting),
            )
        )
    return out


def match(msg: InboundMessage, text: str, known: list[Known]) -> tuple[list[Known], str]:
    """The applications this message could belong to, and the evidence that found them. One
    candidate means matched; several mean a person must choose; none means it is not ours."""
    low = f"{msg.subject}\n{text}".lower()
    refs = {r for r in ([msg.in_reply_to] if msg.in_reply_to else []) + msg.references if r}
    tier1 = [k for k in known if (k.refs & refs) or (msg.thread_id and msg.thread_id in k.threads)]
    if tier1:
        return tier1, "reply to your message"
    tier2 = [
        k
        for k in known
        if k.posting.requisition_id
        and re.search(
            rf"(?<![A-Za-z0-9]){re.escape(k.posting.requisition_id.lower())}(?![A-Za-z0-9])", low
        )
    ]
    if tier2:
        return tier2, "requisition id"
    dom = sender_domain(msg.from_addr)
    from_ats = dom in ATS_DOMAINS
    by_sender = [
        k
        for k in known
        if (dom and dom in k.domains) or (from_ats and k.posting.company.lower() in low)
    ]
    titled = [
        k
        for k in by_sender
        if (
            words := [
                w
                for w in re.findall(r"[a-z]{3,}", k.posting.title.lower())
                if w not in ("and", "the")
            ]
        )
        and sum(w in low for w in words) / len(words) >= 0.6
    ]
    if titled:
        return titled, "sender and role"
    if len(by_sender) == 1 and not from_ats:
        return by_sender, "sender"
    return by_sender, "sender"  # several (or none): the caller decides what that means


async def _apply(
    db: AsyncSession, ev: RecruitingEvent, app: Application, posting: JobPosting, now: datetime
) -> None:
    stage, rank = STAGE[ev.kind]
    current = STAGE_RANK.get(app.recruiting_stage or "", 0)
    if ev.kind in ALWAYS_APPLY or rank >= current:
        app.recruiting_stage = stage
    await pipeline.log(db, app, "recruiter_update", update=ev.kind)
    if ev.kind in ("invitation", "confirmation", "reschedule", "cancellation"):
        link = await interviews.upsert(db, app, ev, now)
        if link is not None and ev.kind in ("invitation", "confirmation", "reschedule"):
            await interviews.ensure_company(db, link, app, posting)


STAGE_RANK = {v[0]: v[1] for v in STAGE.values()}


async def process_message(
    db: AsyncSession,
    conn: MailboxConnection,
    msg: InboundMessage,
    known: list[Known],
    assumed_zone: str,
    now: datetime,
) -> str:
    """Handle one message. Returns what became of it: new, matched, review, ignored, duplicate."""
    seen = (
        await db.execute(
            select(RecruitingEvent.id).where(
                RecruitingEvent.mailbox_id == conn.id,
                RecruitingEvent.provider_message_id == msg.provider_id,
            )
        )
    ).first()
    if seen is not None:
        return "duplicate"
    if msg.from_addr.lower().find(conn.address.lower()) >= 0:
        return "ignored"  # our own message
    text = msg.snippet  # read now, never stored
    kind = recruiting.classify(msg.subject, text)
    if kind is None:
        return "ignored"
    candidates, by = match(msg, text, known)
    if not candidates and by != "sender":
        return "ignored"
    if not candidates:
        return "ignored"  # a recruiting-sounding message from nobody we applied to
    found = recruiting.links(text)
    sched = recruiting.parse_schedule(f"{msg.subject}\n{text}", assumed_zone)
    ev = RecruitingEvent(
        id=uuid.uuid4(),
        user_id=conn.user_id,
        mailbox_id=conn.id,
        provider_message_id=msg.provider_id,
        thread_id=msg.thread_id,
        kind=kind,
        links=found,
        scheduled_at=sched.when if kind in ("confirmation", "reschedule") else None,
        time_zone_unclear=sched.unclear and kind in ("confirmation", "reschedule"),
        round=recruiting.round_of(f"{msg.subject}\n{text}"),
        received_at=msg.received_at,
        created_at=now,
        evidence={
            "from": msg.from_addr[:200],
            "subject": msg.subject[:200],
            "matched_by": by,
            "local_time": sched.local if kind in ("confirmation", "reschedule") else None,
        },
    )
    unique = {k.app.id: k for k in candidates}
    if len(unique) == 1:
        (only,) = unique.values()
        ev.application_id, ev.status = only.app.id, "matched"
        db.add(ev)
        await db.flush()
        await _apply(db, ev, only.app, only.posting, now)
        return "matched"
    ev.status = "needs_review"
    ev.evidence = {**ev.evidence, "candidates": [str(i) for i in unique]}
    db.add(ev)
    await db.flush()
    return "review"


async def sync_user(
    maker: async_sessionmaker[AsyncSession],
    adapter: MailboxAdapter,
    settings: Settings,
    user_id: uuid.UUID,
    now: datetime,
) -> dict[str, int]:
    """Read new mail for one candidate. Safe to run twice: messages are keyed by their id."""
    stats = {"read": 0, "matched": 0, "review": 0, "ignored": 0, "duplicate": 0}
    async with maker() as db:
        conn = await mailbox.get(db, user_id)
        prof = (
            await db.execute(select(SearchProfile).where(SearchProfile.user_id == user_id))
        ).scalar_one_or_none()
        if conn is None or conn.status != "connected" or "read" not in (conn.capabilities or []):
            return stats
        try:
            messages, cursor = await adapter.read_since(mailbox.token(settings, conn), conn.cursor)
        except AdapterError as exc:
            if exc.code == "reauth":
                await mailbox.mark_reauth(db, conn)
            return stats
        known = await load_known(db, user_id)
        zone = prof.timezone if prof else "UTC"
        for msg in sorted(messages, key=lambda m: m.received_at):
            stats["read"] += 1
            outcome = await process_message(db, conn, msg, known, zone, now)
            stats[outcome] += 1
        conn.cursor, conn.last_synced_at = cursor, now
        await db.commit()
    return stats
