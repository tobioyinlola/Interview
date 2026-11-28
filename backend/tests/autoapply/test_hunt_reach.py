"""Reaching more startups without hurting the sender's mailbox: how far down the ranking to go, a
daily limit that ramps up, sending that stops by itself, mail checks, and reading replies."""

import json
from datetime import timedelta

import dns.resolver
import pytest
from sqlalchemy import select, update

from app.adapters.fakes import FakeLlmProvider
from app.autoapply.adapters import InboundMessage
from app.hunt import engine, health
from app.models import HuntSettings, HuntTarget, Startup, StartupContact
from tests.autoapply.test_hunt import NOW, seed, setup, write_llm  # noqa: F401


@pytest.fixture(autouse=True)
def _on(settings):
    settings.startup_outreach_enabled = True


# ------------------------------------------------------------------------------ pure rules


def test_the_daily_limit_starts_low_and_rises_over_three_weeks():
    first = NOW - timedelta(days=0)
    got = [health.ramp_cap(first, NOW + timedelta(days=d)) for d in (0, 6, 7, 13, 14, 20, 21, 90)]
    assert got == [10, 10, 15, 15, 20, 20, 25, 25]
    assert health.ramp_cap(None, NOW) == 10


def test_your_own_limit_and_a_rising_bounce_rate_hold_the_ramp_down():
    st = HuntSettings(daily_cap=8)
    assert health.daily_cap(st, NOW - timedelta(days=30), NOW, 40, 0, 25) == 8  # your limit wins
    st = HuntSettings(daily_cap=25)
    assert health.daily_cap(st, NOW - timedelta(days=30), NOW, 40, 0, 25) == 25
    assert health.daily_cap(st, NOW - timedelta(days=30), NOW, 100, 1, 25) == 25  # 1%: fine
    assert health.daily_cap(st, NOW - timedelta(days=30), NOW, 100, 2, 25) == 10  # 2%: held back


def test_sending_stops_for_bounces_or_requests_to_stop_but_only_with_enough_sent():
    assert health.pause_reason(9, 9, 0) is None  # too few to judge
    assert health.pause_reason(40, 1, 0) is None
    assert "bounced" in (health.pause_reason(40, 2, 0) or "")
    assert "asking you to stop" in (health.pause_reason(40, 0, 5) or "")
    assert health.pause_reason(40, 0, 4) is None  # exactly 10%


def test_a_reply_is_read_from_its_words():
    assert health.reply_kind("Thanks! Happy to chat, are you free Thursday?") == "positive"
    assert health.reply_kind("Unfortunately we are not hiring at this time") == "negative"
    assert health.reply_kind("Thanks for reaching out") == "neutral"
    assert health.reply_kind("Not hiring now, but let's chat anyway") == "positive"


async def test_the_mail_check_says_no_only_for_a_domain_that_does_not_exist(monkeypatch):
    class Res:
        lifetime = 0

        def __init__(self, answers):
            self.answers = answers

        async def resolve(self, name, kind):
            a = self.answers[kind]
            if isinstance(a, Exception):
                raise a
            return a

    def use(answers):
        monkeypatch.setattr(health.dns.asyncresolver, "Resolver", lambda: Res(answers))

    use({"MX": ["mx"], "A": dns.resolver.NoAnswer()})
    assert await health.mail_domain_works("a.io") is True
    use({"MX": dns.resolver.NoAnswer(), "A": ["1.2.3.4"]})
    assert await health.mail_domain_works("a.io") is True  # no MX: mail goes to the address
    use({"MX": dns.resolver.NXDOMAIN(), "A": None})
    assert await health.mail_domain_works("nope.example") is False
    use({"MX": dns.resolver.NoAnswer(), "A": dns.resolver.NoAnswer()})
    assert await health.mail_domain_works("a.io") is False
    use({"MX": TimeoutError(), "A": None})
    assert await health.mail_domain_works("a.io") is None  # could not tell: not held against it


# --------------------------------------------------------------------------- reach and checks


async def lowfit(maker, name="Quiet"):
    """A researched startup with a contact and nothing in common with the candidate."""
    async with maker() as db:
        s = Startup(
            name=name, domain=f"{name.lower()}.io", website=f"https://{name.lower()}.io",
            directory="d", directory_url="u", status="researched", region="us", one_liner="Bakery",
            research={"summary": "We bake bread", "hiring": False, "roles": []},
        )  # fmt: skip
        db.add(s)
        await db.flush()
        db.add(StartupContact(startup_id=s.id, email=f"hello@{name.lower()}.io", kind="general",
                              source_url=f"https://{name.lower()}.io", found_at=NOW))  # fmt: skip
        await db.commit()


