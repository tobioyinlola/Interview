"""The run loop for startup outreach: plan notes, send them one at a time under every rule,
follow up once, and read replies, opt-outs and bounces so nobody is written to again."""

import asyncio
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from email.utils import parseaddr
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.interfaces import LlmProvider
from app.autoapply import clock, cvfile, mailbox, outbox, switches
from app.autoapply import facts as facts_mod
from app.autoapply.adapters import AdapterError, InboundMessage, MailAttachment, MailboxAdapter
from app.config import Settings
from app.hunt import draft, fit, health, policy, template
from app.models import (
    HuntSettings,
    HuntTarget,
    Note,
    SearchProfile,
    Startup,
    StartupContact,
    Suppression,
)
from app.repositories import NotesRepo
from app.services.events import record_from

log = logging.getLogger(__name__)

MAX_DAILY = 25
MAX_BACKLOG = 30
MIN_GAP = timedelta(seconds=90)
STALE_CLAIM = timedelta(minutes=10)
# Does this address's domain receive mail? Replaced in tests, so none of them goes to the network.
RESOLVER: Callable[[str], Awaitable[bool | None]] = health.mail_domain_works
_KIND_RANK = {"person": 0, "role": 1, "general": 2}


# ------------------------------------------------------------------------------ suppression


async def suppressed(db: AsyncSession, user_id: uuid.UUID, email: str) -> str | None:
    """Why nobody may write to this address for this candidate, or None."""
    dom = policy.domain_of(email)
    row = (
        await db.execute(
            select(Suppression.reason).where(
                (Suppression.user_id.is_(None) | (Suppression.user_id == user_id))
                & ((Suppression.email == email.lower()) | (Suppression.domain == dom))
            )
        )
    ).first()
    return row[0] if row else None


async def suppress(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    reason: str,
    email: str | None = None,
    domain: str | None = None,
    now: datetime,
) -> None:
    db.add(
        Suppression(
            id=uuid.uuid4(),
            user_id=user_id,
            email=email.lower() if email else None,
            domain=domain,
            reason=reason,
            created_at=now,
        )
    )


