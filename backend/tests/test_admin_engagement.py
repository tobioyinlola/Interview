"""The back office's engagement numbers, from usage statistics sent by the app on every device."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import ClientEvent, User

NOW = datetime.now(UTC)


@pytest.fixture
async def boss(new_client, staff_sign_in, settings):  # type: ignore[no-untyped-def]
    settings.admin_emails = "boss@example.com"
    async with new_client() as c:
        await staff_sign_in(c, "boss@example.com")
        yield c


def ev(
    name,
    *,
    user=None,
    device="d1",
    session="s1",
    platform="web",
    form="desktop",
    route=None,
    props=None,
    ago=timedelta(minutes=5),
    version="1.0.0",
):  # type: ignore[no-untyped-def]
    return ClientEvent(
        id=uuid.uuid4(), ts=NOW - ago, received_at=NOW, device_id=device, session_id=session,
        user_id=user, name=name, route=route, props=props or {}, platform=platform,
        form_factor=form, app_version=version, locale="en", viewport="lg",
    )  # fmt: skip


async def user(db, email, days_ago=3):  # type: ignore[no-untyped-def]
    u = User(
        email=email, created_at=NOW - timedelta(days=days_ago), referral_code=uuid.uuid4().hex[:8]
    )
    db.add(u)
    await db.flush()
    return u.id


async def test_it_starts_empty_and_says_so(boss) -> None:
    d = (await boss.get("/api/admin/engagement")).json()
    assert d["has_data"] is False and d["people"] == 0 and d["sessions"] == 0
    assert d["median_session_seconds"] is None and len(d["series"]) == 30
    assert [r["pct"] for r in d["retention"]] == [None, None, None]


async def test_the_numbers_across_devices(boss, engine) -> None:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        ada = await user(db, "ada@example.com", days_ago=10)
        bo = await user(db, "bo@example.com", days_ago=10)
        rows = [
            # Ada on an iPhone: two screens, 90 s on the first, an interface error, and offline
            ev(
                "screen_view",
                user=ada,
                device="phone-ada",
                session="s-ada",
                platform="ios",
                form="phone",
                route="/dashboard",
                ago=timedelta(minutes=30),
            ),
            ev(
                "screen_engaged",
                user=ada,
                device="phone-ada",
                session="s-ada",
                platform="ios",
                form="phone",
                route="/dashboard",
                props={"seconds": 90},
                ago=timedelta(minutes=28),
            ),
            ev(
                "screen_view",
                user=ada,
                device="phone-ada",
                session="s-ada",
                platform="ios",
                form="phone",
                route="/session/:id",
                ago=timedelta(minutes=27),
            ),
            ev(
                "ui_error",
                user=ada,
                device="phone-ada",
                session="s-ada",
                platform="ios",
                form="phone",
                route="/session/:id",
                props={"kind": "typeerror"},
                ago=timedelta(minutes=26),
            ),
            ev(
                "connectivity",
                user=ada,
                device="phone-ada",
                session="s-ada",
                platform="ios",
                form="phone",
                props={"state": "offline"},
                ago=timedelta(minutes=25),
            ),
            ev(
                "app_loaded",
                user=ada,
                device="phone-ada",
                session="s-ada",
                platform="ios",
                form="phone",
                props={"ms": 1200},
                ago=timedelta(minutes=30),
            ),
            # Ada again, on the web, the day after her sign-up cohort's day 1 is not needed here
            ev(
                "screen_view",
                user=ada,
                device="laptop-ada",
                session="s-ada2",
                route="/dashboard",
                ago=timedelta(hours=2),
            ),
            ev(
                "interaction",
                user=ada,
                device="laptop-ada",
                session="s-ada2",
                props={"ev": "nav.companies"},
                ago=timedelta(hours=2),
            ),
            ev(
                "feature_used",
                user=ada,
                device="laptop-ada",
                session="s-ada2",
                props={"feature": "cv_upload"},
                ago=timedelta(hours=2),
            ),
            # Bo on the Windows desktop app
            ev(
                "screen_view",
                user=bo,
                device="pc-bo",
                session="s-bo",
                platform="windows",
                route="/dashboard",
                ago=timedelta(hours=1),
            ),
            ev(
                "screen_engaged",
                user=bo,
                device="pc-bo",
                session="s-bo",
                platform="windows",
                route="/dashboard",
                props={"seconds": 30},
                ago=timedelta(minutes=50),
            ),
            ev(
                "interaction",
                user=bo,
                device="pc-bo",
                session="s-bo",
                platform="windows",
                props={"ev": "nav.companies"},
                ago=timedelta(minutes=49),
            ),
            # a visitor who never signed in
            ev("screen_view", device="visitor", session="s-v", route="/", ago=timedelta(hours=3)),
            # too old for a 7-day window
            ev(
                "screen_view",
                user=bo,
                device="pc-bo",
                session="s-old",
                platform="windows",
                route="/dashboard",
                ago=timedelta(days=20),
            ),
        ]
        db.add_all(rows)
        await db.commit()

    d = (await boss.get("/api/admin/engagement?days=7")).json()
    assert d["has_data"] is True
    assert d["people"] == 2 and d["devices"] == 4 and d["sessions"] == 4
    assert d["dau"] == 2 and d["mau"] == 2
    # screens per session: ada 2, ada2 1, bo 1, visitor 1 -> 1.25, shown to one decimal
    assert d["screens_per_session"] == 1.2
    # a quarter of sessions had an error and a quarter went offline: Ada's phone session
    assert d["error_session_pct"] == 25.0 and d["offline_session_pct"] == 25.0
    assert d["median_session_seconds"] is not None
    assert d["engaged_minutes_per_person"] == 1.0  # (90 + 30) s over two people

    by = {p["key"]: p for p in d["platforms"]}
    assert set(by) == {"ios", "web", "windows"}
    assert (by["ios"]["sessions"], by["web"]["sessions"], by["windows"]["sessions"]) == (1, 2, 1)
    assert by["web"]["share_pct"] == 50.0
    assert {f["key"] for f in d["form_factors"]} == {"phone", "desktop"}
    assert [(v["platform"], v["devices"]) for v in d["versions"]][0][1] >= 1

    screens = {s["route"]: s for s in d["screens"]}
    assert screens["/dashboard"]["views"] == 3 and screens["/dashboard"]["avg_seconds"] == 60
    feats = {(f["kind"], f["key"]): f for f in d["features"]}
    assert feats[("interaction", "nav.companies")]["uses"] == 2
    assert feats[("interaction", "nav.companies")]["people"] == 2
    assert feats[("feature", "cv_upload")]["uses"] == 1
    assert d["errors"][0]["kind"] == "typeerror" and d["errors"][0]["route"] == "/session/:id"
    assert d["load"] == [{"platform": "ios", "p50_ms": 1200, "p95_ms": 1200, "samples": 1}]
    today = d["series"][-1]
    assert today["users"] == 2 and today["devices"] == 4


async def test_retention_counts_from_sign_up(boss, engine) -> None:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        kept = await user(db, "kept@example.com", days_ago=9)
        gone = await user(db, "gone@example.com", days_ago=9)
        fresh = await user(db, "fresh@example.com", days_ago=0)  # too new to count for day 1
        db.add_all([
            # came back the day after sign-up and again a week after
            ev("screen_view", user=kept, device="k", session="k1", ago=timedelta(days=8)),
            ev("screen_view", user=kept, device="k", session="k2", ago=timedelta(days=2)),
            ev("screen_view", user=gone, device="g", session="g1", ago=timedelta(days=3)),
            ev("screen_view", user=fresh, device="f", session="f1"),
        ])  # fmt: skip
        await db.commit()
    d = (await boss.get("/api/admin/engagement?days=30")).json()
    r = {x["day"]: x for x in d["retention"]}
    assert r[1] == {"day": 1, "cohort": 2, "returned": 1, "pct": 50.0}
    assert r[7]["cohort"] == 2 and r[7]["returned"] == 1
    assert r[30]["cohort"] == 0 and r[30]["pct"] is None


async def test_it_is_for_staff_only_and_holds_no_words(new_client, boss, engine) -> None:
    async with new_client() as stranger:
        assert (await stranger.get("/api/admin/engagement")).status_code in (401, 403)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(ev("feature_used", props={"feature": "cv_upload", "detail": "ok"}))
        await db.commit()
    text = (await boss.get("/api/admin/engagement")).text
    assert "cv_upload" in text and "@" not in text
