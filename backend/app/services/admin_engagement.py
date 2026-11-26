"""Engagement for the back office, from the app's usage statistics (client_events). One function per
question; each is a plain aggregate over a window of days."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Integer, String, and_, cast, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClientEvent as E
from app.models import User
from app.schemas.engagement import (
    EngagementOut,
    EngagementPoint,
    ErrorRow,
    FeatureRow,
    LoadRow,
    RetentionRow,
    ScreenRow,
    SplitRow,
    VersionRow,
)

# a person, for counting: the signed-in account when there is one, else the device
PERSON = func.coalesce(cast(E.user_id, String), E.device_id)
SECONDS = cast(E.props["seconds"].astext, Integer)
RETENTION_DAYS = (1, 7, 30)


def _pct(part: float, whole: float) -> float | None:
    return round(100 * part / whole, 1) if whole else None


async def _scalar(db: AsyncSession, q: Any) -> Any:
    return (await db.execute(q)).scalar_one()


async def _distinct_users(db: AsyncSession, since: datetime, until: datetime | None = None) -> int:
    cond = [E.ts >= since, E.user_id.is_not(None)]
    if until:
        cond.append(E.ts < until)
    return int(await _scalar(db, select(func.count(distinct(E.user_id))).where(*cond)))


async def _sessions(db: AsyncSession, since: datetime, until: datetime | None = None) -> int:
    cond = [E.ts >= since]
    if until:
        cond.append(E.ts < until)
    return int(await _scalar(db, select(func.count(distinct(E.session_id))).where(*cond)))


async def _session_shape(
    db: AsyncSession, since: datetime
) -> tuple[int | None, float | None, float | None, float | None]:
    """(median seconds, screens per session, share with an error, share that went offline)."""
    per = (
        select(
            E.session_id.label("sid"),
            (func.extract("epoch", func.max(E.ts) - func.min(E.ts))).label("secs"),
            func.count().filter(E.name == "screen_view").label("screens"),
            func.count().filter(E.name == "ui_error").label("errors"),
            func.count()
            .filter(and_(E.name == "connectivity", E.props["state"].astext == "offline"))
            .label("offline"),
        )
        .where(E.ts >= since)
        .group_by(E.session_id)
        .subquery()
    )
    row = (
        await db.execute(
            select(
                func.percentile_cont(0.5).within_group(per.c.secs).filter(per.c.secs > 0),
                func.avg(per.c.screens),
                func.count(),
                func.count().filter(per.c.errors > 0),
                func.count().filter(per.c.offline > 0),
            )
        )
    ).one()
    median, screens, n, with_err, with_off = row
    return (
        int(median) if median is not None else None,
        round(float(screens), 1) if screens is not None else None,
        _pct(with_err, n),
        _pct(with_off, n),
    )


async def _series(db: AsyncSession, days: int, now: datetime) -> list[EngagementPoint]:
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date_trunc("day", E.ts)
    rows = (
        await db.execute(
            select(
                day,
                func.count(distinct(E.user_id)),
                func.count(distinct(E.device_id)),
                func.count(distinct(E.session_id)),
                func.coalesce(func.sum(SECONDS).filter(E.name == "screen_engaged"), 0),
            )
            .where(E.ts >= since)
            .group_by(day)
        )
    ).all()
    by_day = {d.date().isoformat(): (u, dv, s, sec) for d, u, dv, s, sec in rows}
    out = []
    for i in range(days):
        d = (since + timedelta(days=i)).date().isoformat()
        u, dv, s, sec = by_day.get(d, (0, 0, 0, 0))
        out.append(
            EngagementPoint(day=d, users=u, devices=dv, sessions=s, engaged_minutes=int(sec) // 60)
        )
    return out


async def _split(db: AsyncSession, column: Any, since: datetime) -> list[SplitRow]:
    rows = (
        await db.execute(
            select(
                column,
                func.count(distinct(E.device_id)),
                func.count(distinct(E.user_id)),
                func.count(distinct(E.session_id)),
                func.coalesce(func.sum(SECONDS).filter(E.name == "screen_engaged"), 0),
            )
            .where(E.ts >= since)
            .group_by(column)
            .order_by(func.count(distinct(E.session_id)).desc())
        )
    ).all()
    total = sum(r[3] for r in rows)
    return [
        SplitRow(
            key=str(k),
            devices=dv,
            users=u,
            sessions=s,
            engaged_minutes=int(sec) // 60,
            share_pct=_pct(s, total) or 0.0,
        )  # fmt: skip
        for k, dv, u, s, sec in rows
    ]


async def _screens(db: AsyncSession, since: datetime) -> list[ScreenRow]:
    views = (
        await db.execute(
            select(E.route, func.count(), func.count(distinct(PERSON)))
            .where(E.ts >= since, E.name == "screen_view", E.route.is_not(None))
            .group_by(E.route)
            .order_by(func.count().desc())
            .limit(25)
        )
    ).all()
    spent: dict[str | None, Any] = dict(
        (
            await db.execute(
                select(E.route, func.avg(SECONDS))
                .where(E.ts >= since, E.name == "screen_engaged", E.route.is_not(None))
                .group_by(E.route)
            )
        ).all()
    )
    return [
        ScreenRow(
            route=r,
            views=v,
            people=p,
            avg_seconds=int(spent[r]) if spent.get(r) is not None else None,
        )  # fmt: skip
        for r, v, p in views
    ]


async def _features(db: AsyncSession, since: datetime) -> list[FeatureRow]:
    out: list[FeatureRow] = []
    for name, prop, kind in (
        ("interaction", "ev", "interaction"),
        ("feature_used", "feature", "feature"),
    ):
        key = E.props[prop].astext
        rows = (
            await db.execute(
                select(key, func.count(), func.count(distinct(PERSON)))
                .where(E.ts >= since, E.name == name, key.is_not(None))
                .group_by(key)
                .order_by(func.count().desc())
                .limit(30)
            )
        ).all()
        out += [FeatureRow(key=k, kind=kind, uses=n, people=p) for k, n, p in rows]
    return sorted(out, key=lambda f: -f.uses)[:40]


async def _errors(db: AsyncSession, since: datetime) -> list[ErrorRow]:
    kind = E.props["kind"].astext
    rows = (
        await db.execute(
            select(kind, E.route, func.count(), func.count(distinct(E.device_id)), func.max(E.ts))
            .where(E.ts >= since, E.name == "ui_error")
            .group_by(kind, E.route)
            .order_by(func.count().desc())
            .limit(15)
        )
    ).all()
    return [
        ErrorRow(kind=k or "unknown", route=r, count=n, devices=d, last_seen=last)
        for k, r, n, d, last in rows
    ]


async def _load(db: AsyncSession, since: datetime) -> list[LoadRow]:
    ms = cast(E.props["ms"].astext, Integer)
    rows = (
        await db.execute(
            select(
                E.platform,
                func.percentile_cont(0.5).within_group(ms),
                func.percentile_cont(0.95).within_group(ms),
                func.count(),
            )
            .where(E.ts >= since, E.name == "app_loaded", E.props["ms"].astext.is_not(None))
            .group_by(E.platform)
        )
    ).all()
    return [LoadRow(platform=p, p50_ms=int(a), p95_ms=int(b), samples=n) for p, a, b, n in rows]


async def _versions(db: AsyncSession, since: datetime) -> list[VersionRow]:
    rows = (
        await db.execute(
            select(E.platform, E.app_version, func.count(distinct(E.device_id)))
            .where(E.ts >= since)
            .group_by(E.platform, E.app_version)
            .order_by(func.count(distinct(E.device_id)).desc())
            .limit(12)
        )
    ).all()
    return [VersionRow(platform=p, app_version=v or "unknown", devices=d) for p, v, d in rows]


async def _retention(db: AsyncSession, now: datetime) -> list[RetentionRow]:
    """Of the people who signed up at least N days ago (and within what is kept), how many were
    active on day N after signing up. Counted from sign-up, not from the first statistic."""
    horizon = now - timedelta(days=90)
    people = (
        await db.execute(
            select(User.id, func.date(User.created_at)).where(User.created_at >= horizon)
        )
    ).all()
    start = {uid: d for uid, d in people}
    if not start:
        return [RetentionRow(day=n, cohort=0, returned=0, pct=None) for n in RETENTION_DAYS]
    active = defaultdict(set)
    for uid, d in (
        await db.execute(
            select(E.user_id, func.date(E.ts))
            .where(E.user_id.in_(list(start)), E.ts >= horizon)
            .distinct()
        )
    ).all():
        active[uid].add(d)
    today = now.date()
    out = []
    for n in RETENTION_DAYS:
        cohort = [u for u, d in start.items() if (today - d).days >= n]
        back = sum(1 for u in cohort if (start[u] + timedelta(days=n)) in active[u])
        out.append(
            RetentionRow(day=n, cohort=len(cohort), returned=back, pct=_pct(back, len(cohort)))
        )
    return out


async def engagement(db: AsyncSession, days: int) -> EngagementOut:
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    first = await _scalar(db, select(func.min(E.ts)))
    people = await _distinct_users(db, since)
    sessions = await _sessions(db, since)
    dau = await _distinct_users(db, now - timedelta(days=1))
    mau = await _distinct_users(db, now - timedelta(days=30))
    median, screens_per, err_pct, off_pct = await _session_shape(db, since)
    engaged = await _scalar(
        db,
        select(func.coalesce(func.sum(SECONDS), 0)).where(
            E.ts >= since, E.name == "screen_engaged"
        ),
    )
    return EngagementOut(
        days=days,
        has_data=first is not None,
        data_since=first,
        people=people,
        people_prev=await _distinct_users(db, now - timedelta(days=2 * days), since),
        devices=int(
            await _scalar(db, select(func.count(distinct(E.device_id))).where(E.ts >= since))
        ),
        sessions=sessions,
        sessions_prev=await _sessions(db, now - timedelta(days=2 * days), since),
        dau=dau,
        wau=await _distinct_users(db, now - timedelta(days=7)),
        mau=mau,
        stickiness_pct=_pct(dau, mau),
        median_session_seconds=median,
        screens_per_session=screens_per,
        engaged_minutes_per_person=round(int(engaged) / 60 / people, 1) if people else None,
        error_session_pct=err_pct,
        offline_session_pct=off_pct,
        series=await _series(db, days, now),
        platforms=await _split(db, E.platform, since),
        form_factors=await _split(db, E.form_factor, since),
        versions=await _versions(db, since),
        screens=await _screens(db, since),
        features=await _features(db, since),
        errors=await _errors(db, since),
        load=await _load(db, since),
        retention=await _retention(db, now),
    )