async def paused(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """One pause for everything: pausing Auto-Apply pauses startup outreach too."""
    prof = (
        await db.execute(select(SearchProfile).where(SearchProfile.user_id == user_id))
    ).scalar_one_or_none()
    return bool(prof and prof.paused)


async def counts(db: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    """For the Auto-Apply overview: notes waiting for approval, sent, answered, and how many of
    the notes point at a real opening on a careers page."""
    rows = (
        await db.execute(
            select(HuntTarget.status, func.count())
            .where(HuntTarget.user_id == user_id)
            .group_by(HuntTarget.status)
        )
    ).all()
    by = {k: v for k, v in rows}
    with_roles = (
        await db.execute(
            select(func.count())
            .select_from(HuntTarget)
            .where(
                HuntTarget.user_id == user_id,
                HuntTarget.step == 1,
                func.jsonb_array_length(HuntTarget.openings) > 0,
            )
        )
    ).scalar_one()
    return {
        "waiting": by.get("drafted", 0),
        "sent": by.get("sent", 0) + by.get("replied", 0) + by.get("declined", 0),
        "replied": by.get("replied", 0),
        "openings": with_roles,
    }


async def recent_sent(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 5
) -> list[tuple[HuntTarget, Startup, StartupContact]]:
    """The latest pitches that actually went out, newest first, with who they went to."""
    rows = (
        await db.execute(
            select(HuntTarget, Startup, StartupContact)
            .join(Startup, Startup.id == HuntTarget.startup_id)
            .join(StartupContact, StartupContact.id == HuntTarget.contact_id)
            .where(
                HuntTarget.user_id == user_id,
                HuntTarget.status.in_(("sent", "replied", "declined")),
            )
            .order_by(HuntTarget.sent_at.desc().nulls_last(), HuntTarget.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [(t, s, c) for t, s, c in rows]


async def get_settings(db: AsyncSession, user_id: uuid.UUID) -> HuntSettings | None:
    return (
        await db.execute(select(HuntSettings).where(HuntSettings.user_id == user_id))
    ).scalar_one_or_none()


# ------------------------------------------------------------------------------ planning


async def plan(
    db: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    llm: LlmProvider,
    *,
    limit: int = 8,
    footer: bool = False,
) -> int:
    """Draft notes for the best-fitting researched startups this candidate has not met yet."""
    st = await get_settings(db, user_id)
    if st is None or not st.enabled or not st.regions or not st.roles:
        return 0
    if await paused(db, user_id):
        return 0
    backlog = (
        await db.execute(
            select(func.count())
            .select_from(HuntTarget)
            .where(HuntTarget.user_id == user_id, HuntTarget.status.in_(("drafted", "approved")))
        )
    ).scalar_one()
    room = min(limit, MAX_BACKLOG - backlog)
    if room <= 0:
        return 0
    row = await facts_mod.get(db, user_id)
    facts = row.data if row else None
    if not facts:
        return 0
    met = select(HuntTarget.startup_id).where(HuntTarget.user_id == user_id)
    startups = (
        (
            await db.execute(
                select(Startup).where(
                    Startup.status == "researched",
                    Startup.region.in_(st.regions),
                    Startup.id.not_in(met),
                )
            )
        )
        .scalars()
        .all()
    )
    ranked: list[tuple[int, list[str], Startup, StartupContact]] = []
    for s in startups:
        contacts = (
            (await db.execute(select(StartupContact).where(StartupContact.startup_id == s.id)))
            .scalars()
            .all()
        )
        usable = [
            c
            for c in contacts
            if policy.may_write_to(s.region, c.email, s.domain) is None
            and await suppressed(db, user_id, c.email) is None
        ]
        if not usable:
            continue
        pts, why = fit.score(st.roles, facts, s)
        floor = health.reach_floor(st.reach)
        if pts >= floor or fit.openings_for(st.roles, s):
            best = await _deliverable(db, usable, now)
            if best is None:
                continue  # none of its addresses can receive mail
            if pts < fit.MIN_FIT and not fit.openings_for(st.roles, s):
                why = [*why, "No matching opening yet: this note introduces you and asks."]
            ranked.append((pts, why, s, best))
    ranked.sort(key=lambda r: -r[0])
    made = 0
    for pts, why, s, c in ranked[:room]:
        found = fit.openings_for(st.roles, s)
        held: list[str] = []
        if _uses_template(st, "first"):
            subject, body, held = template.compose(
                st, s, c, "first", await template.hook(llm, facts, st, s)
            )
            if footer:
                body += "\n\n" + policy.footer(
                    s.region, st.sender_name, st.postal_address, c.source_url
                )
        else:
            subject, body = await draft.write(
                llm, facts, st, s, c, region=s.region, openings=found, why=why, footer=footer
            )
        db.add(
            HuntTarget(
                id=uuid.uuid4(),
                user_id=user_id,
                startup_id=s.id,
                contact_id=c.id,
                step=1,
                fit=pts,
                fit_reasons=why,
                openings=found,
                subject=subject,
                body=body,
                source="template" if _uses_template(st, "first") else "written",
                status="approved" if st.auto_send and not held else "drafted",
                reason=("Fill in: " + ", ".join(held))[:300] if held else None,
                created_at=now,
            )
        )
        made += 1
    await db.commit()
    return made


async def _deliverable(
    db: AsyncSession, usable: list[StartupContact], now: datetime
) -> StartupContact | None:
    """The best address of a startup that can receive mail: a named person first, then a hiring
    address, then a general one. A domain's answer is kept for 30 days."""
    for c in sorted(usable, key=lambda c: _KIND_RANK[c.kind]):
        fresh = c.mx_checked_at is not None and now - c.mx_checked_at < timedelta(days=30)
        if not fresh:
            c.mx_ok = await RESOLVER(policy.domain_of(c.email))
            c.mx_checked_at = now
        if c.mx_ok is not False:
            return c
    return None


async def redraft(
    db: AsyncSession, user_id: uuid.UUID, llm: LlmProvider, *, footer: bool = False
) -> int:
    """The candidate saved their own emails: every note still waiting for their review is written
    again from them, so what they approve is what they just saved. Approved, sent and closed notes
    are never touched."""
    st = await get_settings(db, user_id)
    if st is None or not st.use_template:
        return 0
    row = await facts_mod.get(db, user_id)
    facts = row.data if row else None
    waiting = (
        (
            await db.execute(
                select(HuntTarget).where(
                    HuntTarget.user_id == user_id, HuntTarget.status == "drafted"
                )
            )
        )
        .scalars()
        .all()
    )
    jobs: list[tuple[HuntTarget, Startup, StartupContact, str]] = []
    for t in waiting:
        which = "first" if t.step == 1 else "follow"
        startup = await db.get(Startup, t.startup_id)
        contact = await db.get(StartupContact, t.contact_id)
        if startup is None or contact is None or not _uses_template(st, which):
            continue
        jobs.append((t, startup, contact, which))
    gate = asyncio.Semaphore(6)

    async def hook_for(startup: Startup, which: str) -> str:
        if which != "first":
            return ""
        async with gate:
            return await template.hook(llm, facts, st, startup)

    hooks = await asyncio.gather(*(hook_for(s_, w) for _, s_, _, w in jobs))
    for (t, startup, contact, which), hook in zip(jobs, hooks, strict=True):
        subject, body, held = template.compose(
            st, startup, contact, which, hook, first_subject=t.subject if which != "first" else ""
        )
        if footer:
            body += "\n\n" + policy.footer(
                startup.region, st.sender_name, st.postal_address, contact.source_url
            )
        t.subject, t.body = subject, body
        t.reason = ("Fill in: " + ", ".join(held))[:300] if held else None
    await db.commit()
    return len(jobs)


def _uses_template(st: HuntSettings, which: str) -> bool:
    t = st.template or {}
    return bool(st.use_template and str(t.get(f"{which}_body") or "").strip())


async def plan_followups(
    db: AsyncSession, user_id: uuid.UUID, now: datetime, *, footer: bool = False
) -> int:
    """One short follow-up, five days after a note that nobody answered. Never a second."""
    st = await get_settings(db, user_id)
    if st is None or not st.enabled or not st.follow_up_enabled:
        return 0
    after = timedelta(days=min(max(st.follow_up_days, 1), 30))
    sent = (
        (
            await db.execute(
                select(HuntTarget).where(
                    HuntTarget.user_id == user_id,
                    HuntTarget.step == 1,
                    HuntTarget.status == "sent",
                    HuntTarget.sent_at <= now - after,
                )
            )
        )
        .scalars()
        .all()
    )
    made = 0
    for t in sent:
        again = (
            await db.execute(
                select(HuntTarget.id).where(
                    HuntTarget.user_id == user_id,
                    HuntTarget.contact_id == t.contact_id,
                    HuntTarget.step == 2,
                )
            )
        ).first()
        contact = await db.get(StartupContact, t.contact_id)
        startup = await db.get(Startup, t.startup_id)
        if again or contact is None or startup is None:
            continue
        if await suppressed(db, user_id, contact.email):
            continue
        sign = st.sender_name
        held: list[str] = []
        subject = "Re: " + t.subject[:290]
        if _uses_template(st, "follow"):
            subject, body, held = template.compose(
                st, startup, contact, "follow", "", first_subject=t.subject
            )
            if footer:
                body += "\n\n" + policy.footer(
                    startup.region, sign, st.postal_address, contact.source_url
                )
        else:
            body = (
                f"Hi again - a quick nudge on my note below in case it got buried. I would still "
                f"love to talk about a {(st.roles or ['role'])[0]} role at {startup.name}. If now "
                f"is not the time, no problem at all.\n\n{sign}"
            )
            if footer:
                body += "\n\n" + policy.footer(
                    startup.region, sign, st.postal_address, contact.source_url
                )
        db.add(
            HuntTarget(
                id=uuid.uuid4(),
                user_id=user_id,
                startup_id=t.startup_id,
                contact_id=t.contact_id,
                step=2,
                fit=t.fit,
                fit_reasons=t.fit_reasons,
                subject=subject,
                body=body,
                status="approved" if st.auto_send and not held else "drafted",
                reason=("Fill in: " + ", ".join(held))[:300] if held else None,
                created_at=now,
            )
        )
        made += 1
    await db.commit()
    return made


# ------------------------------------------------------------------------------ sending


def in_window(now: datetime, tz: str, start: int = 8, end: int = 18) -> bool:
    """Weekdays, within the hours the candidate chose (08:00-18:00 by default) where they are:
    notes should read like a person wrote them."""
    local = now.astimezone(clock.zone(tz))
    return local.weekday() < 5 and start <= local.hour < end


def window_of(st: HuntSettings) -> tuple[int, int]:
    a = min(max(st.window_start, 0), 23)
    return a, min(max(st.window_end, a + 1), 24)


def too_early(st: HuntSettings, now: datetime) -> bool:
    """The candidate asked for nothing to go out before a given time."""
    return st.send_not_before is not None and now < st.send_not_before


async def sent_today(db: AsyncSession, user_id: uuid.UUID, now: datetime, tz: str) -> int:
    start = clock.start_of_day(clock.local_day(now, tz), tz)
    return (
        await db.execute(
            select(func.count())
            .select_from(HuntTarget)
            .where(
                HuntTarget.user_id == user_id,
                HuntTarget.status.in_(("sending", "sent", "replied", "declined")),
                HuntTarget.claimed_at >= start,
            )
        )
    ).scalar_one()


async def stats(
    db: AsyncSession, user_id: uuid.UUID, st: HuntSettings, now: datetime
) -> dict[str, Any]:
    """How sending has gone lately: what counts is the last 30 days, and only what happened after
    the person last turned sending back on."""
    since = now - health.WINDOW
    if st.health_since is not None and st.health_since > since:
        since = st.health_since
    rows = (
        await db.execute(
            select(HuntTarget.sent_at, HuntTarget.reply_kind, HuntTarget.status).where(
                HuntTarget.user_id == user_id, HuntTarget.sent_at.is_not(None)
            )
        )
    ).all()
    sent_at = [(r[0], r[1]) for r in rows if r[0] is not None]
    first = min((a for a, _ in sent_at), default=None)
    recent = [(a, k) for a, k in sent_at if a >= since]
    return {
        "sent": len(recent),
        "bounced": sum(1 for _, k in recent if k == "bounce"),
        "optouts": sum(1 for _, k in recent if k == "optout"),
        "first_sent": first,
    }


async def effective_cap(
    db: AsyncSession, user_id: uuid.UUID, st: HuntSettings, now: datetime
) -> int:
    h = await stats(db, user_id, st, now)
    return health.daily_cap(st, h["first_sent"], now, h["sent"], h["bounced"], MAX_DAILY)


async def evaluate_pause(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> str | None:
    """Stop sending when bounces or "please stop" replies pass the line. Returns the reason."""
    st = await get_settings(db, user_id)
    if st is None or not st.enabled or st.auto_paused_at is not None:
        return None
    h = await stats(db, user_id, st, now)
    why = health.pause_reason(h["sent"], h["bounced"], h["optouts"])
    if why is None:
        return None
    st.auto_paused_at, st.auto_pause_reason = now, why[:300]
    await db.commit()
    log.warning("startup sending paused", extra={"user_id": str(user_id), "why": health.explain(h)})
    return why


async def resume(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
    """The person turns sending back on: what happened before now no longer counts against it."""
    st = await get_settings(db, user_id)
    if st is None or st.auto_paused_at is None:
        return False
    st.auto_paused_at, st.auto_pause_reason, st.health_since = None, None, now
    await db.commit()
    return True


def cv_filename(name: str) -> str:
    """'Ada Lovelace - CV.pdf': a name a hiring manager can file, with nothing odd in it."""
    clean = re.sub(r"[^A-Za-z0-9 .'-]", "", name or "").strip()
    return f"{clean} - CV.pdf" if clean else "CV.pdf"


async def delivery_blockers(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    adapter: MailboxAdapter,
    settings: Settings,
    now: datetime,
) -> dict[str, Any]:
    """Why approved notes are not going out right now: read-only, in the order a person can fix
    them. The same gates send_next applies, said in words, so nothing is held back in silence.
    Returns {"approved": n, "blockers": [{"code", "text", "where"}]}; no blockers means a note
    goes in the next pass."""
    out: list[dict[str, str]] = []

    def add(code: str, text: str, where: str = "") -> None:
        out.append({"code": code, "text": text, "where": where})

    async with maker() as db:
        approved = (
            await db.execute(
                select(func.count())
                .select_from(HuntTarget)
                .where(HuntTarget.user_id == user_id, HuntTarget.status == "approved")
            )
        ).scalar_one()
        if approved == 0:
            return {"approved": 0, "blockers": []}
        st = await get_settings(db, user_id)
        conn = await mailbox.get(db, user_id)
        off = await switches.active(db)
        prof = (
            await db.execute(select(SearchProfile).where(SearchProfile.user_id == user_id))
        ).scalar_one_or_none()
        tz = prof.timezone if prof else "UTC"
        if st is None or not st.enabled:
            add("off", "Startup outreach is switched off. Turn it on under Set up.", "setup")
        if st is not None and not st.sender_name.strip():
            add("name", "Add the name your notes are signed with, under Set up.", "setup")
        if st is not None and settings.startup_outreach_footer and not st.postal_address.strip():
            add(
                "address",
                "Add a postal address under Set up. Commercial email must carry one.",
                "setup",
            )
        if conn is None or not conn.token_encrypted:
            add(
                "mailbox",
                "Connect your email in Settings: notes go from your own address.",
                "email",
            )
        elif conn.status != "connected":
            add("reauth", "Your email needs to be connected again, in Settings.", "email")
        if (why := switches.blocked(off, "hunt", adapter.name)) is not None:
            add("switch", f"Sending is paused by the operator ({why}).")
        if bool(prof and prof.paused):
            add("paused", "Auto-Apply is paused, which pauses startup notes too. Resume it.")
        if not settings.startup_outreach_dispatch and adapter.real:
            add(
                "server",
                "Real sending is switched off on this server (STARTUP_OUTREACH_DISPATCH).",
            )
        elif (
            adapter.real
            and settings.environment != "production"
            and not settings.startup_outreach_any_recipient
        ):
            add(
                "allowlist",
                "This server is not in production, so it only sends to addresses on its test list "
                "(AUTOAPPLY_ALLOWED_RECIPIENTS). To let it write to real startups, the operator "
                "sets STARTUP_OUTREACH_ANY_RECIPIENT=true.",
            )
        if st is not None and st.auto_paused_at is not None:
            add("auto_paused", st.auto_pause_reason or "Sending stopped by itself.", "sent")
        if st is not None and st.enabled and too_early(st, now):
            add("not_yet", "You asked for nothing to go out before the start time you set.")
        a, b = window_of(st) if st is not None else (8, 18)
        if st is not None and st.enabled and not in_window(now, tz, a, b):
            add(
                "window",
                f"Notes go out on weekdays between {a:02d}:00 and {b:02d}:00 ({tz}). It is "
                "outside that now, so the next one goes in the next window.",
            )
        if st is not None:
            cap = await effective_cap(db, user_id, st, now)
            if await sent_today(db, user_id, now, tz) >= cap:
                add(
                    "cap",
                    f"Today's limit of {cap} is reached. It starts low and rises over your "
                    "first three weeks. The next note goes tomorrow.",
                )
        last = (
            await db.execute(
                select(func.max(HuntTarget.claimed_at)).where(HuntTarget.user_id == user_id)
            )
        ).scalar_one()
        if last is not None and now - last < MIN_GAP:
            add("gap", "A short gap is kept between notes. The next goes in a minute.")
    return {"approved": int(approved), "blockers": out}


def _log_held(user_id: uuid.UUID, why: str) -> None:
    log.info("startup note held back", extra={"user_id": str(user_id), "why": why})


async def _has_approved(db: AsyncSession, user_id: uuid.UUID) -> bool:
    row = await db.execute(
        select(HuntTarget.id)
        .where(HuntTarget.user_id == user_id, HuntTarget.status == "approved")
        .limit(1)
    )
    return row.first() is not None


async def send_next(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    adapter: MailboxAdapter,
    settings: Settings,
    now: datetime,
) -> str | None:
    """Send at most one approved note. Returns 'sent', 'ambiguous', 'failed' or None."""
    async with maker() as db:
        st = await get_settings(db, user_id)
        conn = await mailbox.get(db, user_id)
        off = await switches.active(db)
        prof = (
            await db.execute(select(SearchProfile).where(SearchProfile.user_id == user_id))
        ).scalar_one_or_none()
        tz = prof.timezone if prof else "UTC"
        gate = None
        if st is None or not st.enabled:
            gate = "outreach_off"
        elif not st.sender_name.strip():
            gate = "no_sender_name"
        elif settings.startup_outreach_footer and not st.postal_address.strip():
            gate = "no_postal_address"
        elif switches.blocked(off, "hunt", adapter.name) is not None:
            gate = "switched_off"
        elif conn is None or conn.status != "connected" or not conn.token_encrypted:
            gate = "mailbox_not_connected"
        elif prof and prof.paused:
            gate = "paused"
        elif st.auto_paused_at is not None:
            gate = "auto_paused"
        elif too_early(st, now):
            gate = "not_yet"
        elif not in_window(now, tz, *window_of(st)):
            gate = "outside_send_hours"
        elif await sent_today(db, user_id, now, tz) >= await effective_cap(db, user_id, st, now):
            gate = "daily_cap_reached"
        if gate is not None:
            if await _has_approved(db, user_id):
                _log_held(user_id, gate)
            return None
        assert st is not None and conn is not None  # the gates above stop when either is missing
        last = (
            await db.execute(
                select(func.max(HuntTarget.claimed_at)).where(HuntTarget.user_id == user_id)
            )
        ).scalar_one()
        if last is not None and now - last < MIN_GAP:
            return None
        rows = (
            (
                await db.execute(
                    select(HuntTarget)
                    .where(HuntTarget.user_id == user_id, HuntTarget.status == "approved")
                    .order_by(HuntTarget.step.desc(), HuntTarget.fit.desc())
                    .with_for_update(skip_locked=True)
                    .limit(5)
                )
            )
            .scalars()
            .all()
        )
        chosen: HuntTarget | None = None
        to = ""
        for t in rows:
            contact = await db.get(StartupContact, t.contact_id)
            startup = await db.get(Startup, t.startup_id)
            if contact is None or startup is None:
                t.status, t.reason = "skipped", "The contact no longer exists."
                continue
            if template.has_placeholder(t.subject) or template.has_placeholder(t.body):
                t.status, t.reason = "drafted", "It still has a {{variable}} to fill in."
                continue
            why = policy.may_write_to(startup.region, contact.email, startup.domain)
            why = why or (
                "This address asked not to be written to."
                if await suppressed(db, user_id, contact.email)
                else None
            )
            if why or startup.region not in st.regions:
                t.status, t.reason = "skipped", why or "Outside the regions you chose."
                continue
            if not outbox.dispatch_allowed(settings, "hunt", adapter.real, contact.email):
                _log_held(user_id, "recipient_not_allowed_in_this_environment")
                continue
            chosen, to = t, contact.email
            break
        if chosen is None:
            await db.commit()
            return None
        chosen.status, chosen.claimed_at = "sending", now
        chosen.message_id = outbox.message_id(f"hunt:{chosen.id}:{chosen.step}")
        token = mailbox.token(settings, conn)
        sender, body, mid = conn.address, chosen.body, chosen.message_id
        subject = " ".join(chosen.subject.split())  # never a line break in a header
        tid = chosen.id
        cv_text = ((await NotesRepo(db, user_id).get()) or Note()).content or ""
        sign = st.sender_name
        await db.commit()
    # the candidate's CV goes with every note, as a PDF made from the CV text they confirmed
    attachments = (
        [MailAttachment(cv_filename(sign), cvfile.render_pdf(cv_text))] if cv_text.strip() else []
    )
    error: AdapterError | None = None
    thread = None
    try:
        sent = await adapter.send(
            token,
            sender=sender,
            to=to,
            subject=subject,
            body=body,
            attachments=attachments,
            message_id=mid,
        )
        thread = sent.thread_id
    except AdapterError as exc:
        error = exc
    except Exception:  # noqa: BLE001
        error = AdapterError("ambiguous", "The send did not finish cleanly.")
    async with maker() as db:
        done = await db.get(HuntTarget, tid, with_for_update=True)
        assert done is not None
        t = done
        if error is None:
            t.status, t.sent_at, t.thread_id = "sent", now, thread
            await db.commit()
            await record_from(db, "hunt.sent", user_id=user_id)
            log.info("startup note sent", extra={"user_id": str(user_id), "target": str(tid)})
            return "sent"
        if error.code == "ambiguous":
            await db.commit()  # stays 'sending'; reconcile() settles it
            log.warning(
                "startup note send unclear", extra={"user_id": str(user_id), "target": str(tid)}
            )
            return "ambiguous"
        t.status, t.reason = "failed", error.message[:300]
        log.warning(
            "startup note failed",
            extra={"user_id": str(user_id), "target": str(tid), "code": error.code},
        )
        if error.code == "reauth":
            c = await mailbox.get(db, user_id)
            if c is not None:
                await mailbox.mark_reauth(db, c)
        await db.commit()
        return "failed"


async def reconcile(
    maker: async_sessionmaker[AsyncSession],
    adapter: MailboxAdapter,
    settings: Settings,
    now: datetime,
) -> int:
    """A note whose send never reported back: look in the mailbox for its Message-ID. Found means
    it went; not found means it can safely be tried again."""
    settled = 0
    async with maker() as db:
        stuck = (
            (
                await db.execute(
                    select(HuntTarget).where(
                        HuntTarget.status == "sending", HuntTarget.claimed_at <= now - STALE_CLAIM
                    )
                )
            )
            .scalars()
            .all()
        )
        for t in stuck:
            conn = await mailbox.get(db, t.user_id)
            if conn is None or conn.status != "connected" or not t.message_id:
                t.status, t.reason = "failed", "The mailbox was not available to confirm it."
                continue
            try:
                found = await adapter.find_sent(mailbox.token(settings, conn), t.message_id)
            except AdapterError:
                continue
            if found is not None:
                t.status, t.sent_at, t.thread_id = "sent", now, found.thread_id
            else:
                t.status = "approved"
            settled += 1
        await db.commit()
    return settled


# ------------------------------------------------------------------------------ replies

_ADDR = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


async def on_inbound(
    db: AsyncSession, user_id: uuid.UUID, msg: InboundMessage, now: datetime
) -> str | None:
    """Look at one message from the candidate's mailbox. Returns 'replied', 'declined',
    'bounced' or None when it has nothing to do with startup outreach."""
    sender = parseaddr(msg.from_addr)[1].lower()
    targets = (
        await db.execute(
            select(HuntTarget, StartupContact)
            .join(StartupContact, StartupContact.id == HuntTarget.contact_id)
            .where(HuntTarget.user_id == user_id, HuntTarget.status.in_(("sent", "replied")))
        )
    ).all()
    if not targets:
        return None
    if policy.is_bounce(msg.from_addr, msg.subject):
        addrs = {a.lower() for a in _ADDR.findall(f"{msg.subject} {msg.snippet}")}
        hit = [(t, c) for t, c in targets if c.email in addrs or t.message_id == msg.in_reply_to]
        for t, c in hit:
            t.status, t.reason = "failed", "The address bounced."
            t.reply_kind, t.replied_at = "bounce", now
            await suppress(db, user_id=None, email=c.email, reason="bounce", now=now)
        return "bounced" if hit else None
    mine = [
        (t, c)
        for t, c in targets
        if c.email == sender or (msg.in_reply_to and t.message_id == msg.in_reply_to)
    ]
    if not mine:
        return None
    optout = policy.is_opt_out(f"{msg.subject} {msg.snippet}")
    kind = "optout" if optout else health.reply_kind(f"{msg.subject} {msg.snippet}")
    for t, c in mine:
        t.status = "declined" if optout else "replied"
        t.reply_kind, t.replied_at = kind, now
        if optout:
            await suppress(
                db, user_id=user_id, email=c.email, domain=policy.domain_of(c.email),
                reason="declined", now=now,
            )  # fmt: skip
        pending = (
            (
                await db.execute(
                    select(HuntTarget).where(
                        HuntTarget.user_id == user_id,
                        HuntTarget.contact_id == t.contact_id,
                        HuntTarget.status.in_(("drafted", "approved")),
                    )
                )
            )
            .scalars()
            .all()
        )
        for p in pending:  # a person answered: no follow-up
            p.status, p.reason = "skipped", "They already replied."
    return "declined" if optout else "replied"


async def tick_user(
    maker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    adapter: MailboxAdapter,
    settings: Settings,
    llm: LlmProvider,
    now: datetime,
) -> dict[str, Any]:
    async with maker() as db:
        footer = settings.startup_outreach_footer
        drafted = await plan(db, user_id, now, llm, footer=footer)
        followups = await plan_followups(db, user_id, now, footer=footer)
        await evaluate_pause(db, user_id, now)
    sent = await send_next(maker, user_id, adapter, settings, now)
    return {"drafted": drafted, "followups": followups, "sent": sent}
