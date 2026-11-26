"""Support: people write to the team from any app, and staff answer in the back office.

A ticket is one thread. The person sees their own messages and the team's replies; staff also see
private notes. Nothing here reads CVs or interview content: only what the person writes."""

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user, get_notifier, require_admin
from app.errors import ApiError
from app.models import SupportMessage, SupportTicket, User
from app.routers.admin import get_admin_db
from app.schemas.support import (
    AdminMessageOut,
    AdminTicketDetailOut,
    AdminTicketListOut,
    AdminTicketOut,
    MessageIn,
    MessageOut,
    StatusIn,
    TicketContext,
    TicketDetailOut,
    TicketIn,
    TicketListOut,
    TicketOut,
    UnreadOut,
)
from app.services.events import record_from
from app.services.notify import Notifier

router = APIRouter(prefix="/api/support", tags=["support"])
admin_router = APIRouter(prefix="/api/admin/support", tags=["admin"])

MAX_NEW_PER_DAY = 5  # new threads one person may open in a day
MAX_MESSAGES = 200  # in one thread
STATUSES = ("open", "answered", "resolved", "closed")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_NOW = lambda: datetime.now(UTC)  # noqa: E731


def _clean(text: str) -> str:
    return _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _preview(text: str, n: int = 90) -> str:
    one = " ".join(text.split())
    return one if len(one) <= n else one[: n - 1].rstrip() + "…"


def _route_only(page: str) -> str:
    """The page the person was on, without a query or fragment (which can hold tokens)."""
    return page.split("?")[0].split("#")[0][:120]


async def _last_bodies(
    db: AsyncSession, ids: list[uuid.UUID], *, staff: bool
) -> dict[uuid.UUID, tuple[str, int]]:
    """The newest message each thread shows, and how many it has."""
    if not ids:
        return {}
    q = select(SupportMessage.ticket_id, SupportMessage.body, SupportMessage.created_at).where(
        SupportMessage.ticket_id.in_(ids)
    )
    if not staff:
        q = q.where(SupportMessage.kind != "note")
    rows = (await db.execute(q.order_by(SupportMessage.created_at))).all()
    out: dict[uuid.UUID, tuple[str, int]] = {}
    for tid, body, _ in rows:
        out[tid] = (body, out.get(tid, ("", 0))[1] + 1)
    return out


def _out(t: SupportTicket, last: str) -> TicketOut:
    return TicketOut(
        id=t.id,
        subject=t.subject,
        category=t.category,
        status=t.status,
        unread=t.unread_for_user,
        created_at=t.created_at,
        updated_at=t.updated_at,
        last_message=_preview(last),
    )


async def _mine(db: AsyncSession, user: User, ticket_id: str) -> SupportTicket:
    try:
        key = uuid.UUID(ticket_id)
    except ValueError:
        raise ApiError(404, "not_found", "Not found.") from None
    t = (
        await db.execute(
            select(SupportTicket).where(SupportTicket.id == key, SupportTicket.user_id == user.id)
        )
    ).scalar_one_or_none()
    if t is None:
        raise ApiError(404, "not_found", "Not found.")  # never says whether it exists
    return t


async def _thread(db: AsyncSession, ticket_id: uuid.UUID) -> list[SupportMessage]:
    return list(
        (
            await db.execute(
                select(SupportMessage)
                .where(SupportMessage.ticket_id == ticket_id)
                .order_by(SupportMessage.created_at, SupportMessage.id)
            )
        )
        .scalars()
        .all()
    )


# --------------------------------------------------------------------------------- the person