async def test_reach_decides_how_far_down_the_ranking_it_goes(ada, maker, mailbox, write_llm):  # noqa: F811
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 1)  # a strong match: lists the role
    await lowfit(maker)
    for reach, expect in (("best", 1), ("most", 1), ("everyone", 2)):
        async with maker() as db:
            await db.execute(delete_targets(uid))
            await db.commit()
        await ada.put(
            "/api/hunt/settings",
            json={**(await ada.get("/api/hunt/settings")).json(), "reach": reach},
        )
        async with maker() as db:
            assert await engine.plan(db, uid, NOW, write_llm) == expect, reach
    async with maker() as db:
        rows = (
            (await db.execute(select(HuntTarget).order_by(HuntTarget.fit.desc()))).scalars().all()
        )
    assert rows[0].fit > rows[1].fit  # best fits are first in line
    assert any("No matching opening yet" in r for r in rows[1].fit_reasons)


def delete_targets(uid):
    from sqlalchemy import delete

    return delete(HuntTarget).where(HuntTarget.user_id == uid)


async def test_an_address_whose_domain_cannot_receive_mail_is_never_written_to(
    ada,
    maker,
    mailbox,
    write_llm,  # noqa: F811
    monkeypatch,
):
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 2)

    async def works(domain):
        return domain != "acme0.io"

    monkeypatch.setattr(engine, "RESOLVER", works)
    async with maker() as db:
        assert await engine.plan(db, uid, NOW, write_llm) == 1
        c = (
            await db.execute(select(StartupContact).where(StartupContact.email == "jobs@acme0.io"))
        ).scalar_one()
        assert c.mx_ok is False and c.mx_checked_at is not None
    # the answer is kept: a second pass does not ask again within 30 days
    calls = []

    async def counting(domain):
        calls.append(domain)
        return True

    monkeypatch.setattr(engine, "RESOLVER", counting)
    async with maker() as db:
        await engine.plan(db, uid, NOW + timedelta(days=1), write_llm)
    assert "acme0.io" not in calls


async def test_a_named_person_is_chosen_before_a_general_address_when_both_work(
    ada,
    maker,
    mailbox,
    write_llm,  # noqa: F811
):
    uid = await setup(ada, maker, mailbox)
    (sid,) = await seed(maker, 1)
    async with maker() as db:
        db.add(StartupContact(startup_id=sid, email="sam@acme0.io", name="Sam Rivera", kind="person",
                              source_url="https://acme0.io/team", found_at=NOW))  # fmt: skip
        await db.commit()
        await engine.plan(db, uid, NOW, write_llm)
        c = await db.get(
            StartupContact, (await db.execute(select(HuntTarget.contact_id))).scalar_one()
        )
    assert c is not None and c.email == "sam@acme0.io"


# --------------------------------------------------------------- stopping, the ramp, replies


async def send_many(ada, maker, mailbox, settings, llm, n):
    uid = await setup(ada, maker, mailbox, auto_send=True, daily_cap=25)
    await seed(maker, n)
    async with maker() as db:
        await engine.plan(db, uid, NOW, llm, limit=n)
    return uid


async def test_sending_stops_by_itself_when_too_many_bounce_and_resumes_only_when_you_say(
    ada,
    maker,
    mailbox,
    settings,
    write_llm,  # noqa: F811
):
    uid = await setup(ada, maker, mailbox, auto_send=True, daily_cap=25)
    await seed(maker, 3)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
        # twelve notes already sent, three of which bounced (25%)
        st = (await db.execute(select(HuntSettings))).scalar_one()
        sid = (await db.execute(select(Startup.id))).scalars().first()
        for i in range(12):
            c = StartupContact(startup_id=sid, email=f"p{i}@acme0.io", kind="person", name="P",
                               source_url="https://acme0.io", found_at=NOW)  # fmt: skip
            db.add(c)
            await db.flush()
            t = HuntTarget(user_id=uid, startup_id=sid, contact_id=c.id,
                           step=1, fit=40, status="sent", sent_at=NOW - timedelta(days=2),
                           claimed_at=NOW - timedelta(days=2), subject="s", body="b",
                           reply_kind="bounce" if i < 3 else None)  # fmt: skip
            db.add(t)
        await db.commit()
        why = await engine.evaluate_pause(db, uid, NOW)
        assert why and "bounced" in why and st.auto_paused_at is not None
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None  # nothing goes
    blockers = (await ada.get("/api/hunt/delivery")).json()["blockers"]
    assert any(b["code"] == "auto_paused" for b in blockers)
    f = (await ada.get("/api/hunt/funnel")).json()
    assert f["paused_reason"] and f["bounced"] == 3
    assert (await ada.post("/api/hunt/resume")).json() == {"resumed": True}
    async with maker() as db:  # what came before no longer counts: it does not stop again at once
        assert await engine.evaluate_pause(db, uid, NOW + timedelta(minutes=1)) is None
    assert (await ada.post("/api/hunt/resume")).json() == {"resumed": False}


