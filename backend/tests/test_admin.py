import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import PracticeSession, ResearchJob, Usage, User

TODAY = datetime.now(UTC).date()


@pytest.fixture
async def boss(new_client, staff_sign_in, settings):
    settings.admin_emails = " Boss@Example.com , other@example.com "  # case and spaces tolerated
    async with new_client() as c:
        await staff_sign_in(c, "boss@example.com")
        yield c


async def user_id(db, email):
    return (await db.execute(select(User.id).where(User.email == email))).scalar_one()


async def add_user(db, email):
    u = User(email=email)
    db.add(u)
    await db.commit()
    return u.id


# ------------------------------------------------------------------- access


async def test_being_signed_in_to_the_app_does_not_open_the_back_office(
    new_client, sign_in, settings
):
    settings.admin_emails = "boss@example.com"
    async with new_client() as c:
        await sign_in(c, "boss@example.com")  # even the owner, signed in to the customer app
        r = await c.get("/api/admin/usage")
    assert r.status_code == 401 and r.json()["error"]["code"] == "staff_not_authenticated"


async def test_anonymous_gets_401_and_an_unconfigured_admin_list_admits_nobody(
    new_client, sign_in, settings
):
    async with new_client() as anon:
        assert (await anon.get("/api/admin/usage")).status_code == 401
    settings.admin_emails = ""
    async with new_client() as c:
        await sign_in(c, "boss@example.com")
        assert (await c.get("/api/admin/usage")).status_code == 401


async def test_a_staff_member_is_admitted(boss):
    assert (await boss.get("/api/admin/usage")).status_code == 200


async def test_the_customer_app_never_says_who_is_staff(new_client, sign_in, settings):
    settings.admin_emails = "boss@example.com"
    async with new_client() as c:
        me = (await sign_in(c, "boss@example.com")).json()
        assert "is_admin" not in me and "is_admin" not in (await c.get("/api/me")).json()


@pytest.mark.parametrize("days", [0, 91, -1, "x"])
async def test_the_window_is_validated(boss, days):
    assert (await boss.get(f"/api/admin/usage?days={days}")).status_code == 422


# ---------------------------------------------------------------- the numbers


async def test_costs_are_computed_from_counts_and_the_configured_prices(boss, db, settings):
    a = await add_user(db, "a@example.com")
    b = await add_user(db, "b@example.com")
    db.add_all(
        [
            Usage(
                user_id=a,
                day=TODAY,
                stt_seconds=1800,
                llm_input_tokens=250_000,
                llm_output_tokens=10_000,
                research_jobs=2,
            ),
            Usage(
                user_id=b,
                day=TODAY,
                stt_seconds=600,
                llm_input_tokens=100_000,
                llm_output_tokens=5_000,
                research_jobs=1,
            ),
        ]
    )
    await db.commit()
    d = (await boss.get("/api/admin/usage?days=7")).json()
    day = d["days"][0]
    p = d["prices"]
    expected = (
        2400 * p["stt_per_minute"] / 60
        + 350_000 * p["llm_input_per_million"] / 1_000_000
        + 15_000 * p["llm_output_per_million"] / 1_000_000
    )
    assert day["day"] == TODAY.isoformat()
    assert (
        day["stt_seconds"],
        day["llm_input_tokens"],
        day["llm_output_tokens"],
        day["active_users"],
    ) == (2400, 350_000, 15_000, 2)
    assert day["estimated_cost_usd"] == pytest.approx(expected, abs=1e-4)
    assert d["total_cost_usd"] == pytest.approx(expected, abs=1e-4)
    assert d["research_jobs"] == 3


async def test_per_session_and_per_research_job_averages(boss, db, settings):
    a = await add_user(db, "a@example.com")
    db.add(
        Usage(
            user_id=a,
            day=TODAY,
            stt_seconds=3600,
            llm_input_tokens=0,
            llm_output_tokens=0,
            research_jobs=2,
        )
    )
    now = datetime.now(UTC)
    for _ in range(4):
        db.add(PracticeSession(user_id=a, consent_confirmed_at=now, started_at=now))
    db.add_all(
        [
            ResearchJob(user_id=a, company_id=await _company(db, a), tokens=500_000),
            ResearchJob(user_id=a, company_id=await _company(db, a), tokens=500_000),
        ]
    )
    await db.commit()
    d = (await boss.get("/api/admin/usage")).json()
    p = d["prices"]
    research_cost = 1_000_000 * p["llm_input_per_million"] / 1_000_000
    session_cost = 3600 * p["stt_per_minute"] / 60
    assert d["sessions"] == 4
    assert d["avg_cost_per_session_usd"] == pytest.approx(session_cost / 4, abs=1e-4)
    assert d["avg_cost_per_research_job_usd"] == pytest.approx(research_cost / 2, abs=1e-4)
    assert d["total_cost_usd"] == pytest.approx(session_cost + research_cost, abs=1e-4)


async def _company(db, uid):
    from app.models import Company

    c = Company(user_id=uid, name=f"Co {uuid.uuid4().hex[:6]}")
    db.add(c)
    await db.flush()
    return c.id


async def test_only_the_requested_window_is_counted(boss, db):
    a = await add_user(db, "a@example.com")
    db.add_all(
        [
            Usage(user_id=a, day=TODAY, stt_seconds=60),
            Usage(user_id=a, day=TODAY - timedelta(days=3), stt_seconds=120),
            Usage(user_id=a, day=TODAY - timedelta(days=40), stt_seconds=999_999),
        ]
    )
    await db.commit()
    week = (await boss.get("/api/admin/usage?days=7")).json()
    assert [x["stt_seconds"] for x in week["days"]] == [
        60,
        120,
    ]  # newest first; the old row is excluded
    quarter = (await boss.get("/api/admin/usage?days=90")).json()
    assert sum(x["stt_seconds"] for x in quarter["days"]) == 60 + 120 + 999_999


async def test_top_users_are_the_ten_costliest_in_order(boss, db):
    for i in range(12):
        uid = await add_user(db, f"user{i:02d}@example.com")
        db.add(Usage(user_id=uid, day=TODAY, stt_seconds=100 * (i + 1)))
    await db.commit()
    top = (await boss.get("/api/admin/usage")).json()["top_users"]
    assert len(top) == 10
    assert [t["email"] for t in top][:3] == [
        "user11@example.com",
        "user10@example.com",
        "user09@example.com",
    ]
    assert [t["estimated_cost_usd"] for t in top] == sorted(
        (t["estimated_cost_usd"] for t in top), reverse=True
    )
    assert top[0]["stt_seconds"] == 1200


async def test_an_empty_system_reports_zeros_not_errors(boss):
    d = (await boss.get("/api/admin/usage")).json()
    assert d["days"] == [] and d["top_users"] == [] and d["total_cost_usd"] == 0
    assert d["avg_cost_per_session_usd"] is None and d["avg_cost_per_research_job_usd"] is None


async def test_the_caps_in_force_are_shown_next_to_the_numbers(boss, settings):
    d = (await boss.get("/api/admin/usage")).json()
    assert d["caps"] == {
        "stt_seconds_daily": settings.cap_stt_seconds_daily,
        "tokens_daily": settings.cap_tokens_daily,
        "research_jobs_daily": settings.cap_research_jobs_daily,
    }


async def test_the_view_exposes_no_content_only_emails_and_counts(boss, db):
    a = await add_user(db, "a@example.com")
    db.add(Usage(user_id=a, day=TODAY, stt_seconds=60))
    await db.commit()
    text = (await boss.get("/api/admin/usage")).text
    assert "transcript" not in text and "notes" not in text and "extracted" not in text
