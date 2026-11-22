"""The numbers behind the admin console: product health, the activation funnel, acquisition by
channel, referral quality, answer quality, and email delivery. Everything is a count, a rate or a
plain fact about accounts and activity. Nothing here reads a CV, a transcript or an answer."""

import statistics
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Select, and_, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Company,
    Event,
    Note,
    PracticeSession,
    Referral,
    ResearchJob,
    Score,
    SessionCredit,
    Suggestion,
    User,
)
from app.schemas.admin import (
    ActivityItem,
    ActivityOut,
    ChannelRow,
    CreditBreakdown,
    EmailKindRow,
    EmailLogItem,
    EmailsOut,
    FunnelStep,
    HealthCounts,
    HeldRow,
    LatencyOut,
    MarketingOut,
    OverviewOut,
    QualityOut,
    ReferralsOut,
    ReferrerRow,
    SeriesPoint,
    TimelineItem,
    UserDetailOut,
    UserListOut,
    UserRow,
)
from app.services.email_templates import CATALOG
from app.services.events import EVENT_KINDS

ACTIVE_KINDS = ("user.signed_in", "user.signed_up", "session.started")


def _now() -> datetime:
    return datetime.now(UTC)


def _pct(part: int | float, whole: int | float) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


async def _count(db: AsyncSession, q: Select[Any]) -> int:
    return int((await db.execute(q)).scalar_one() or 0)


def label_of(kind: str) -> tuple[str, str]:
    category, label = EVENT_KINDS.get(kind, ("other", kind))
    return category, label


def describe(kind: str, data: dict[str, Any]) -> str:
    """A short plain line about an event, from its few facts."""
    if kind.startswith("email."):
        return f"{data.get('email_kind', 'email')} to {data.get('to', '?')}"
    if kind == "session.ended":
        secs = int(data.get("seconds") or 0)
        return f"{secs // 60} min {secs % 60} s, {data.get('questions', 0)} answers"
    if kind == "session.started":
        return f"used a {data.get('credit', '?')} credit"
    if kind in ("user.signed_up", "user.signed_in"):
        bits = [str(data.get("method", ""))]
        bits += [f"{k[4:]}={v}" for k, v in data.items() if k.startswith("utm_")]
        if data.get("referred"):
            bits.append("invited")
        return ", ".join(b for b in bits if b)
    if kind == "auth.login_failed":
        return str(data.get("email", ""))
    if kind == "admin.credit_granted":
        reason = data.get("reason") or "no reason"
        return f"{data.get('count', '?')} to {data.get('to', '?')}: {reason}"
    if kind.startswith("onboarding."):
        return ", ".join(f"{k}={v}" for k, v in data.items() if v not in (None, [], ""))
    skip = {"session_id", "company_id", "friend_id"}
    return ", ".join(
        f"{k}={v}" for k, v in data.items() if k not in skip and not isinstance(v, (dict, list))
    )


# ------------------------------------------------------------------------------------- overview


async def _active_users(db: AsyncSession, within: timedelta) -> int:
    return await _count(
        db,
        select(func.count(distinct(Event.user_id))).where(
            Event.kind.in_(ACTIVE_KINDS),
            Event.user_id.is_not(None),
            Event.created_at >= _now() - within,
        ),
    )