async def test_the_daily_limit_ramps_with_sending_history(
    ada,
    maker,
    mailbox,
    settings,
    write_llm,  # noqa: F811
):
    uid = await setup(ada, maker, mailbox, auto_send=True, daily_cap=25)
    async with maker() as db:
        st = (await db.execute(select(HuntSettings))).scalar_one()
        assert await engine.effective_cap(db, uid, st, NOW) == 10  # a new sender
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW - timedelta(days=30), write_llm)
        t = (await db.execute(select(HuntTarget))).scalar_one()
        t.status, t.sent_at, t.claimed_at = (
            "sent",
            NOW - timedelta(days=22),
            NOW - timedelta(days=22),
        )
        await db.commit()
        st = (await db.execute(select(HuntSettings))).scalar_one()
        assert await engine.effective_cap(db, uid, st, NOW) == 25
    f = (await ada.get("/api/hunt/funnel")).json()
    assert f["daily_limit"] == 25


async def test_replies_are_read_and_counted_in_the_results(
    ada,
    maker,
    mailbox,
    settings,
    write_llm,  # noqa: F811
):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 3)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    for i in range(3):
        assert (
            await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(minutes=5 * i))
            == "sent"
        )
    async with maker() as db:
        for sender, subject, snippet in (
            ("jobs@acme0.io", "Re: hi", "We would love to chat, are you free Thursday?"),
            ("jobs@acme1.io", "Re: hi", "Unfortunately we are not hiring at this time."),
            ("jobs@acme2.io", "Re: hi", "No thanks, please unsubscribe me."),
        ):
            got = await engine.on_inbound(
                db, uid, InboundMessage(provider_id="p", thread_id=None, message_id="m", from_addr=sender, subject=subject, snippet=snippet, received_at=NOW), NOW)  # fmt: skip
            assert got in ("replied", "declined")
        await db.commit()
    f = (await ada.get("/api/hunt/funnel")).json()
    assert (f["sent"], f["replied"], f["positive"], f["negative"], f["asked_to_stop"]) == (
        3,
        2,
        1,
        1,
        1,
    )
    assert f["by_version"][0] == {"version": "written", "sent": 3, "replied": 2, "positive": 1}
    listed = (await ada.get("/api/hunt/targets")).json()
    assert {t["reply_kind"] for t in listed} == {"positive", "negative", "optout"}
    assert all(t["replied_at"] for t in listed)


async def test_the_funnel_counts_the_whole_path(ada, maker, mailbox, write_llm):  # noqa: F811
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 2)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    f = (await ada.get("/api/hunt/funnel")).json()
    assert f["with_contact"] == 2 and f["written"] == 2 and f["waiting_review"] == 2
    assert (
        f["sent"] == 0 and f["daily_limit"] == 8 and f["paused_reason"] is None
    )  # your 8 < the ramp's 10
    assert [b["band"] for b in f["by_fit"]] == ["best", "good", "low"]
    await ada.get("/api/hunt/funnel")  # a read changes nothing


async def test_reach_is_saved_with_the_settings(ada, maker, mailbox):
    await setup(ada, maker, mailbox)
    cur = (await ada.get("/api/hunt/settings")).json()
    assert cur["reach"] == "most"
    r = await ada.put("/api/hunt/settings", json={**cur, "reach": "everyone"})
    assert r.json()["reach"] == "everyone"
    bad = await ada.put("/api/hunt/settings", json={**cur, "reach": "all"})
    assert bad.status_code == 422
    _ = json, update, FakeLlmProvider