@router.get("/tickets")
async def my_tickets(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> TicketListOut:
    rows = list(
        (
            await db.execute(
                select(SupportTicket)
                .where(SupportTicket.user_id == user.id)
                .order_by(SupportTicket.updated_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )
    last = await _last_bodies(db, [t.id for t in rows], staff=False)
    return TicketListOut(items=[_out(t, last.get(t.id, ("", 0))[0]) for t in rows])


@router.get("/unread")
async def unread(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> UnreadOut:
    n = (
        await db.execute(
            select(func.count())
            .select_from(SupportTicket)
            .where(SupportTicket.user_id == user.id, SupportTicket.unread_for_user.is_(True))
        )
    ).scalar_one()
    return UnreadOut(count=int(n))


@router.post("/tickets", status_code=201)
async def open_ticket(
    body: TicketIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> TicketDetailOut:
    since = _NOW() - timedelta(days=1)
    recent = (
        await db.execute(
            select(func.count())
            .select_from(SupportTicket)
            .where(SupportTicket.user_id == user.id, SupportTicket.created_at >= since)
        )
    ).scalar_one()
    if recent >= MAX_NEW_PER_DAY:
        raise ApiError(
            429,
            "too_many_requests",
            "You have sent several messages today. Add to one of them, or write again tomorrow.",
        )
    text = _clean(body.body)
    subject = " ".join(_clean(body.subject).split())
    if len(text) < 3 or len(subject) < 3:
        raise ApiError(422, "invalid", "Please write a few words.")
    ctx: dict[str, Any] | None = None
    if body.context is not None:
        c: TicketContext = body.context
        ctx = {
            "platform": c.platform[:20],
            "app_version": c.app_version[:30],
            "page": _route_only(c.page),
        }
    now = _NOW()
    t = SupportTicket(
        user_id=user.id,
        subject=subject[:160],
        category=body.category,
        status="open",
        context=ctx,
        unread_for_user=False,
        unread_for_staff=True,
        created_at=now,
        updated_at=now,
    )
    db.add(t)
    await db.flush()
    db.add(
        SupportMessage(ticket_id=t.id, kind="user", author_id=user.id, body=text, created_at=now)
    )
    await db.commit()
    await record_from(db, "support.opened", user_id=user.id, category=body.category)
    await notifier.support_opened(t.id)
    return await _detail(db, t)


async def _detail(db: AsyncSession, t: SupportTicket) -> TicketDetailOut:
    msgs = [m for m in await _thread(db, t.id) if m.kind != "note"]
    return TicketDetailOut(
        **_out(t, msgs[-1].body if msgs else "").model_dump(),
        messages=[
            MessageOut(
                id=m.id,
                kind=m.kind,  # type: ignore[arg-type]
                author="You" if m.kind == "user" else "Support team",
                body=m.body,
                created_at=m.created_at,
            )
            for m in msgs
        ],
    )


@router.get("/tickets/{ticket_id}")
async def my_ticket(
    ticket_id: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> TicketDetailOut:
    t = await _mine(db, user, ticket_id)
    if t.unread_for_user:
        t.unread_for_user = False
        await db.commit()
    return await _detail(db, t)


@router.post("/tickets/{ticket_id}/messages", status_code=201)
async def reply(
    ticket_id: str,
    body: MessageIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> TicketDetailOut:
    t = await _mine(db, user, ticket_id)
    text = _clean(body.body)
    if not text:
        raise ApiError(422, "invalid", "Please write a few words.")
    count = (
        await db.execute(
            select(func.count()).select_from(SupportMessage).where(SupportMessage.ticket_id == t.id)
        )
    ).scalar_one()
    if count >= MAX_MESSAGES:
        raise ApiError(409, "thread_full", "This conversation is full. Start a new one.")
    now = _NOW()
    reopened = t.status in ("resolved", "closed")
    db.add(
        SupportMessage(ticket_id=t.id, kind="user", author_id=user.id, body=text, created_at=now)
    )
    t.status, t.updated_at, t.unread_for_staff, t.resolved_at = "open", now, True, None
    await db.commit()
    await record_from(db, "support.user_replied", user_id=user.id, reopened=reopened)
    if reopened:
        await notifier.support_opened(t.id)  # a closed one coming back should be seen
    return await _detail(db, t)


@router.post("/tickets/{ticket_id}/resolve")
async def mark_resolved(
    ticket_id: str,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> TicketDetailOut:
    """The person says it is sorted out."""
    t = await _mine(db, user, ticket_id)
    if t.status != "closed":
        t.status, t.resolved_at, t.updated_at = "resolved", _NOW(), _NOW()
        await db.commit()
        await record_from(db, "support.status", user_id=user.id, status="resolved", by="person")
    return await _detail(db, t)


# ------------------------------------------------------------------------------------ back office


def _admin_out(t: SupportTicket, u: User, last: str, count: int) -> AdminTicketOut:
    return AdminTicketOut(
        id=t.id,
        subject=t.subject,
        category=t.category,
        status=t.status,
        unread=t.unread_for_staff,
        user_id=u.id,
        user_email=u.email,
        user_name=u.full_name,
        platform=str((t.context or {}).get("platform") or ""),
        created_at=t.created_at,
        updated_at=t.updated_at,
        last_message=_preview(last),
        messages=count,
    )


@admin_router.get("")
async def admin_list(
    status: str = "",
    q: str = "",
    staff: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> AdminTicketListOut:
    del staff
    counts_rows = (
        await db.execute(select(SupportTicket.status, func.count()).group_by(SupportTicket.status))
    ).all()
    counts = {s: 0 for s in STATUSES}
    counts.update({s: int(n) for s, n in counts_rows})
    query = select(SupportTicket, User).join(User, User.id == SupportTicket.user_id)
    if status in STATUSES:
        query = query.where(SupportTicket.status == status)
    needle = q.strip()[:80]
    if needle:
        like = f"%{needle.replace('%', '').replace('_', '')}%"
        query = query.where(or_(SupportTicket.subject.ilike(like), User.email.ilike(like)))
    rows = (
        await db.execute(
            query.order_by(
                SupportTicket.unread_for_staff.desc(), SupportTicket.updated_at.desc()
            ).limit(200)
        )
    ).all()
    last = await _last_bodies(db, [t.id for t, _ in rows], staff=True)
    return AdminTicketListOut(
        items=[_admin_out(t, u, *last.get(t.id, ("", 0))) for t, u in rows], counts=counts
    )


async def _admin_ticket(db: AsyncSession, ticket_id: str) -> tuple[SupportTicket, User]:
    try:
        key = uuid.UUID(ticket_id)
    except ValueError:
        raise ApiError(404, "not_found", "Not found.") from None
    row = (
        await db.execute(
            select(SupportTicket, User)
            .join(User, User.id == SupportTicket.user_id)
            .where(SupportTicket.id == key)
        )
    ).first()
    if row is None:
        raise ApiError(404, "not_found", "Not found.")
    return row[0], row[1]


async def _admin_detail(db: AsyncSession, t: SupportTicket, u: User) -> AdminTicketDetailOut:
    thread = await _thread(db, t.id)
    ids = {m.author_id for m in thread if m.author_id and m.kind != "user"}
    names: dict[uuid.UUID, str] = {}
    if ids:
        for uid, email, name in (
            await db.execute(select(User.id, User.email, User.full_name).where(User.id.in_(ids)))
        ).all():
            names[uid] = name or email
    assignee = None
    if t.assigned_to:
        row = (
            await db.execute(select(User.email, User.full_name).where(User.id == t.assigned_to))
        ).first()
        assignee = (row[1] or row[0]) if row else None
    base = _admin_out(t, u, thread[-1].body if thread else "", len(thread))
    c = t.context or {}
    return AdminTicketDetailOut(
        **base.model_dump(),
        context=TicketContext(
            platform=str(c.get("platform") or ""),
            app_version=str(c.get("app_version") or ""),
            page=str(c.get("page") or ""),
        )
        if c
        else None,
        user_joined=u.created_at,
        assigned_to=assignee,
        thread=[
            AdminMessageOut(
                id=m.id,
                kind=m.kind,  # type: ignore[arg-type]
                author=u.full_name or u.email
                if m.kind == "user"
                else names.get(m.author_id, "Support team")
                if m.author_id
                else "Support team",
                body=m.body,
                created_at=m.created_at,
            )
            for m in thread
        ],
    )


@admin_router.get("/{ticket_id}")
async def admin_ticket(
    ticket_id: str,
    staff: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> AdminTicketDetailOut:
    del staff
    t, u = await _admin_ticket(db, ticket_id)
    if t.unread_for_staff:
        t.unread_for_staff = False
        await db.commit()
    return await _admin_detail(db, t, u)


@admin_router.post("/{ticket_id}/reply", status_code=201)
async def admin_reply(
    ticket_id: str,
    body: MessageIn,
    staff: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> AdminTicketDetailOut:
    t, u = await _admin_ticket(db, ticket_id)
    text = _clean(body.body)
    if not text:
        raise ApiError(422, "invalid", "Write a reply first.")
    now = _NOW()
    db.add(
        SupportMessage(ticket_id=t.id, kind="staff", author_id=staff.id, body=text, created_at=now)
    )
    t.status, t.updated_at, t.unread_for_user, t.unread_for_staff = "answered", now, True, False
    t.resolved_at = None
    if t.assigned_to is None:
        t.assigned_to = staff.id
    await db.commit()
    await record_from(db, "support.staff_replied", user_id=u.id, actor_id=staff.id)
    await notifier.support_replied(t.id, text)
    return await _admin_detail(db, t, u)


@admin_router.post("/{ticket_id}/note", status_code=201)
async def admin_note(
    ticket_id: str,
    body: MessageIn,
    staff: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> AdminTicketDetailOut:
    """A private note for the team. The person never sees it and is not emailed."""
    t, u = await _admin_ticket(db, ticket_id)
    text = _clean(body.body)
    if not text:
        raise ApiError(422, "invalid", "Write a note first.")
    db.add(
        SupportMessage(
            ticket_id=t.id, kind="note", author_id=staff.id, body=text, created_at=_NOW()
        )
    )
    await db.commit()
    return await _admin_detail(db, t, u)


@admin_router.post("/{ticket_id}/status")
async def admin_status(
    ticket_id: str,
    body: StatusIn,
    staff: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_admin_db),  # noqa: B008
) -> AdminTicketDetailOut:
    t, u = await _admin_ticket(db, ticket_id)
    if t.status != body.status:
        t.status, t.updated_at = body.status, _NOW()
        t.resolved_at = _NOW() if body.status in ("resolved", "closed") else None
        if body.status in ("resolved", "closed"):
            t.unread_for_staff = False
        await db.commit()
        await record_from(
            db, "support.status", user_id=u.id, actor_id=staff.id, status=body.status, by="staff"
        )
    return await _admin_detail(db, t, u)