async def overview(db: AsyncSession, days: int) -> OverviewOut:
    now = _now()
    since, prev = now - timedelta(days=days), now - timedelta(days=2 * days)

    total = await _count(db, select(func.count()).select_from(User))
    new = await _count(db, select(func.count()).select_from(User).where(User.created_at >= since))
    new_prev = await _count(
        db,
        select(func.count())
        .select_from(User)
        .where(User.created_at >= prev, User.created_at < since),
    )
    n_sessions = await _count(
        db,
        select(func.count())
        .select_from(PracticeSession)
        .where(PracticeSession.started_at >= since),
    )
    sessions_prev = await _count(
        db,
        select(func.count())
        .select_from(PracticeSession)
        .where(PracticeSession.started_at >= prev, PracticeSession.started_at < since),
    )
    avg_secs = (
        await db.execute(
            select(
                func.avg(
                    func.extract("epoch", PracticeSession.ended_at - PracticeSession.started_at)
                )
            ).where(PracticeSession.started_at >= since, PracticeSession.ended_at.is_not(None))
        )
    ).scalar_one()
    per_session = (
        select(Suggestion.session_id.label("sid"), func.count().label("n"))
        .group_by(Suggestion.session_id)
        .subquery()
    )
    avg_q = (
        await db.execute(
            select(func.avg(func.coalesce(per_session.c.n, 0)))
            .select_from(PracticeSession)
            .outerjoin(per_session, per_session.c.sid == PracticeSession.id)
            .where(PracticeSession.started_at >= since)
        )
    ).scalar_one()

    # the funnel follows the people who signed up in the window
    cohort = select(User.id).where(User.created_at >= since)
    cohort_n = new
    step_counts: list[tuple[str, str, int]] = [
        ("signed_up", "Signed up", cohort_n),
        (
            "onboarded",
            "Finished onboarding",
            await _count(
                db,
                select(func.count())
                .select_from(User)
                .where(User.created_at >= since, User.onboarded_at.is_not(None)),
            ),
        ),
        (
            "cv",
            "Uploaded a CV",
            await _count(
                db,
                select(func.count(distinct(Note.user_id))).where(
                    Note.user_id.in_(cohort), Note.content != ""
                ),
            ),
        ),
        (
            "company",
            "Added the company interviewing them",
            await _count(
                db, select(func.count(distinct(Company.user_id))).where(Company.user_id.in_(cohort))
            ),
        ),
        (
            "session",
            "Ran a first interview",
            await _count(
                db,
                select(func.count(distinct(PracticeSession.user_id))).where(
                    PracticeSession.user_id.in_(cohort)
                ),
            ),
        ),
    ]
    twice = (
        select(PracticeSession.user_id)
        .where(PracticeSession.user_id.in_(cohort))
        .group_by(PracticeSession.user_id)
        .having(func.count() >= 2)
        .subquery()
    )
    step_counts.append(
        (
            "second",
            "Ran a second interview",
            await _count(db, select(func.count()).select_from(twice)),
        )
    )
    funnel: list[FunnelStep] = []
    for i, (key, label, n) in enumerate(step_counts):
        before = step_counts[i - 1][2] if i else None
        funnel.append(
            FunnelStep(
                key=key,
                label=label,
                users=n,
                of_signups_pct=_pct(n, cohort_n),
                from_previous_pct=_pct(n, before) if before is not None and i else None,
            )
        )

    series = await _series(db, days)
    health = HealthCounts(
        research_failed_24h=await _events(db, "research.failed", timedelta(hours=24)),
        scoring_failed_24h=await _events(db, "scoring.failed", timedelta(hours=24)),
        emails_failed_24h=await _events(db, "email.failed", timedelta(hours=24)),
        blocked_no_credit_7d=await _events(db, "session.blocked", timedelta(days=7)),
        wrong_passwords_24h=await _events(db, "auth.login_failed", timedelta(hours=24)),
    )
    held = await _count(
        db, select(func.count()).select_from(Referral).where(Referral.status == "held")
    )
    counted = await _count(
        db, select(func.count()).select_from(Referral).where(Referral.status == "counted")
    )
    redeemed = await _count(
        db, select(func.count()).select_from(SessionCredit).where(SessionCredit.kind == "referral")
    )
    return OverviewOut(
        days=days,
        total_users=total,
        new_users=new,
        new_users_prev=new_prev,
        dau=await _active_users(db, timedelta(days=1)),
        wau=await _active_users(db, timedelta(days=7)),
        mau=await _active_users(db, timedelta(days=30)),
        sessions=n_sessions,
        sessions_prev=sessions_prev,
        avg_session_seconds=int(avg_secs) if avg_secs is not None else None,
        avg_questions_per_session=round(float(avg_q), 1) if avg_q is not None else None,
        funnel=funnel,
        series=series,
        health=health,
        referrals_counted=counted,
        referrals_held=held,
        rewards_redeemed=redeemed,
    )


