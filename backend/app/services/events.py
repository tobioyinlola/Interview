"""The platform event log: one row for each thing that happens, for the admin console.

Recording is best effort and never changes what the caller does: it uses its own short transaction,
and any failure is logged and swallowed. An event holds who, what and a few plain facts (a number, a
kind, a status). It never holds CV text, transcripts or answers, so an admin can see what is
happening without reading anyone's content."""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Event

log = logging.getLogger("app.events")

# kind -> (category, what an admin reads). Every recorded kind must be here, so the console can
# group and describe it; a test checks that nothing recorded is missing.
EVENT_KINDS: dict[str, tuple[str, str]] = {
    "user.signed_up": ("account", "Signed up"),
    "user.signed_in": ("account", "Signed in"),
    "user.password_reset": ("account", "Reset their password"),
    "user.profile_updated": ("account", "Updated their profile"),
    "user.password_changed": ("account", "Changed their password"),
    "user.deleted": ("account", "Deleted their account"),
    "auth.login_failed": ("security", "Wrong password"),
    "staff.signed_in": ("security", "Signed in to the back office"),
    "staff.signed_out": ("security", "Signed out of the back office"),
    "staff.login_failed": ("security", "Failed back-office sign-in"),
    "onboarding.completed": ("onboarding", "Finished onboarding"),
    "onboarding.skipped": ("onboarding", "Skipped onboarding"),
    "tour.done": ("onboarding", "Finished or skipped the tour"),
    "outreach.requested": ("autoapply", "Asked for startup outreach"),
    "outreach.approved": ("autoapply", "Startup outreach switched on for them"),
    "outreach.revoked": ("autoapply", "Startup outreach switched off for them"),
    "cv.uploaded": ("content", "Uploaded a CV"),
    "cv.removed": ("content", "Removed their CV"),
    "company.added": ("content", "Added a company"),
    "research.ready": ("content", "Company research finished"),
    "research.failed": ("content", "Company research failed"),
    "session.started": ("interview", "Started an interview"),
    "session.ended": ("interview", "Ended an interview"),
    "session.blocked": ("interview", "Could not start: no sessions left"),
    "scoring.ready": ("interview", "Answer scoring finished"),
    "scoring.failed": ("interview", "Answer scoring failed"),
    "answer.rated": ("interview", "Rated an answer"),
    "referral.counted": ("referral", "A friend joined with their link"),
    "referral.held": ("referral", "A sign-up was held (same device)"),
    "referral.approved": ("referral", "A held sign-up was approved"),
    "reward.redeemed": ("referral", "Redeemed a free interview"),
    "autoapply.enabled": ("autoapply", "Switched on Auto-Apply"),
    "autoapply.paused": ("autoapply", "Paused Auto-Apply"),
    "autoapply.resumed": ("autoapply", "Resumed Auto-Apply"),
    "autoapply.discovery_done": ("autoapply", "Daily job search finished"),
    "autoapply.discovery_failed": ("autoapply", "Daily job search failed"),
    "autoapply.mailbox_connected": ("autoapply", "Connected a mailbox"),
    "autoapply.mailbox_disconnected": ("autoapply", "Disconnected a mailbox"),
    "autoapply.mailbox_reauth": ("autoapply", "Mailbox access expired"),
    "autoapply.application_sent": ("autoapply", "An application went out"),
    "autoapply.application_failed": ("autoapply", "An application failed"),
    "autoapply.outreach_sent": ("autoapply", "A hiring-contact note went out"),
    "hunt.sent": ("autoapply", "A startup outreach note went out"),
    "autoapply.ended": ("autoapply", "A 30-day search finished"),
    "email.sent": ("email", "Email sent"),
    "email.failed": ("email", "Email failed to send"),
    "admin.credit_granted": ("admin", "Admin gave free interviews"),
    "admin.worker_retry": ("admin", "Admin retried a background task"),
    "admin.referral_approved": ("admin", "Admin approved a held sign-up"),
    "admin.switch": ("admin", "Admin changed an Auto-Apply switch"),
    "admin.export": ("admin", "Admin exported data"),
}

_MAX_TEXT = 200


def _clean(value: Any) -> Any:
    """JSON-safe, and short: an event is a fact, not a document."""
    if isinstance(value, str):
        return value[:_MAX_TEXT]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, bool | int | float) or value is None:
        return value
    if isinstance(value, list | tuple):
        return [_clean(v) for v in value[:20]]
    if isinstance(value, dict):
        return {str(k)[:40]: _clean(v) for k, v in list(value.items())[:20]}
    return str(value)[:_MAX_TEXT]


async def record_event(
    sf: async_sessionmaker[AsyncSession],
    kind: str,
    *,
    user_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    **data: Any,
) -> None:
    """Write one event in its own transaction. Never raises."""
    try:
        async with sf() as db:
            db.add(
                Event(
                    kind=kind,
                    user_id=user_id,
                    actor_id=actor_id,
                    data={k: _clean(v) for k, v in data.items()},
                )
            )
            await db.commit()
    except Exception as exc:
        log.warning(
            "event not recorded", extra={"fields": {"kind": kind, "error": type(exc).__name__}}
        )


async def record_from(
    db: AsyncSession,
    kind: str,
    *,
    user_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    **data: Any,
) -> None:
    """The same, from code that has a request's session: the event goes through a separate session
    on the same engine, so it never joins (or breaks) the caller's transaction."""
    if db.bind is None:
        return
    sf = async_sessionmaker(db.bind, expire_on_commit=False)
    await record_event(sf, kind, user_id=user_id, actor_id=actor_id, **data)


async def purge_old_events(sf: async_sessionmaker[AsyncSession], days: int) -> int:
    """Delete events older than `days`. The log is for running the product, not an archive: it also
    holds the addresses of emails sent to people who never made an account."""
    try:
        async with sf() as db:
            res = await db.execute(
                delete(Event).where(Event.created_at < datetime.now(UTC) - timedelta(days=days))
            )
            await db.commit()
            return int(res.rowcount or 0)  # type: ignore[attr-defined]
    except Exception as exc:
        log.warning("event purge failed", extra={"fields": {"error": type(exc).__name__}})
        return 0
