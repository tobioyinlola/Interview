"""Phase 1: the flag, the search profile, CV facts, answers, authorisation and the 30-day clock."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.autoapply import clock as ck
from app.models import Campaign, Event
from tests.autoapply.conftest import FACTS, PROFILE

POLICY = "2026-11"


async def enable(c, **over):
    body = {"policy_version": POLICY, "accept": True, **over}
    return await c.post("/api/autoapply/campaign/enable", json=body)


async def ready(c):
    assert (await c.put("/api/autoapply/profile", json=PROFILE)).status_code == 200


# ------------------------------------------------------------------------------- the flag


async def test_the_whole_feature_is_a_404_while_the_flag_is_off(new_client, sign_in, settings):
    settings.autoapply_enabled = False
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        for method, path in (
            ("get", "/api/autoapply/status"),
            ("get", "/api/autoapply/profile"),
            ("post", "/api/autoapply/campaign/enable"),
        ):
            assert (await getattr(c, method)(path)).status_code == 404


async def test_signed_out_visitors_get_401(new_client):
    async with new_client() as c:
        assert (await c.get("/api/autoapply/status")).status_code == 401


# ------------------------------------------------------------------------------- the profile


async def test_a_new_candidate_has_nothing_running(ada):
    s = (await ada.get("/api/autoapply/status")).json()
    assert s["enabled"] is True and s["campaign"]["state"] == "none"
    p = (await ada.get("/api/autoapply/profile")).json()
    assert p["criteria"] == {} and p["channels"] == {
        "form": False,
        "email": False,
        "outreach": False,
    }


async def test_the_profile_is_saved_normalised_and_versioned(ada):
    r = (await ada.put("/api/autoapply/profile", json=PROFILE)).json()
    assert r["timezone"] == "Africa/Lagos" and r["daily_application_cap"] == 5
    assert r["criteria"]["roles"] == [{"value": "Senior Product Manager", "required": True}]
    assert r["criteria"]["arrangement"] == [{"value": "remote", "required": True}]
    assert r["version"] == 1
    again = (await ada.put("/api/autoapply/profile", json=PROFILE)).json()
    assert again["version"] == 1  # nothing changed, so queued work is not disturbed
    changed = {**PROFILE, "criteria": {**PROFILE["criteria"], "roles": ["Head of Product"]}}
    assert (await ada.put("/api/autoapply/profile", json=changed)).json()["version"] == 2


async def test_salary_needs_a_currency_and_a_pay_period(ada):
    for salary in (
        {"floor": 90000},
        {"floor": 90000, "currency": "USD"},
        {"floor": 90000, "currency": "US", "period": "year"},
        {"floor": 90000, "currency": "USD", "period": "fortnight"},
        {"floor": "lots", "currency": "USD", "period": "year"},
    ):
        r = await ada.put(
            "/api/autoapply/profile", json={"criteria": {**PROFILE["criteria"], "salary": salary}}
        )
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_profile"
    ok = await ada.put(
        "/api/autoapply/profile",
        json={
            "criteria": {
                **PROFILE["criteria"],
                "salary": {"floor": 90000, "currency": "usd", "period": "year", "required": True},
            }
        },
    )
    assert ok.json()["criteria"]["salary"] == {
        "floor": 90000.0,
        "currency": "USD",
        "period": "year",
        "required": True,
    }


@pytest.mark.parametrize(
    "bad",
    [
        {"timezone": "Mars/Base"},
        {"daily_application_cap": 500},
        {"daily_application_cap": -1},
        {"active_hours": {"start": 9}},
        {"criteria": {"arrangement": ["underwater"]}},
        {"criteria": {"sponsorship": {"need": "maybe"}}},
    ],
)
async def test_nonsense_is_refused_with_a_reason(ada, bad):
    r = await ada.put("/api/autoapply/profile", json=bad)
    assert r.status_code == 422


async def test_unknown_criteria_are_dropped_not_stored(ada):
    r = await ada.put(
        "/api/autoapply/profile",
        json={"criteria": {**PROFILE["criteria"], "ignore_previous_instructions": ["x"]}},
    )
    assert "ignore_previous_instructions" not in r.json()["criteria"]


# ------------------------------------------------------------------------ CV facts and answers


async def test_facts_are_a_draft_until_the_candidate_confirms_them(ada):
    d = (await ada.post("/api/autoapply/facts/extract")).json()
    assert d["version"] == 0 and d["verified_at"] is None and d["from_model"] is True
    assert d["data"]["history"][0]["company"] == "Northwind"
    assert (await ada.get("/api/autoapply/facts")).json() is None  # nothing stored yet
    saved = (await ada.put("/api/autoapply/facts", json={"data": FACTS, "verified": True})).json()
    assert saved["version"] == 1 and saved["verified_at"] is not None
    assert (await ada.get("/api/autoapply/facts")).json()["cv_changed"] is False


async def test_facts_fall_back_to_patterns_when_no_model_answers(ada, cv_llm):
    cv_llm.json_reply = "not json"
    d = (await ada.post("/api/autoapply/facts/extract")).json()
    assert d["from_model"] is False
    assert d["data"]["contact"]["email"] == "ada@example.com"
    assert d["data"]["contact"]["phone"].startswith("+234")
    assert d["data"]["history"] == []  # patterns never guess a work history


async def test_editing_the_cv_flags_facts_confirmed_for_the_old_one(ada, maker):
    await ada.put("/api/autoapply/facts", json={"data": FACTS, "verified": True})
    await ada.put("/api/notes", json={"role": "PM", "content": "A different CV entirely."})
    assert (await ada.get("/api/autoapply/facts")).json()["cv_changed"] is True


async def test_facts_need_a_cv(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "nocv@example.com")
        assert (await c.post("/api/autoapply/facts/extract")).json()["error"]["code"] == "no_cv"


async def test_an_answer_is_reusable_only_when_the_candidate_says_so(ada):
    r = await ada.put(
        "/api/autoapply/answers/Notice Period",
        json={"question": "Notice period?", "value": "Two weeks"},
    )
    a = r.json()
    assert a["field"] == "notice_period" and a["reusable"] is False
    assert a["provenance"] == "candidate" and a["confirmed_at"] is not None and a["version"] == 1
    again = await ada.put(
        "/api/autoapply/answers/notice_period",
        json={"value": "One month", "reusable": True},
    )
    assert again.json()["version"] == 2 and again.json()["reusable"] is True
    assert again.json()["question"] == "Notice period?"  # kept from before
    assert len((await ada.get("/api/autoapply/answers")).json()) == 1
    await ada.delete("/api/autoapply/answers/notice_period")
    assert (await ada.get("/api/autoapply/answers")).json() == []


async def test_facts_and_answers_are_private(new_client, sign_in, ada):
    await ada.put("/api/autoapply/facts", json={"data": FACTS, "verified": True})
    await ada.put("/api/autoapply/answers/visa", json={"value": "No sponsorship needed"})
    async with new_client() as other:
        await sign_in(other, "eve@example.com")
        assert (await other.get("/api/autoapply/facts")).json() is None
        assert (await other.get("/api/autoapply/answers")).json() == []
        assert (await other.get("/api/autoapply/profile")).json()["criteria"] == {}


# ----------------------------------------------------------------------- authorising a campaign


async def test_it_cannot_be_switched_on_until_it_is_set_up(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "fresh@example.com")
        assert (await enable(c)).json()["error"]["code"] == "no_profile"
        await c.put("/api/autoapply/profile", json={"channels": {"form": True}})
        d = (await c.get("/api/autoapply/authorization")).json()
        assert "Upload your CV first." in d["problems"]
        assert "Add at least one target role." in d["problems"]
        r = await enable(c)
        assert r.status_code == 422 and r.json()["error"]["code"] == "not_ready"


async def test_the_candidate_sees_what_is_shared_before_agreeing(ada):
    await ready(ada)
    d = (await ada.get("/api/autoapply/authorization")).json()
    assert d["policy_version"] == POLICY and d["problems"] == []
    assert d["channels"] == {"form": True, "email": False, "outreach": False}
    assert d["daily_application_cap"] == 5 and d["mailbox"] is None
    assert any("CV" in line for line in d["shared"])


async def test_agreement_is_explicit_and_tied_to_the_current_terms(ada):
    await ready(ada)
    assert (await enable(ada, accept=False)).json()["error"]["code"] == "not_accepted"
    old = await enable(ada, policy_version="2020-01")
    assert old.status_code == 409 and old.json()["error"]["code"] == "policy_changed"
    ok = await enable(ada)
    assert ok.status_code == 201 and ok.json()["state"] == "active" and ok.json()["day"] == 1


async def test_email_channels_need_a_connected_mailbox(ada):
    await ada.put("/api/autoapply/profile", json={**PROFILE, "channels": {"email": True}})
    r = await enable(ada)
    assert r.status_code == 422 and "Connect your email" in r.json()["error"]["message"]


async def test_the_authorisation_is_recorded_with_the_campaign(ada, maker):
    await ready(ada)
    await enable(ada)
    async with maker() as db:
        c = (await db.execute(select(Campaign))).scalar_one()
        assert c.policy_version == POLICY and c.channels["form"] is True
        assert c.daily_application_cap == 5 and c.authorization["shared"]
        kinds = (await db.execute(select(Event.kind))).scalars().all()
    assert "autoapply.enabled" in kinds


async def test_only_one_campaign_can_run_at_a_time(ada):
    await ready(ada)
    await enable(ada)
    assert (await enable(ada)).json()["error"]["code"] == "already_active"


# ------------------------------------------------------------------------- the 30-day clock


async def test_day_one_is_the_activation_date_in_the_candidates_timezone():
    # 23:30 UTC on 2 Nov is already 00:30 on 3 Nov in Lagos (UTC+1)
    when = datetime(2026, 11, 2, 23, 30, tzinfo=UTC)
    assert ck.local_day(when, "Africa/Lagos").isoformat() == "2026-11-03"
    assert ck.campaign_day(when, when, "Africa/Lagos") == 1


async def test_outbound_work_closes_at_the_start_of_day_31():
    start = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)  # Lagos, 10:00
    end = ck.campaign_end(start, "Africa/Lagos")
    assert end == datetime(2026, 12, 1, 23, 0, tzinfo=UTC)  # 2 Dec 00:00 in Lagos: day 31
    assert ck.campaign_day(start, end - timedelta(seconds=1), "Africa/Lagos") == 30
    assert ck.campaign_day(start, end, "Africa/Lagos") == 31


async def test_a_campaign_across_a_clock_change_is_still_thirty_local_days():
    start = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)  # New York clocks go back on 1 Nov
    end = ck.campaign_end(start, "America/New_York")
    assert (
        ck.local_day(end, "America/New_York").isoformat() == "2026-11-19"
    )  # day 1 is 20 Oct, so day 31 is 19 Nov
    assert end.astimezone(ck.zone("America/New_York")).hour == 0


async def test_active_hours_are_in_the_candidates_own_time():
    noon_utc = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)  # 13:00 in Lagos
    assert ck.within_active_hours(noon_utc, "Africa/Lagos", {"start": 9, "end": 18})
    assert not ck.within_active_hours(noon_utc, "Asia/Tokyo", {"start": 9, "end": 18})  # 21:00
    assert ck.within_active_hours(noon_utc, "Asia/Tokyo", None)
    assert ck.within_active_hours(noon_utc, "Asia/Tokyo", {"start": 20, "end": 6})  # overnight


async def test_progress_runs_from_day_one_to_thirty_then_ends(ada, clock, maker):
    await ready(ada)
    await enable(ada)
    st = (await ada.get("/api/autoapply/status")).json()["campaign"]
    assert st["state"] == "active" and st["day"] == 1 and st["days_total"] == 30
    clock.now += timedelta(days=29)
    st = (await ada.get("/api/autoapply/status")).json()["campaign"]
    assert st["state"] == "active" and st["day"] == 30
    clock.now += timedelta(days=1)
    st = (await ada.get("/api/autoapply/status")).json()["campaign"]
    assert st["state"] == "ended" and st["day"] == 30
    from app.autoapply.campaign import close_expired

    async with maker() as db:
        assert await close_expired(db, clock.now) == 1
        assert await close_expired(db, clock.now) == 0  # closing is idempotent
        assert (await db.execute(select(Campaign.status))).scalar_one() == "ended"


async def test_a_finished_campaign_can_be_renewed_only_by_activating_again(ada, clock, maker):
    from app.autoapply.campaign import close_expired

    await ready(ada)
    await enable(ada)
    clock.now += timedelta(days=31)
    async with maker() as db:
        await close_expired(db, clock.now)
    assert (await ada.post("/api/autoapply/campaign/resume")).json()["error"][
        "code"
    ] == "not_active"
    again = await enable(ada)
    assert again.status_code == 201 and again.json()["day"] == 1
    async with maker() as db:
        assert len((await db.execute(select(Campaign))).scalars().all()) == 2


# ------------------------------------------------------------------------------ pause


async def test_pausing_does_not_extend_the_end_date(ada, clock):
    await ready(ada)
    first = (await enable(ada)).json()
    clock.now += timedelta(days=5)
    paused = (await ada.post("/api/autoapply/campaign/pause")).json()
    assert paused["state"] == "paused" and paused["ends_at"] == first["ends_at"]
    clock.now += timedelta(days=10)
    resumed = (await ada.post("/api/autoapply/campaign/resume")).json()
    assert resumed["state"] == "active" and resumed["ends_at"] == first["ends_at"]
    assert resumed["day"] == 16


async def test_a_campaign_cannot_be_resumed_after_it_is_over(ada, clock):
    await ready(ada)
    await enable(ada)
    await ada.post("/api/autoapply/campaign/pause")
    clock.now += timedelta(days=40)
    r = await ada.post("/api/autoapply/campaign/resume")
    assert r.json()["error"]["code"] == "campaign_over"


async def test_pause_and_resume_are_recorded_once_each(ada, maker):
    await ready(ada)
    await enable(ada)
    for _ in range(2):
        await ada.post("/api/autoapply/campaign/pause")
    await ada.post("/api/autoapply/campaign/resume")
    async with maker() as db:
        kinds = list((await db.execute(select(Event.kind))).scalars().all())
    assert kinds.count("autoapply.paused") == 1 and kinds.count("autoapply.resumed") == 1


async def test_details_from_settings_fill_gaps_the_cv_left(ada, cv_llm):
    cv_llm.json_reply = "not json"  # only patterns read the CV: no location, no history
    await ada.put(
        "/api/profile",
        json={"location": "Lagos, Nigeria", "linkedin_url": "https://linkedin.com/in/ada"},
    )
    d = (await ada.post("/api/autoapply/facts/extract")).json()["data"]
    assert d["contact"]["location"] == "Lagos, Nigeria"
    assert "https://linkedin.com/in/ada" in d["links"]