async def _events(db: AsyncSession, kind: str, within: timedelta) -> int:
    return await _count(
        db,
        select(func.count())
        .select_from(Event)
        .where(Event.kind == kind, Event.created_at >= _now() - within),
    )


async def _series(db: AsyncSession, days: int) -> list[SeriesPoint]:
    since = (_now() - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    out: dict[str, SeriesPoint] = {
        (since + timedelta(days=i)).date().isoformat(): SeriesPoint(
            day=(since + timedelta(days=i)).date().isoformat()
        )
        for i in range(days)
    }
    signups = (
        await db.execute(
            select(func.date(User.created_at), func.count())
            .where(User.created_at >= since)
            .group_by(func.date(User.created_at))
        )
    ).all()
    for d, n in signups:
        if d.isoformat() in out:
            out[d.isoformat()].signups = int(n)
    sessions = (
        await db.execute(
            select(func.date(PracticeSession.started_at), func.count())
            .where(PracticeSession.started_at >= since)
            .group_by(func.date(PracticeSession.started_at))
        )
    ).all()
    for d, n in sessions:
        if d.isoformat() in out:
            out[d.isoformat()].sessions = int(n)
    active = (
        await db.execute(
            select(func.date(Event.created_at), func.count(distinct(Event.user_id)))
            .where(
                Event.kind.in_(ACTIVE_KINDS),
                Event.user_id.is_not(None),
                Event.created_at >= since,
            )
            .group_by(func.date(Event.created_at))
        )
    ).all()
    for d, n in active:
        if d.isoformat() in out:
            out[d.isoformat()].active_users = int(n)
    return list(out.values())


# ---------------------------------------------------------------------------------------- users


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _row(
    u: User,
    *,
    sessions: int,
    companies: int,
    has_cv: bool,
    credits: int,
    counted: int,
    held: int,
    last_active: datetime | None,
    is_admin: bool,
) -> UserRow:
    a = u.attribution or {}
    return UserRow(
        id=str(u.id),
        email=u.email,
        full_name=u.full_name,
        created_at=u.created_at.isoformat(),
        last_active_at=_iso(last_active),
        sessions=sessions,
        companies=companies,
        has_cv=has_cv,
        onboarded=u.onboarded_at is not None,
        credits_available=credits,
        referrals_counted=counted,
        referrals_held=held,
        signup_method=a.get("method"),
        utm_source=a.get("utm_source"),
        referred=bool(a.get("referred")),
        is_admin=is_admin,
    )


def _user_query() -> tuple[Select[Any], dict[str, Any]]:
    def grouped(col: Any, *where: Any) -> Any:
        q = select(col.label("uid"), func.count().label("n")).group_by(col)
        return (q.where(*where) if where else q).subquery()

    s_sub = grouped(PracticeSession.user_id)
    c_sub = grouped(Company.user_id)
    cr_sub = grouped(SessionCredit.user_id, SessionCredit.used_at.is_(None))
    rc_sub = grouped(Referral.referrer_id, Referral.status == "counted")
    rh_sub = grouped(Referral.referrer_id, Referral.status == "held")
    cv_sub = select(Note.user_id.label("uid")).where(Note.content != "").subquery()
    la_sub = (
        select(Event.user_id.label("uid"), func.max(Event.created_at).label("at"))
        .where(Event.user_id.is_not(None))
        .group_by(Event.user_id)
        .subquery()
    )
    query = (
        select(
            User,
            func.coalesce(s_sub.c.n, 0),
            func.coalesce(c_sub.c.n, 0),
            cv_sub.c.uid.is_not(None),
            func.coalesce(cr_sub.c.n, 0),
            func.coalesce(rc_sub.c.n, 0),
            func.coalesce(rh_sub.c.n, 0),
            la_sub.c.at,
        )
        .outerjoin(s_sub, s_sub.c.uid == User.id)
        .outerjoin(c_sub, c_sub.c.uid == User.id)
        .outerjoin(cv_sub, cv_sub.c.uid == User.id)
        .outerjoin(cr_sub, cr_sub.c.uid == User.id)
        .outerjoin(rc_sub, rc_sub.c.uid == User.id)
        .outerjoin(rh_sub, rh_sub.c.uid == User.id)
        .outerjoin(la_sub, la_sub.c.uid == User.id)
    )
    return query, {"sessions": s_sub.c.n, "last_active": la_sub.c.at}


async def list_users(
    db: AsyncSession,
    *,
    q: str,
    sort: str,
    limit: int,
    offset: int,
    admin_emails: set[str],
) -> UserListOut:
    base, cols = _user_query()
    where = []
    if q.strip():
        where.append(
            or_(
                User.email.ilike(_like(q.strip()), escape="\\"),
                User.full_name.ilike(_like(q.strip()), escape="\\"),
            )
        )
    total = await _count(db, select(func.count()).select_from(User).where(*where))
    order = {
        "active": cols["last_active"].desc().nulls_last(),
        "sessions": func.coalesce(cols["sessions"], 0).desc(),
        "oldest": User.created_at.asc(),
    }.get(sort, User.created_at.desc())
    rows = (
        await db.execute(base.where(*where).order_by(order, User.id).limit(limit).offset(offset))
    ).all()
    return UserListOut(
        total=total,
        items=[
            _row(
                u,
                sessions=int(s),
                companies=int(c),
                has_cv=bool(cv),
                credits=int(cr),
                counted=int(rc),
                held=int(rh),
                last_active=la,
                is_admin=u.email.lower() in admin_emails,
            )
            for u, s, c, cv, cr, rc, rh, la in rows
        ],
    )


async def user_detail(
    db: AsyncSession, user_id: uuid.UUID, admin_emails: set[str]
) -> UserDetailOut | None:
    query, _cols = _user_query()
    row = (await db.execute(query.where(User.id == user_id))).first()
    if row is None:
        return None
    u, s, c, cv, cr, rc, rh, la = row
    base = _row(
        u,
        sessions=int(s),
        companies=int(c),
        has_cv=bool(cv),
        credits=int(cr),
        counted=int(rc),
        held=int(rh),
        last_active=la,
        is_admin=u.email.lower() in admin_emails,
    )
    kinds = {
        k: int(n)
        for k, n in (
            await db.execute(
                select(SessionCredit.kind, func.count())
                .where(SessionCredit.user_id == user_id, SessionCredit.used_at.is_(None))
                .group_by(SessionCredit.kind)
            )
        ).all()
    }
    used = await _count(
        db,
        select(func.count())
        .select_from(SessionCredit)
        .where(SessionCredit.user_id == user_id, SessionCredit.used_at.is_not(None)),
    )
    inviter = (
        await db.execute(
            select(User.email)
            .join(Referral, Referral.referrer_id == User.id)
            .where(Referral.referred_id == user_id)
        )
    ).scalar_one_or_none()
    sent = await _count(
        db,
        select(func.count())
        .select_from(Event)
        .where(Event.user_id == user_id, Event.kind == "email.sent"),
    )
    failed = await _count(
        db,
        select(func.count())
        .select_from(Event)
        .where(Event.user_id == user_id, Event.kind == "email.failed"),
    )
    events = (
        await db.execute(
            select(Event)
            .where(Event.user_id == user_id)
            .order_by(Event.created_at.desc())
            .limit(150)
        )
    ).scalars()
    timeline = []
    for e in events:
        category, label = label_of(e.kind)
        timeline.append(
            TimelineItem(
                id=str(e.id),
                at=e.created_at.isoformat(),
                kind=e.kind,
                category=category,
                label=label,
                detail=describe(e.kind, e.data or {}),
            )
        )
    return UserDetailOut(
        user=base,
        credits=CreditBreakdown(
            trial=kinds.get("trial", 0),
            gifted=kinds.get("grant", 0),
            referral=kinds.get("referral", 0),
            paid=kinds.get("paid", 0),
            used=used,
        ),
        referral_code=u.referral_code,
        referred_by=inviter,
        invited=int(rc),
        held=int(rh),
        emails_sent=sent,
        emails_failed=failed,
        onboarding=u.onboarding,
        attribution=u.attribution,
        timeline=timeline,
    )


# ------------------------------------------------------------------------------------ activity


def categories() -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    for kind, (category, _) in EVENT_KINDS.items():
        out[category].append(kind)
    return dict(out)


def _activity_filters(
    *, kind: str | None, category: str | None, user_id: uuid.UUID | None, q: str | None
) -> list[Any]:
    where: list[Any] = []
    if kind:
        where.append(Event.kind == kind)
    if category:
        where.append(Event.kind.in_([k for k, (c, _) in EVENT_KINDS.items() if c == category]))
    if user_id:
        where.append(Event.user_id == user_id)
    if q and q.strip():
        like = _like(q.strip())
        where.append(
            or_(
                Event.user_id.in_(select(User.id).where(User.email.ilike(like, escape="\\"))),
                Event.data["to"].astext.ilike(like, escape="\\"),
                Event.data["email"].astext.ilike(like, escape="\\"),
            )
        )
    return where


async def activity(
    db: AsyncSession,
    *,
    kind: str | None,
    category: str | None,
    user_id: uuid.UUID | None,
    q: str | None,
    before: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> ActivityOut:
    where = _activity_filters(kind=kind, category=category, user_id=user_id, q=q)
    if before:
        # keyset paging on (time, id): events written in the same instant are neither skipped nor
        # repeated at a page boundary
        at, last_id = before
        where.append(or_(Event.created_at < at, and_(Event.created_at == at, Event.id < last_id)))
    actor = User.__table__.alias("actor")
    rows = (
        await db.execute(
            select(Event, User.email, actor.c.email)
            .outerjoin(User, User.id == Event.user_id)
            .outerjoin(actor, actor.c.id == Event.actor_id)
            .where(*where)
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(limit + 1)
        )
    ).all()
    page = rows[:limit]
    items = []
    for e, email, actor_email in page:
        category_, label = label_of(e.kind)
        items.append(
            ActivityItem(
                id=str(e.id),
                at=e.created_at.isoformat(),
                kind=e.kind,
                category=category_,
                label=label,
                user_id=str(e.user_id) if e.user_id else None,
                user_email=email,
                actor_email=actor_email,
                detail=describe(e.kind, e.data or {}),
            )
        )
    return ActivityOut(
        items=items,
        next_before=(
            f"{page[-1][0].created_at.isoformat()}|{page[-1][0].id}" if len(rows) > limit else None
        ),
        categories=categories(),
    )


async def activity_rows_for_export(
    db: AsyncSession,
    *,
    kind: str | None,
    category: str | None,
    user_id: uuid.UUID | None,
    q: str | None,
    limit: int = 5000,
) -> list[tuple[str, str, str, str, str]]:
    where = _activity_filters(kind=kind, category=category, user_id=user_id, q=q)
    rows = (
        await db.execute(
            select(Event, User.email)
            .outerjoin(User, User.id == Event.user_id)
            .where(*where)
            .order_by(Event.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        (
            e.created_at.isoformat(),
            e.kind,
            label_of(e.kind)[1],
            email or "",
            describe(e.kind, e.data or {}),
        )
        for e, email in rows
    ]


# ----------------------------------------------------------------------------------- referrals


async def referrals(db: AsyncSession, days: int, per_reward: int) -> ReferralsOut:
    since = _now() - timedelta(days=days)
    total = await _count(db, select(func.count()).select_from(Referral))
    counted = await _count(
        db, select(func.count()).select_from(Referral).where(Referral.status == "counted")
    )
    held = total - counted
    redeemed = await _count(
        db, select(func.count()).select_from(SessionCredit).where(SessionCredit.kind == "referral")
    )
    new_users = await _count(
        db, select(func.count()).select_from(User).where(User.created_at >= since)
    )
    referred_in_window = await _count(
        db, select(func.count()).select_from(Referral).where(Referral.created_at >= since)
    )

    rc = func.count().filter(Referral.status == "counted")
    rh = func.count().filter(Referral.status == "held")
    red_sub = (
        select(SessionCredit.user_id.label("uid"), func.count().label("n"))
        .where(SessionCredit.kind == "referral")
        .group_by(SessionCredit.user_id)
        .subquery()
    )
    top = (
        await db.execute(
            select(Referral.referrer_id, User.email, rc, rh, func.coalesce(red_sub.c.n, 0))
            .join(User, User.id == Referral.referrer_id)
            .outerjoin(red_sub, red_sub.c.uid == Referral.referrer_id)
            .group_by(Referral.referrer_id, User.email, red_sub.c.n)
            .order_by(rc.desc(), rh.desc())
            .limit(20)
        )
    ).all()
    referrer = User.__table__.alias("referrer")
    referred = User.__table__.alias("referred")
    held_rows = (
        await db.execute(
            select(Referral, referrer.c.email, referred.c.email)
            .join(referrer, referrer.c.id == Referral.referrer_id)
            .join(referred, referred.c.id == Referral.referred_id)
            .where(Referral.status == "held")
            .order_by(Referral.created_at.desc())
            .limit(50)
        )
    ).all()
    return ReferralsOut(
        total=total,
        counted=counted,
        held=held,
        rewards_earned=counted // max(1, per_reward),
        rewards_redeemed=redeemed,
        referred_signups_pct=_pct(referred_in_window, new_users),
        top_referrers=[
            ReferrerRow(
                user_id=str(uid),
                email=email,
                counted=int(c),
                held=int(h),
                rewards_earned=int(c) // max(1, per_reward),
                rewards_redeemed=int(r),
            )
            for uid, email, c, h, r in top
        ],
        held_items=[
            HeldRow(
                id=str(r.id),
                at=r.created_at.isoformat(),
                referrer_email=a,
                referred_email=b,
                reason=r.held_reason,
            )
            for r, a, b in held_rows
        ],
        per_reward=per_reward,
    )


# ------------------------------------------------------------------------------------ marketing


async def marketing(db: AsyncSession, days: int) -> MarketingOut:
    since = _now() - timedelta(days=days)
    cohort = (
        await db.execute(
            select(User.id, User.attribution, User.created_at).where(User.created_at >= since)
        )
    ).all()
    ids = [r[0] for r in cohort]
    first = {
        uid: at
        for uid, at in (
            await db.execute(
                select(PracticeSession.user_id, func.min(PracticeSession.started_at))
                .where(PracticeSession.user_id.in_(ids))
                .group_by(PracticeSession.user_id)
            )
        ).all()
    }
    twice = {
        uid
        for (uid,) in (
            await db.execute(
                select(PracticeSession.user_id)
                .where(PracticeSession.user_id.in_(ids))
                .group_by(PracticeSession.user_id)
                .having(func.count() >= 2)
            )
        ).all()
    }
    groups: dict[str, dict[str, dict[str, int]]] = {
        "method": defaultdict(lambda: defaultdict(int)),
        "source": defaultdict(lambda: defaultdict(int)),
        "campaign": defaultdict(lambda: defaultdict(int)),
    }

    def bump(kind: str, key: str, uid: uuid.UUID) -> None:
        g = groups[kind][key]
        g["signups"] += 1
        g["activated"] += 1 if uid in first else 0
        g["second"] += 1 if uid in twice else 0

    hours: list[float] = []
    referred = 0
    for uid, attribution, created in cohort:
        a = attribution or {}
        bump("method", str(a.get("method") or "unknown"), uid)
        if a.get("referred"):
            referred += 1
        bump("source", a.get("utm_source") or ("invite" if a.get("referred") else "direct"), uid)
        if a.get("utm_campaign"):
            bump("campaign", str(a["utm_campaign"]), uid)
        if uid in first:
            hours.append((first[uid] - created).total_seconds() / 3600)

    def rows(kind: str) -> list[ChannelRow]:
        return sorted(
            (
                ChannelRow(
                    channel=name,
                    signups=g["signups"],
                    activated=g["activated"],
                    activation_pct=_pct(g["activated"], g["signups"]),
                    second_session=g["second"],
                )
                for name, g in groups[kind].items()
            ),
            key=lambda r: (-r.signups, r.channel),
        )

    trial_used = await _count(
        db,
        select(func.count(distinct(SessionCredit.user_id))).where(
            SessionCredit.user_id.in_(ids),
            SessionCredit.kind == "trial",
            SessionCredit.used_at.is_not(None),
        ),
    )
    paywall = await _count(
        db,
        select(func.count(distinct(Event.user_id))).where(
            Event.kind == "session.blocked", Event.created_at >= since
        ),
    )
    redeemed = await _count(
        db,
        select(func.count())
        .select_from(Event)
        .where(Event.kind == "reward.redeemed", Event.created_at >= since),
    )
    n = len(cohort)
    return MarketingOut(
        days=days,
        signups=n,
        by_method=rows("method"),
        by_source=rows("source"),
        by_campaign=rows("campaign"),
        referred_pct=_pct(referred, n),
        k_factor=round(referred / n, 2) if n else 0.0,
        median_hours_to_first_session=round(statistics.median(hours), 1) if hours else None,
        trial_used_users=trial_used,
        hit_paywall_users=paywall,
        second_session_users=len(twice),
        redeemed_rewards=redeemed,
    )


# -------------------------------------------------------------------------------------- quality


async def quality(db: AsyncSession, days: int) -> QualityOut:
    since = _now() - timedelta(days=days)
    s = Suggestion
    answers = await _count(db, select(func.count()).select_from(s).where(s.created_at >= since))
    rated = await _count(
        db,
        select(func.count()).select_from(s).where(s.created_at >= since, s.feedback.is_not(None)),
    )
    up = await _count(
        db, select(func.count()).select_from(s).where(s.created_at >= since, s.feedback == "up")
    )
    flagged = await _count(
        db,
        select(func.count())
        .select_from(s)
        .where(s.created_at >= since, func.jsonb_array_length(s.grounding_flags) > 0),
    )
    p = (
        await db.execute(
            select(
                func.percentile_cont(0.5).within_group(s.first_token_ms),
                func.percentile_cont(0.95).within_group(s.first_token_ms),
                func.percentile_cont(0.5).within_group(s.total_ms),
                func.percentile_cont(0.95).within_group(s.total_ms),
            ).where(s.created_at >= since)
        )
    ).one()

    def ms(v: Any) -> int | None:
        return int(v) if v is not None else None

    by_type = {
        (t or "other"): int(n)
        for t, n in (
            await db.execute(
                select(s.type, func.count()).where(s.created_at >= since).group_by(s.type)
            )
        ).all()
    }
    sc = (
        await db.execute(
            select(
                func.avg(Score.structure),
                func.avg(Score.specificity),
                func.avg(Score.impact),
                func.avg(Score.relevance),
                func.avg(Score.pace),
                func.avg(Score.overall),
            )
            .join(PracticeSession, PracticeSession.id == Score.session_id)
            .where(PracticeSession.started_at >= since)
        )
    ).one()
    names = ["structure", "specificity", "impact", "relevance", "pace", "overall"]
    avg_scores = {n: round(float(v), 1) for n, v in zip(names, sc, strict=True) if v is not None}
    jobs = await _count(
        db, select(func.count()).select_from(ResearchJob).where(ResearchJob.started_at >= since)
    )
    jobs_failed = await _count(
        db,
        select(func.count())
        .select_from(ResearchJob)
        .where(ResearchJob.started_at >= since, ResearchJob.status == "failed"),
    )
    runs = await _count(
        db,
        select(func.count())
        .select_from(PracticeSession)
        .where(
            PracticeSession.started_at >= since,
            PracticeSession.scoring_status.in_(("ready", "failed")),
        ),
    )
    runs_failed = await _count(
        db,
        select(func.count())
        .select_from(PracticeSession)
        .where(PracticeSession.started_at >= since, PracticeSession.scoring_status == "failed"),
    )
    return QualityOut(
        days=days,
        answers=answers,
        rated=rated,
        helpful_pct=_pct(up, rated) if rated else None,
        flagged_pct=_pct(flagged, answers) if answers else None,
        latency=LatencyOut(
            p50_first_token_ms=ms(p[0]),
            p95_first_token_ms=ms(p[1]),
            p50_total_ms=ms(p[2]),
            p95_total_ms=ms(p[3]),
        ),
        by_type=by_type,
        avg_scores=avg_scores,
        research_jobs=jobs,
        research_failed_pct=_pct(jobs_failed, jobs) if jobs else None,
        scoring_runs=runs,
        scoring_failed_pct=_pct(runs_failed, runs) if runs else None,
    )


# --------------------------------------------------------------------------------------- emails


async def emails(
    db: AsyncSession, *, kind: str | None, status: str | None, q: str | None, limit: int
) -> EmailsOut:
    now = _now()
    d7, d30 = now - timedelta(days=7), now - timedelta(days=30)
    ek = Event.data["email_kind"].astext
    rows = (
        await db.execute(
            select(
                ek,
                Event.kind,
                func.count().filter(Event.created_at >= d7),
                func.count().filter(Event.created_at >= d30),
            )
            .where(Event.kind.in_(("email.sent", "email.failed")), Event.created_at >= d30)
            .group_by(ek, Event.kind)
        )
    ).all()
    seven: dict[str, dict[str, int]] = defaultdict(lambda: {"sent": 0, "failed": 0})
    thirty: dict[str, dict[str, int]] = defaultdict(lambda: {"sent": 0, "failed": 0})
    for email_kind, event_kind, n7, n30 in rows:
        key = "sent" if event_kind == "email.sent" else "failed"
        seven[email_kind or "?"][key] += int(n7)
        thirty[email_kind or "?"][key] += int(n30)
    known = [c[0] for c in CATALOG]
    kinds = [
        EmailKindRow(
            kind=k,
            sent_7d=seven[k]["sent"],
            failed_7d=seven[k]["failed"],
            sent_30d=thirty[k]["sent"],
            failed_30d=thirty[k]["failed"],
        )
        for k in known
    ]
    where: list[Any] = [Event.kind.in_(("email.sent", "email.failed"))]
    if kind:
        where.append(ek == kind)
    if status:
        where.append(Event.kind == ("email.failed" if status == "failed" else "email.sent"))
    if q and q.strip():
        where.append(Event.data["to"].astext.ilike(_like(q.strip()), escape="\\"))
    items = (
        await db.execute(select(Event).where(*where).order_by(Event.created_at.desc()).limit(limit))
    ).scalars()
    return EmailsOut(
        kinds=kinds,
        items=[
            EmailLogItem(
                id=str(e.id),
                at=e.created_at.isoformat(),
                kind=str((e.data or {}).get("email_kind", "")),
                to=str((e.data or {}).get("to", "")),
                status="failed" if e.kind == "email.failed" else "sent",
                user_id=str(e.user_id) if e.user_id else None,
            )
            for e in items
        ],
    )
