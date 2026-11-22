"""From an interview with an employer to the interview-preparation part of the app.

An interview is one row per application and round, however many messages mention it. Preparing
for it uses a company in the existing interview model, and starts the assistant with the CV that
was actually submitted and the job as it was when the candidate applied, not whatever their
profile says today."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.autoapply import pipeline
from app.models import Application, Company, InterviewLink, JobPosting, RecruitingEvent

SENT = ("submitted", "sent_email", "confirmation_pending")
MAX_SNAPSHOT = 16_000


class HandoffError(Exception):
    def __init__(self, code: str, message: str, status: int = 404) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


async def for_application(db: AsyncSession, application_id: uuid.UUID) -> list[InterviewLink]:
    return list(
        (
            await db.execute(
                select(InterviewLink)
                .where(InterviewLink.application_id == application_id)
                .order_by(InterviewLink.round)
            )
        )
        .scalars()
        .all()
    )


def _newest_stamp(link: InterviewLink) -> str:
    return max((h.get("received_at", "") for h in link.history or []), default="")


async def upsert(
    db: AsyncSession, app: Application, ev: RecruitingEvent, now: datetime
) -> InterviewLink | None:
    """Create or update the interview this message is about. Replaying a message, or receiving
    an older one late, never creates a second interview or moves one backwards."""
    existing = await for_application(db, app.id)
    live = [i for i in existing if i.status in ("invited", "scheduled")]
    if ev.kind in ("reschedule", "cancellation"):
        pool = [i for i in existing if ev.round is None or i.round == ev.round]
        target = next(iter(reversed([i for i in pool if i.status != "cancelled"] or pool)), None)
        if target is None and ev.kind == "reschedule" and ev.scheduled_at is not None:
            # a new time for an interview whose first message we never saw: it exists all the same
            target = InterviewLink(
                user_id=app.user_id,
                application_id=app.id,
                round=ev.round or 1,
                status="invited",
                history=[],
                created_at=now,
            )
            db.add(target)
        if target is None:
            return None  # nothing to change: the message stays as evidence only
    else:
        if ev.round is not None:
            target = next((i for i in existing if i.round == ev.round), None)
        else:
            target = live[-1] if live else None
        if target is None:
            round_no = ev.round or (max((i.round for i in existing), default=0) + 1)
            target = InterviewLink(
                user_id=app.user_id,
                application_id=app.id,
                round=round_no,
                status="invited",
                history=[],
                created_at=now,
            )
            db.add(target)
    stamp = ev.received_at.isoformat()
    if _newest_stamp(target) > stamp:
        return target  # an older message arriving late: keep what a newer one said
    if any(h.get("event") == str(ev.id) for h in target.history or []):
        return target  # this very message again
    for key in ("scheduling_url", "meeting_url"):
        if ev.links.get(key):
            setattr(target, key, ev.links[key])
    entry: dict[str, Any] = {
        "kind": ev.kind,
        "event": str(ev.id),
        "received_at": stamp,
        "scheduled_at": ev.scheduled_at.isoformat() if ev.scheduled_at else None,
    }
    if ev.kind in ("confirmation", "reschedule") and ev.scheduled_at is not None:
        target.status, target.scheduled_at = "scheduled", ev.scheduled_at
        target.time_zone_unclear = ev.time_zone_unclear
    elif ev.kind == "cancellation":
        target.status = "cancelled"
    elif ev.kind == "invitation" and target.status not in ("scheduled", "cancelled"):
        target.status = "invited"
    target.last_event_id = ev.id
    target.history = [*(target.history or []), entry]
    await db.flush()
    return target


async def ensure_company(
    db: AsyncSession, link: InterviewLink, app: Application, posting: JobPosting
) -> Company:
    """The company in the interview-preparation part of the app for this interview."""
    if link.company_id is not None:
        found = await db.get(Company, link.company_id)
        if found is not None:
            return found
    pkg = app.package or {}
    known = f"Interviewing for {posting.title}"
    known += f" (round {link.round})." if link.round > 1 else "."
    desc = (pkg.get("posting", {}).get("description") or posting.description or "")[:1500]
    company = Company(
        user_id=app.user_id,
        name=posting.company[:120],
        role=posting.title[:200],
        job_posting_url=posting.application_url,
        known_text=(known + "\n" + desc)[:2000],
    )
    db.add(company)
    await db.flush()
    link.company_id = company.id
    return company


async def session_context(
    db: AsyncSession, user_id: uuid.UUID, interview_id: uuid.UUID
) -> tuple[uuid.UUID, str, str]:
    """(company id, role, notes snapshot) to start an interview session from this interview.

    The snapshot is built from the application's frozen package, so editing the profile or CV
    afterwards changes nothing about what the assistant knows for this interview."""
    row = (
        await db.execute(
            select(InterviewLink, Application, JobPosting)
            .join(Application, Application.id == InterviewLink.application_id)
            .join(JobPosting, JobPosting.id == Application.posting_id)
            .where(InterviewLink.id == interview_id, InterviewLink.user_id == user_id)
        )
    ).first()
    if row is None:
        raise HandoffError("interview_not_found", "Interview not found.")
    link, app, posting = row
    pkg = app.package
    if not pkg:
        raise HandoffError("no_package", "This interview has no saved application.", 409)
    company = await ensure_company(db, link, app, posting)
    head = f"Interview with {posting.company} for {posting.title}."
    head += f" Round {link.round}." if link.round else ""
    answers = "\n".join(
        f"- {k}: {v['value']}"
        for k, v in (pkg.get("answers") or {}).items()
        if k not in ("name", "full_name", "email", "phone", "location")
    )
    parts = [
        head,
        "CV as submitted:\n" + pkg["cv"]["submitted_text"],
        ("Answers given on the application:\n" + answers) if answers else "",
        "Job description when applied:\n" + (pkg.get("posting", {}).get("description") or ""),
    ]
    snapshot = "\n\n".join(p for p in parts if p)[:MAX_SNAPSHOT]
    await pipeline.log(db, app, "prepared", interview=str(link.id))
    return company.id, posting.title[:200], snapshot
