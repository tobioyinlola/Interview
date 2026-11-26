"""Usage statistics from the app. What matters: nothing a person typed can get in, the browser's
do-not-track signal and the account switch are honoured on the server, and turning it off deletes."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models import ClientEvent
from app.services import analytics
from tests.test_hardening import make_client

DEVICE = "0f8fad5b-d9cb-469f-a165-70867728950e"
SESSION = "7c9e6679-7425-40de-944b-e07fc1f90ae7"


@pytest.fixture(autouse=True)
async def fresh_global_engine(monkeypatch, engine):  # type: ignore[no-untyped-def]
    """The rate-limit test builds the real app, which shares one module-level database engine. Give
    each test its own (the event loop changes per test), as test_hardening does."""
    from app import db as dbmod

    monkeypatch.setattr(dbmod, "_engine", None)
    monkeypatch.setattr(dbmod, "_sessionmaker", None)
    yield
    if dbmod._engine is not None:
        await dbmod._engine.dispose()


def batch(*events, **over):  # type: ignore[no-untyped-def]
    return {
        "device_id": DEVICE, "session_id": SESSION, "platform": "ios", "form_factor": "phone",
        "app_version": "1.4.2", "locale": "en-GB", "viewport": "xs", "events": list(events),
        **over,
    }  # fmt: skip


async def stored(db):  # type: ignore[no-untyped-def]
    return list((await db.execute(select(ClientEvent).order_by(ClientEvent.ts))).scalars())


async def test_a_good_batch_is_stored_with_the_device_it_came_from(new_client, db) -> None:
    now_ms = int(datetime.now(UTC).timestamp() * 1000)
    async with new_client() as c:
        r = await c.post("/api/analytics/events", json=batch(
            {"name": "app_open", "ts": now_ms, "props": {"source": "cold"}},
            {"name": "screen_view", "route": "/dashboard", "ts": now_ms},
            {"name": "screen_engaged", "route": "/dashboard", "props": {"seconds": 42}},
        ))  # fmt: skip
    assert r.status_code == 202 and r.json() == {"accepted": 3, "rejected": 0, "stop": False}
    rows = await stored(db)
    assert [e.name for e in rows] == ["app_open", "screen_view", "screen_engaged"]
    assert {(e.platform, e.form_factor, e.viewport, e.user_id) for e in rows} == {
        ("ios", "phone", "xs", None)
    }
    assert rows[2].props == {"seconds": 42} and rows[2].route == "/dashboard"


async def test_free_text_cannot_get_in(new_client, db) -> None:
    async with new_client() as c:
        r = await c.post("/api/analytics/events", json=batch(
            {"name": "feature_used", "props": {"feature": "Tell me about yourself", "detail": "ok"}},
            {"name": "feature_used", "props": {"feature": "a@b.com", "detail": "x" * 80}},
            {"name": "feature_used", "props": {"answer": "my salary is 90k", "feature": "cv"}},
            {"name": "keystroke", "props": {"feature": "cv"}},
            {"name": "screen_view", "route": "/session/the answer I gave"},
            {"name": "screen_view", "route": "https://evil.example/x"},
        ))  # fmt: skip
    assert r.json()["accepted"] == 3 and r.json()["rejected"] == 3
    rows = await stored(db)
    # only the short coded values survived; every word, address and unknown key was dropped
    assert [e.props for e in rows] == [{"detail": "ok"}, {}, {"feature": "cv"}]


async def test_routes_lose_their_ids_and_numbers_stay_in_range(new_client, db) -> None:
    async with new_client() as c:
        await c.post("/api/analytics/events", json=batch(
            {"name": "screen_view", "route": "/sessions/7c9e6679-7425-40de-944b-e07fc1f90ae7"},
            {"name": "screen_view", "route": "/companies/48213/"},
            {"name": "screen_view", "route": "/auto-apply/applications/abc?token=secret#x"},
            {"name": "screen_engaged", "route": "/me", "props": {"seconds": 10**9}},
            {"name": "screen_engaged", "route": "/me", "props": {"seconds": -5}},
            {"name": "screen_engaged", "route": "/me", "props": {"seconds": "9"}},
        ))  # fmt: skip
    rows = await stored(db)
    assert [e.route for e in rows] == [
        "/sessions/:id", "/companies/:id", "/auto-apply/applications/abc", "/me", "/me", "/me",
    ]  # fmt: skip
    assert [e.props.get("seconds") for e in rows[3:]] == [14400, 0, None]


async def test_a_wrong_clock_does_not_put_events_in_the_wrong_day(new_client, db) -> None:
    far_past = int((datetime.now(UTC) - timedelta(days=400)).timestamp() * 1000)
    future = int((datetime.now(UTC) + timedelta(days=5)).timestamp() * 1000)
    async with new_client() as c:
        await c.post("/api/analytics/events", json=batch(
            {"name": "app_open", "ts": far_past}, {"name": "app_open", "ts": future},
            {"name": "app_open", "ts": 10**30},
        ))  # fmt: skip
    for e in await stored(db):
        assert abs((e.ts - e.received_at).total_seconds()) < 5


async def test_a_batch_that_does_not_look_like_our_app_is_dropped(new_client, db) -> None:
    async with new_client() as c:
        for bad in (
            batch({"name": "app_open"}, device_id="not an id"),
            batch({"name": "app_open"}, platform="toaster"),
            batch({"name": "app_open"}, form_factor="fridge"),
        ):
            r = await c.post("/api/analytics/events", json=bad)
            assert r.status_code == 202 and r.json()["accepted"] == 0
        too_many = await c.post("/api/analytics/events", json=batch(*[{"name": "app_open"}] * 51))
    assert too_many.status_code == 422
    assert await stored(db) == []


async def test_signed_in_events_belong_to_the_account_and_opting_out_deletes_them(
    new_client, sign_in, db
) -> None:
    async with new_client() as c:
        await c.post("/api/analytics/events", json=batch({"name": "app_open"}))  # before sign-in
        await sign_in(c, "alice@example.com")
        me = (await c.get("/api/me")).json()
        assert me["analytics_opt_out"] is False
        r = await c.post(
            "/api/analytics/events", json=batch({"name": "screen_view", "route": "/me"})
        )
        assert r.json()["accepted"] == 1
        rows = await stored(db)
        assert [(e.name, e.user_id is not None) for e in rows] == [
            ("app_open", False), ("screen_view", True),
        ]  # fmt: skip

        off = await c.put("/api/analytics/preference", json={"opt_out": True})
        assert off.json() == {"opt_out": True}
        assert (await c.get("/api/me")).json()["analytics_opt_out"] is True
        db.expire_all()
        assert [e.name for e in await stored(db)] == ["app_open"]  # only their own were deleted
        again = await c.post("/api/analytics/events", json=batch({"name": "screen_view"}))
        assert again.json() == {"accepted": 0, "rejected": 1, "stop": True}

        on = await c.put("/api/analytics/preference", json={"opt_out": False})
        assert on.json() == {"opt_out": False}
        ok = await c.post("/api/analytics/events", json=batch({"name": "screen_view"}))
        assert ok.json()["accepted"] == 1
        log = (await c.get("/api/me")).status_code
        assert log == 200


async def test_the_preference_needs_a_signed_in_person(new_client) -> None:
    async with new_client() as c:
        r = await c.put("/api/analytics/preference", json={"opt_out": True})
    assert r.status_code == 401


@pytest.mark.parametrize("header", [{"Sec-GPC": "1"}, {"DNT": "1"}])
async def test_the_browsers_do_not_track_signal_is_honoured_by_the_server(
    new_client, db, header
) -> None:
    async with new_client() as c:
        r = await c.post("/api/analytics/events", json=batch({"name": "app_open"}), headers=header)
    assert r.json() == {"accepted": 0, "rejected": 1, "stop": True}
    assert await stored(db) == []


async def test_deleting_the_account_deletes_their_statistics(new_client, sign_in, db) -> None:
    async with new_client() as c:
        await sign_in(c, "bob@example.com")
        await c.post("/api/analytics/events", json=batch({"name": "app_open"}))
        assert (await db.execute(select(func.count()).select_from(ClientEvent))).scalar_one() == 1
        assert (await c.delete("/api/account")).status_code == 202
    db.expire_all()
    assert (await db.execute(select(func.count()).select_from(ClientEvent))).scalar_one() == 0


async def test_old_statistics_are_purged(db, engine) -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker

    now = datetime.now(UTC)
    ctx = analytics.clean_context(
        device_id=DEVICE, session_id=SESSION, platform="web", form_factor="desktop",
        app_version="1", locale="en", viewport="lg",
    )  # fmt: skip
    assert ctx is not None
    await analytics.ingest(db, ctx, None, [{"name": "app_open"}], now - timedelta(days=100))
    await db.execute(ClientEvent.__table__.update().values(ts=now - timedelta(days=100)))
    await analytics.ingest(db, ctx, None, [{"name": "app_open"}], now)
    sf = async_sessionmaker(engine, expire_on_commit=False)
    assert await analytics.purge_old_client_events(sf, 90) == 1
    db.expire_all()
    assert len(await stored(db)) == 1


async def test_statistics_have_their_own_rate_limit_that_never_blocks_real_requests(
    monkeypatch,
) -> None:
    async with make_client(monkeypatch, rate_limit_analytics_per_minute=2) as c:
        codes = [
            (await c.post("/api/analytics/events", json=batch({"name": "app_open"}))).status_code
            for _ in range(4)
        ]
        other = await c.get("/api/auth/providers")
    assert codes == [202, 202, 429, 429]
    assert other.status_code == 200  # the general allowance is untouched


def test_every_event_name_is_described_for_the_data_dictionary() -> None:
    assert all(desc.strip() for desc in analytics.EVENT_NAMES.values())
    assert analytics.clean_route("/a/b?x=1") == "/a/b"
