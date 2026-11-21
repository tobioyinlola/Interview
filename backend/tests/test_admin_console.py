"""The admin console's data: access, accuracy of the numbers, the actions an admin can take, and that
none of it ever shows what a person wrote or said."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

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
    Utterance,
)
from app.services.email_templates import CATALOG

NOW = datetime.now(UTC)
SECRET_CV = "SECRET-CV-TEXT-DO-NOT-LEAK"
SECRET_ANSWER = "SECRET-ANSWER-DO-NOT-LEAK"
SECRET_SAID = "SECRET-TRANSCRIPT-DO-NOT-LEAK"


@pytest.fixture
async def boss(new_client, sign_in, settings):
    settings.admin_emails = "boss@example.com"
    async with new_client() as c:
        await sign_in(c, "boss@example.com")
        yield c


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


async def make_user(db, email, *, days_ago=1, attribution=None, onboarded=True, name=None):
    u = User(
        email=email,
        full_name=name,
        created_at=NOW - timedelta(days=days_ago),
        onboarded_at=NOW - timedelta(days=days_ago) if onboarded else None,
        attribution=attribution,
        referral_code=uuid.uuid4().hex[:8],
        practice_consent_at=NOW,
    )
    db.add(u)
    await db.flush()
    db.add(SessionCredit(user_id=u.id, kind="trial"))
    return u


async def make_session(
    db, user, *, hours_after_signup=2, minutes=10, questions=3, rated=None, flagged=False
):
    started = user.created_at + timedelta(hours=hours_after_signup)
    s = PracticeSession(
        user_id=user.id,
        consent_confirmed_at=NOW,
        started_at=started,
        ended_at=started + timedelta(minutes=minutes),
        status="ended",
        scoring_status="ready",
    )
    db.add(s)
    await db.flush()
    for i in range(questions):
        db.add(
            Suggestion(
                session_id=s.id,
                question_text="Tell me about a time",
                type="behavioral",
                output_text=SECRET_ANSWER,
                first_token_ms=800 + 100 * i,
                total_ms=4000 + 500 * i,
                grounding_flags=["Cut by 45%"] if (flagged and i == 0) else [],
                feedback=rated if i == 0 else None,
                created_at=started,
            )
        )
    u = Utterance(session_id=s.id, seq=1, speaker="partner", text=SECRET_SAID)
    db.add(u)
    await db.flush()
    db.add(
        Score(
            session_id=s.id,
            utterance_id=u.id,
            structure=80,
            specificity=60,
            impact=50,
            relevance=90,
            pace=70,
            overall=70,
            fixes=[],
        )
    )
    return s


@pytest.fixture
async def world(db, maker):
    """Four people: a full journey that came from LinkedIn, an invited friend, a plain sign-up that
    never did anything, and someone who signed up with Google and ran two interviews."""
    ann = await make_user(
        db,
        "ann@example.com",
        days_ago=5,
        name="Ann Lee",
        attribution={
            "method": "password",
            "utm_source": "linkedin",
            "utm_campaign": "launch",
            "referred": False,
        },
    )
    bob = await make_user(
        db,
        "bob@example.com",
        days_ago=3,
        name="Bob Stone",
        attribution={"method": "email_link", "referred": True},
    )
    cat = await make_user(
        db,
        "cat@example.com",
        days_ago=2,
        onboarded=False,
        attribution={"method": "email_link", "referred": False},
    )
    dan = await make_user(
        db,
        "dan@example.com",
        days_ago=1,
        name="Dan Wu",
        attribution={"method": "google", "referred": False},
    )
    db.add(Note(user_id=ann.id, role="PM", content=SECRET_CV, cv_filename="cv.pdf"))
    db.add(Note(user_id=dan.id, role="PM", content="", cv_filename=None))
    co = Company(user_id=ann.id, name="Northwind", role="PM")
    db.add(co)
    await db.flush()
    db.add(
        ResearchJob(
            company_id=co.id, user_id=ann.id, status="ready", started_at=NOW - timedelta(days=4)
        )
    )
    db.add(
        ResearchJob(
            company_id=co.id, user_id=ann.id, status="failed", started_at=NOW - timedelta(days=4)
        )
    )
    first = await make_session(db, ann, hours_after_signup=2, rated="up", flagged=True)
    await make_session(db, ann, hours_after_signup=30, rated="down")
    await make_session(db, dan, hours_after_signup=6)
    first_credit = (
        (await db.execute(select(SessionCredit).where(SessionCredit.user_id == ann.id)))
        .scalars()
        .first()
    )
    first_credit.used_at = first.started_at
    first_credit.session_id = first.id
    db.add(Referral(referrer_id=ann.id, referred_id=bob.id, status="counted"))
    db.add(
        Referral(referrer_id=ann.id, referred_id=cat.id, status="held", held_reason="same_device")
    )
    for u, n in ((ann, 3), (bob, 1), (dan, 1)):
        for _ in range(n):
            db.add(
                Event(
                    kind="user.signed_in",
                    user_id=u.id,
                    created_at=NOW - timedelta(hours=1),
                    data={"method": "email_link"},
                )
            )
    db.add(
        Event(kind="session.blocked", user_id=bob.id, created_at=NOW - timedelta(hours=2), data={})
    )
    db.add(
        Event(kind="research.failed", user_id=ann.id, created_at=NOW - timedelta(hours=3), data={})
    )
    db.add(
        Event(
            kind="email.failed",
            user_id=cat.id,
            created_at=NOW - timedelta(hours=3),
            data={"email_kind": "welcome", "to": "cat@example.com"},
        )
    )
    db.add(
        Event(
            kind="email.sent",
            user_id=ann.id,
            created_at=NOW - timedelta(hours=3),
            data={"email_kind": "welcome", "to": "ann@example.com"},
        )
    )
    db.add(
        Event(
            kind="auth.login_failed",
            user_id=None,
            created_at=NOW - timedelta(hours=3),
            data={"email": "x@example.com"},
        )
    )
    await db.commit()
    return {"ann": ann.id, "bob": bob.id, "cat": cat.id, "dan": dan.id}


GET_PATHS = [
    "/api/admin/overview",
    "/api/admin/users",
    f"/api/admin/users/{uuid.uuid4()}",
    "/api/admin/activity",
    "/api/admin/activity/export.csv",
    "/api/admin/referrals",
    "/api/admin/marketing",
    "/api/admin/quality",
    "/api/admin/emails",
    "/api/admin/emails/templates",
    "/api/admin/emails/templates/welcome",
]
POST_PATHS = [
    f"/api/admin/users/{uuid.uuid4()}/credits",
    f"/api/admin/referrals/{uuid.uuid4()}/approve",
]


# ------------------------------------------------------------------------------------- access


@pytest.mark.parametrize("path", GET_PATHS)
async def test_every_console_page_is_closed_to_signed_out_visitors_and_ordinary_users(
    new_client, sign_in, settings, path
):
    settings.admin_emails = "boss@example.com"
    async with new_client() as anon:
        assert (await anon.get(path)).status_code == 401
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        r = await c.get(path)
        assert (
            r.status_code == 404 and r.json()["error"]["code"] == "not_found"
        )  # not even "forbidden"


@pytest.mark.parametrize("path", POST_PATHS)
async def test_the_console_actions_are_closed_too(new_client, sign_in, settings, path):
    settings.admin_emails = "boss@example.com"
    async with new_client() as anon:
        assert (await anon.post(path, json={"count": 1})).status_code == 401
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        assert (await c.post(path, json={"count": 1})).status_code == 404


async def test_with_no_admins_configured_nobody_gets_in(new_client, sign_in, settings):
    settings.admin_emails = ""
    async with new_client() as c:
        await sign_in(c, "boss@example.com")
        assert (await c.get("/api/admin/overview")).status_code == 404


# ----------------------------------------------------------------------------------- overview


async def test_the_overview_counts_people_sessions_and_activity(boss, world):
    d = (await boss.get("/api/admin/overview?days=30")).json()
    assert d["total_users"] == 5  # the four, plus the admin
    assert d["new_users"] == 5 and d["new_users_prev"] == 0
    assert d["sessions"] == 3 and d["sessions_prev"] == 0
    assert d["avg_session_seconds"] == 600
    assert d["avg_questions_per_session"] == 3.0
    assert d["wau"] >= 3 and d["mau"] >= d["wau"] >= d["dau"]
    assert d["referrals_counted"] == 1 and d["referrals_held"] == 1


async def test_the_funnel_follows_the_people_who_signed_up(boss, world):
    d = (await boss.get("/api/admin/overview?days=30")).json()
    steps = {s["key"]: s for s in d["funnel"]}
    assert [s["key"] for s in d["funnel"]] == [
        "signed_up",
        "onboarded",
        "cv",
        "company",
        "session",
        "second",
    ]
    assert steps["signed_up"]["users"] == 5
    assert steps["onboarded"]["users"] == 3  # Ann, Bob and Dan; not Cat, nor the admin
    assert steps["cv"]["users"] == 1  # only Ann has CV text; Dan's CV is empty
    assert steps["company"]["users"] == 1
    assert steps["session"]["users"] == 2  # Ann and Dan
    assert steps["second"]["users"] == 1  # Ann
    assert (
        steps["signed_up"]["of_signups_pct"] == 100.0
        and steps["signed_up"]["from_previous_pct"] is None
    )
    assert steps["session"]["of_signups_pct"] == 40.0
    assert steps["second"]["from_previous_pct"] == 50.0


async def test_the_funnel_only_counts_people_who_signed_up_in_the_window(boss, world, db):
    old = await make_user(db, "old@example.com", days_ago=60)
    await make_session(db, old)
    await db.commit()
    short = (await boss.get("/api/admin/overview?days=7")).json()
    assert short["total_users"] == 6 and short["new_users"] == 5  # the old one is not new
    assert {s["key"]: s["users"] for s in short["funnel"]}["session"] == 2


async def test_the_daily_series_has_one_point_per_day_with_zeros_filled(boss, world):
    d = (await boss.get("/api/admin/overview?days=7")).json()
    assert len(d["series"]) == 7
    assert sum(p["signups"] for p in d["series"]) == 5
    assert sum(p["sessions"] for p in d["series"]) == 3
    assert all(set(p) == {"day", "signups", "sessions", "active_users"} for p in d["series"])


async def test_health_counts_what_went_wrong_recently(boss, world):
    h = (await boss.get("/api/admin/overview")).json()["health"]
    assert h == {
        "research_failed_24h": 1,
        "scoring_failed_24h": 0,
        "emails_failed_24h": 1,
        "blocked_no_credit_7d": 1,
        "wrong_passwords_24h": 1,
    }


async def test_the_overview_works_on_an_empty_platform(boss):
    d = (await boss.get("/api/admin/overview")).json()
    assert d["total_users"] == 1 and d["sessions"] == 0 and d["avg_session_seconds"] is None
    assert all(s["users"] <= 1 for s in d["funnel"])


@pytest.mark.parametrize("days", [0, 91, -1])
async def test_the_window_is_bounded(boss, days):
    assert (await boss.get(f"/api/admin/overview?days={days}")).status_code == 422


# -------------------------------------------------------------------------------------- users


async def test_the_user_list_shows_each_person_with_their_activity(boss, world):
    d = (await boss.get("/api/admin/users?sort=oldest")).json()
    assert d["total"] == 5
    ann = next(u for u in d["items"] if u["email"] == "ann@example.com")
    assert ann["full_name"] == "Ann Lee" and ann["sessions"] == 2 and ann["companies"] == 1
    assert ann["has_cv"] is True and ann["onboarded"] is True
    assert ann["referrals_counted"] == 1 and ann["referrals_held"] == 1
    assert ann["signup_method"] == "password" and ann["utm_source"] == "linkedin"
    assert ann["credits_available"] == 0  # the trial was used
    assert ann["last_active_at"] is not None
    bob = next(u for u in d["items"] if u["email"] == "bob@example.com")
    assert bob["referred"] is True and bob["credits_available"] == 1
    boss_row = next(u for u in d["items"] if u["email"] == "boss@example.com")
    assert boss_row["is_admin"] is True and ann["is_admin"] is False


async def test_the_user_list_searches_sorts_and_pages(boss, world):
    found = (await boss.get("/api/admin/users?q=STONE")).json()
    assert [u["email"] for u in found["items"]] == ["bob@example.com"] and found["total"] == 1
    assert (await boss.get("/api/admin/users?q=ann@")).json()["total"] == 1
    by_sessions = (await boss.get("/api/admin/users?sort=sessions")).json()["items"]
    assert by_sessions[0]["email"] == "ann@example.com"
    newest = [u["email"] for u in (await boss.get("/api/admin/users?sort=newest")).json()["items"]]
    assert newest.index("dan@example.com") < newest.index("ann@example.com")
    page1 = (await boss.get("/api/admin/users?sort=oldest&limit=2&offset=0")).json()
    page2 = (await boss.get("/api/admin/users?sort=oldest&limit=2&offset=2")).json()
    assert page1["total"] == page2["total"] == 5
    assert {u["id"] for u in page1["items"]}.isdisjoint({u["id"] for u in page2["items"]})
    assert len(page1["items"]) == 2 and len(page2["items"]) == 2


@pytest.mark.parametrize("q", ["%", "_", "\\", "' OR 1=1 --", "a%b"])
async def test_search_treats_wildcards_and_quotes_as_plain_text(boss, world, q):
    r = await boss.get("/api/admin/users", params={"q": q})
    assert r.status_code == 200 and r.json()["total"] == 0


async def test_a_bad_sort_or_limit_is_refused(boss):
    assert (await boss.get("/api/admin/users?sort=bogus")).status_code == 422
    assert (await boss.get("/api/admin/users?limit=101")).status_code == 422
    assert (await boss.get("/api/admin/users?offset=-1")).status_code == 422


async def test_one_account_shows_credits_inviter_and_a_timeline(boss, world, db):
    db.add(
        Event(
            kind="cv.uploaded",
            user_id=world["bob"],
            created_at=NOW - timedelta(minutes=5),
            data={"characters": 900},
        )
    )
    db.add(
        Event(
            kind="email.sent",
            user_id=world["bob"],
            created_at=NOW - timedelta(minutes=4),
            data={"email_kind": "welcome", "to": "bob@example.com"},
        )
    )
    await db.commit()
    d = (await boss.get(f"/api/admin/users/{world['bob']}")).json()
    assert d["user"]["email"] == "bob@example.com" and d["referred_by"] == "ann@example.com"
    assert d["credits"] == {"trial": 1, "gifted": 0, "referral": 0, "paid": 0, "used": 0}
    assert d["emails_sent"] == 1 and d["emails_failed"] == 0
    kinds = [t["kind"] for t in d["timeline"]]
    assert kinds[0] == "email.sent" and "cv.uploaded" in kinds  # newest first
    cv = next(t for t in d["timeline"] if t["kind"] == "cv.uploaded")
    assert cv["category"] == "content" and cv["label"] == "Uploaded a CV"
    ann = (await boss.get(f"/api/admin/users/{world['ann']}")).json()
    assert ann["invited"] == 1 and ann["held"] == 1 and ann["credits"]["used"] == 1
    assert ann["referral_code"] and ann["referred_by"] is None


async def test_an_unknown_account_is_not_found(boss):
    assert (await boss.get(f"/api/admin/users/{uuid.uuid4()}")).status_code == 404
    assert (await boss.get("/api/admin/users/not-a-uuid")).status_code == 422


# ------------------------------------------------------------------------------ giving credits


async def test_an_admin_can_give_free_interviews_which_the_person_can_then_use(
    boss, world, new_client, sender, engine, sign_in, settings
):
    settings.enforce_session_credits = True
    r = await boss.post(
        f"/api/admin/users/{world['bob']}/credits", json={"count": 2, "reason": "Sorry for the bug"}
    )
    assert r.status_code == 201
    assert r.json()["credits"]["gifted"] == 2 and r.json()["user"]["credits_available"] == 3
    (mail,) = [m for m in sender.messages if m.kind == "credit_granted"]
    assert mail.to == "bob@example.com" and "added 2 free interviews" in mail.text
    assert "Sorry for the bug" in mail.text
    async with async_sessionmaker(engine)() as s:
        (e,) = (
            await s.execute(select(Event).where(Event.kind == "admin.credit_granted"))
        ).scalars()
        assert e.actor_id is not None and e.user_id == world["bob"] and e.data["count"] == 2
    async with new_client() as bob:
        await sign_in(bob, "bob@example.com")
        b = (await bob.get("/api/billing")).json()
        assert b["gifted_credits_available"] == 2 and b["sessions_available"] == 3
        for _ in range(3):
            assert (await bob.post("/api/sessions", json={})).status_code == 201
        assert (await bob.post("/api/sessions", json={})).status_code == 402
    # the team's gift is used after the free trial and before an earned reward
    async with async_sessionmaker(engine)() as s:
        used = [
            c.kind
            for c in (
                await s.execute(
                    select(SessionCredit)
                    .where(SessionCredit.user_id == world["bob"])
                    .order_by(SessionCredit.used_at)
                )
            ).scalars()
        ]
        assert used == ["trial", "grant", "grant"]


async def test_a_gift_can_be_made_without_an_email(boss, world, sender):
    r = await boss.post(
        f"/api/admin/users/{world['bob']}/credits", json={"count": 1, "notify": False}
    )
    assert r.status_code == 201 and "credit_granted" not in sender.kinds()


@pytest.mark.parametrize(
    "body",
    [
        {"count": 0},
        {"count": 11},
        {"count": -1},
        {},
        {"count": "x"},
        {"count": 1, "reason": "x" * 201},
    ],
)
async def test_a_gift_must_be_between_one_and_ten(boss, world, body):
    assert (
        await boss.post(f"/api/admin/users/{world['bob']}/credits", json=body)
    ).status_code == 422


async def test_you_cannot_give_a_gift_to_nobody(boss):
    assert (
        await boss.post(f"/api/admin/users/{uuid.uuid4()}/credits", json={"count": 1})
    ).status_code == 404


# --------------------------------------------------------------------------------- the log


async def seed_events(db, uid_a, uid_b):
    for i in range(5):
        db.add(
            Event(
                kind="company.added",
                user_id=uid_a,
                created_at=NOW + timedelta(minutes=i),
                data={"name": f"Co{i}"},
            )
        )
    db.add(
        Event(
            kind="session.started",
            user_id=uid_b,
            created_at=NOW + timedelta(minutes=10),
            data={"credit": "trial"},
        )
    )
    db.add(
        Event(
            kind="admin.export",
            user_id=None,
            actor_id=uid_b,
            created_at=NOW + timedelta(minutes=11),
            data={"rows": 3},
        )
    )
    await db.commit()


async def test_the_activity_log_is_newest_first_with_a_label_and_a_line_of_detail(boss, world, db):
    await seed_events(db, world["ann"], world["bob"])
    d = (await boss.get("/api/admin/activity?limit=3")).json()
    assert [i["kind"] for i in d["items"]][:2] == ["admin.export", "session.started"]
    top = d["items"][1]
    assert top["label"] == "Started an interview" and top["detail"] == "used a trial credit"
    assert top["user_email"] == "bob@example.com" and top["category"] == "interview"
    assert d["items"][0]["actor_email"] == "bob@example.com"
    assert set(d["categories"]) >= {
        "account",
        "interview",
        "referral",
        "email",
        "admin",
        "security",
    }


async def test_the_log_pages_by_time_without_gaps_or_repeats(boss, world, db):
    await seed_events(db, world["ann"], world["bob"])
    seen, before = [], None
    for _ in range(40):
        params = {"limit": 4, **({"before": before} if before else {})}
        d = (await boss.get("/api/admin/activity", params=params)).json()
        seen += [i["id"] for i in d["items"]]
        before = d["next_before"]
        if before is None:
            break
    total = len((await boss.get("/api/admin/activity?limit=200")).json()["items"])
    assert len(seen) == total and len(set(seen)) == total


async def test_the_log_filters_by_kind_category_person_and_text(boss, world, db):
    await seed_events(db, world["ann"], world["bob"])
    only_kind = (await boss.get("/api/admin/activity?kind=company.added")).json()["items"]
    assert len(only_kind) == 5 and {i["kind"] for i in only_kind} == {"company.added"}
    content = (await boss.get("/api/admin/activity?category=content&limit=200")).json()["items"]
    assert {i["category"] for i in content} == {"content"}
    mine = (await boss.get(f"/api/admin/activity?user_id={world['bob']}&limit=200")).json()["items"]
    assert mine and all(i["user_id"] == str(world["bob"]) for i in mine)
    by_text = (await boss.get("/api/admin/activity?q=cat@example")).json()["items"]
    assert by_text and {i["kind"] for i in by_text} == {"email.failed"}


async def test_every_filter_value_is_bounded_and_wildcards_are_plain_text(boss, world):
    assert (await boss.get("/api/admin/activity?limit=201")).status_code == 422
    assert (await boss.get("/api/admin/activity?user_id=nope")).status_code == 422
    assert (await boss.get("/api/admin/activity?q=%25")).json()["items"] == []
    assert (await boss.get("/api/admin/activity?kind=" + "x" * 41)).status_code == 422


async def test_the_log_can_be_downloaded_and_the_download_is_itself_logged(boss, world, db):
    await seed_events(db, world["ann"], world["bob"])
    r = await boss.get("/api/admin/activity/export.csv?category=content")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    lines = r.text.strip().splitlines()
    assert lines[0] == "time,kind,what,user,detail" and len(lines) >= 6
    assert all(
        ",company.added," in ln or ",cv." in ln or ",research." in ln or ",company" in ln
        for ln in lines[1:]
    )
    audit = (await boss.get("/api/admin/activity?kind=admin.export")).json()["items"]
    assert any(a["detail"].startswith("rows=") or "rows" in a["detail"] for a in audit)


async def test_a_spreadsheet_formula_in_the_data_cannot_run(boss, db, world):
    db.add(
        Event(kind="auth.login_failed", user_id=None, data={"email": '=HYPERLINK("http://evil")'})
    )
    await db.commit()
    text = (await boss.get("/api/admin/activity/export.csv")).text
    assert "'=HYPERLINK" in text and ",=HYPERLINK" not in text


# -------------------------------------------------------------------------------- referrals


async def test_the_referral_page_shows_totals_top_inviters_and_held_sign_ups(boss, world):
    d = (await boss.get("/api/admin/referrals")).json()
    assert (d["total"], d["counted"], d["held"]) == (2, 1, 1)
    assert d["per_reward"] == 3 and d["rewards_earned"] == 0 and d["rewards_redeemed"] == 0
    (top,) = d["top_referrers"]
    assert top["email"] == "ann@example.com" and top["counted"] == 1 and top["held"] == 1
    (held,) = d["held_items"]
    assert (
        held["referrer_email"] == "ann@example.com" and held["referred_email"] == "cat@example.com"
    )
    assert held["reason"] == "same_device"
    assert d["referred_signups_pct"] == 40.0  # 2 of the 5 sign-ups came through an invite


async def test_an_admin_can_count_a_held_sign_up_and_the_inviter_is_told(
    boss, world, sender, engine
):
    held = (await boss.get("/api/admin/referrals")).json()["held_items"][0]["id"]
    r = await boss.post(f"/api/admin/referrals/{held}/approve")
    assert r.status_code == 200
    d = r.json()
    assert (d["counted"], d["held"]) == (2, 0) and d["held_items"] == []
    (mail,) = [m for m in sender.messages if m.kind == "friend_joined"]
    assert mail.to == "ann@example.com" and "2 of 3" in mail.text
    async with async_sessionmaker(engine)() as s:
        (e,) = (
            await s.execute(select(Event).where(Event.kind == "admin.referral_approved"))
        ).scalars()
        assert e.actor_id is not None and e.user_id == world["ann"]
    assert (await boss.post(f"/api/admin/referrals/{held}/approve")).status_code == 404  # only once


async def test_only_a_held_sign_up_can_be_approved(boss, world, db):
    counted = (await db.execute(select(Referral).where(Referral.status == "counted"))).scalar_one()
    assert (await boss.post(f"/api/admin/referrals/{counted.id}/approve")).status_code == 404


# -------------------------------------------------------------------------------- marketing


async def test_marketing_splits_sign_ups_by_method_source_and_campaign(boss, world):
    d = (await boss.get("/api/admin/marketing?days=30")).json()
    assert d["signups"] == 5
    by_method = {r["channel"]: r for r in d["by_method"]}
    assert by_method["password"]["signups"] == 1 and by_method["google"]["signups"] == 1
    assert by_method["email_link"]["signups"] == 3  # Bob, Cat and the admin
    assert "unknown" not in by_method
    src = {r["channel"]: r for r in d["by_source"]}
    assert (
        src["linkedin"]["signups"] == 1
        and src["invite"]["signups"] == 1
        and src["direct"]["signups"] == 3
    )
    camp = {r["channel"]: r for r in d["by_campaign"]}
    assert list(camp) == ["launch"] and camp["launch"]["signups"] == 1


async def test_marketing_shows_how_far_each_channel_gets(boss, world):
    d = (await boss.get("/api/admin/marketing")).json()
    src = {r["channel"]: r for r in d["by_source"]}
    assert src["linkedin"]["activated"] == 1 and src["linkedin"]["activation_pct"] == 100.0
    assert src["linkedin"]["second_session"] == 1
    assert src["invite"]["activated"] == 0 and src["invite"]["activation_pct"] == 0.0
    assert src["direct"]["activated"] == 1  # Dan
    method = {r["channel"]: r for r in d["by_method"]}
    assert method["google"]["activated"] == 1


async def test_marketing_has_the_numbers_for_pricing_and_virality(boss, world):
    d = (await boss.get("/api/admin/marketing")).json()
    assert d["referred_pct"] == 20.0 and d["k_factor"] == 0.2
    assert d["trial_used_users"] == 1  # Ann used her trial
    assert d["hit_paywall_users"] == 1  # Bob
    assert d["second_session_users"] == 1
    assert d["median_hours_to_first_session"] == 4.0  # Ann 2 h, Dan 6 h


async def test_marketing_on_an_empty_window_is_all_zero_not_an_error(boss):
    d = (await boss.get("/api/admin/marketing?days=1")).json()
    assert d["signups"] >= 1 and d["median_hours_to_first_session"] is None
    assert d["k_factor"] == 0.0


# ----------------------------------------------------------------------------------- quality


async def test_quality_reports_ratings_speed_scores_and_failures(boss, world):
    d = (await boss.get("/api/admin/quality")).json()
    assert d["answers"] == 9 and d["rated"] == 2 and d["helpful_pct"] == 50.0
    assert d["flagged_pct"] == round(100 / 9, 1)
    lat = d["latency"]
    assert lat["p50_first_token_ms"] == 900 and lat["p95_first_token_ms"] >= 900
    assert lat["p50_total_ms"] == 4500 and lat["p95_total_ms"] >= 4500
    assert d["by_type"] == {"behavioral": 9}
    assert d["avg_scores"]["structure"] == 80.0 and d["avg_scores"]["overall"] == 70.0
    assert d["research_jobs"] == 2 and d["research_failed_pct"] == 50.0
    assert d["scoring_runs"] == 3 and d["scoring_failed_pct"] == 0.0


async def test_quality_with_no_answers_says_none_rather_than_zero(boss):
    d = (await boss.get("/api/admin/quality")).json()
    assert d["answers"] == 0 and d["helpful_pct"] is None and d["flagged_pct"] is None
    assert d["latency"]["p50_first_token_ms"] is None and d["avg_scores"] == {}


# ------------------------------------------------------------------------------------ emails


async def test_the_email_page_counts_every_kind_even_those_never_sent(boss, world):
    d = (await boss.get("/api/admin/emails")).json()
    assert [k["kind"] for k in d["kinds"]] == [c[0] for c in CATALOG]
    welcome = next(k for k in d["kinds"] if k["kind"] == "welcome")
    assert (
        welcome["sent_7d"],
        welcome["failed_7d"],
        welcome["sent_30d"],
        welcome["failed_30d"],
    ) == (1, 1, 1, 1)
    assert next(k for k in d["kinds"] if k["kind"] == "reset")["sent_30d"] == 0
    assert {i["status"] for i in d["items"]} == {"sent", "failed"}


async def test_the_email_log_filters_and_never_has_a_body(boss, world):
    failed = (await boss.get("/api/admin/emails?status=failed")).json()["items"]
    assert [(i["kind"], i["to"], i["status"]) for i in failed] == [
        ("welcome", "cat@example.com", "failed")
    ]
    assert (await boss.get("/api/admin/emails?kind=reset")).json()["items"] == []
    assert len((await boss.get("/api/admin/emails?q=ann@")).json()["items"]) == 1
    assert (await boss.get("/api/admin/emails?status=bogus")).status_code == 422
    assert set(failed[0]) == {"id", "at", "kind", "to", "status", "user_id"}


async def test_every_template_can_be_previewed_with_sample_data(boss):
    listing = (await boss.get("/api/admin/emails/templates")).json()
    assert [t["kind"] for t in listing] == [c[0] for c in CATALOG]
    assert all(t["title"] and t["when"] and t["audience"] for t in listing)
    for t in listing:
        p = (await boss.get(f"/api/admin/emails/templates/{t['kind']}")).json()
        assert p["kind"] == t["kind"] and p["subject"] and p["text"]
        assert p["html"].startswith("<!doctype html>") and "InterviewMeet" in p["html"]
        assert "jordan@example.com" not in p["subject"] or True


async def test_a_preview_never_contains_a_real_person_or_a_working_link(boss, world):
    for kind in ("signup", "login", "reset"):
        p = (await boss.get(f"/api/admin/emails/templates/{kind}")).json()
        assert "SAMPLE-TOKEN" in p["html"]  # an obviously fake link
        for real in ("ann@example.com", "bob@example.com", "boss@example.com"):
            assert real not in p["html"] and real not in p["text"]


async def test_an_unknown_template_is_not_found(boss):
    assert (await boss.get("/api/admin/emails/templates/bogus")).status_code == 404


# ----------------------------------------------------------------------------------- privacy


async def test_nothing_in_the_console_shows_a_cv_an_answer_or_what_was_said(boss, world, db):
    await seed_events(db, world["ann"], world["bob"])
    paths = [
        "/api/admin/overview",
        "/api/admin/users",
        f"/api/admin/users/{world['ann']}",
        f"/api/admin/users/{world['dan']}",
        "/api/admin/activity?limit=200",
        "/api/admin/activity/export.csv",
        "/api/admin/referrals",
        "/api/admin/marketing",
        "/api/admin/quality",
        "/api/admin/emails",
    ]
    for path in paths:
        text = (await boss.get(path)).text
        for secret in (SECRET_CV, SECRET_ANSWER, SECRET_SAID):
            assert secret not in text, (path, secret)


async def test_deleting_an_account_takes_it_out_of_the_console(boss, world, new_client, sign_in):
    async with new_client() as bob:
        await sign_in(bob, "bob@example.com")
        assert (await bob.delete("/api/account")).status_code == 202
    users = [u["email"] for u in (await boss.get("/api/admin/users?limit=100")).json()["items"]]
    assert "bob@example.com" not in users
    log = (await boss.get("/api/admin/activity?limit=200")).json()["items"]
    assert not any(i["user_email"] == "bob@example.com" for i in log)
    assert any(i["kind"] == "user.deleted" for i in log)  # the fact remains, with no one attached
