"""Startup outreach: what may be sent and to whom, reading directories and startup sites, fit,
drafting, the sending rules, and what happens when someone replies, opts out or bounces."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.adapters.fakes import FakeLlmProvider
from app.autoapply import switches
from app.autoapply.adapters import InboundMessage
from app.hunt import directory, draft, engine, fit, policy, research
from app.models import HuntTarget, Startup, StartupContact, Suppression, User
from app.services.fetcher import FetchResult
from tests.autoapply.conftest import FACTS

NOW = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


# ------------------------------------------------------------------------------ policy


def test_regions_and_addresses():
    assert policy.classify_region("United States") == "us"
    assert policy.classify_region("Germany") == "eu"
    assert policy.classify_region("United Kingdom") == "uk"
    assert policy.classify_region("Nigeria") == "other"
    ok = policy.may_write_to
    assert ok("us", "jobs@acme.io", "acme.io") is None
    assert ok("eu", "ada.l@acme.io", "acme.io") is None
    assert ok("us", "x@gmail.com", "acme.io")  # personal mailbox
    assert ok("us", "ceo@other.com", "acme.io")  # not the startup's own domain
    assert ok("us", "privacy@acme.io", "acme.io")  # not for hiring conversations
    assert ok("other", "jobs@acme.io", "acme.io")  # region not chosen
    assert policy.contact_kind("careers@acme.io") == "role"
    assert policy.contact_kind("hello@acme.io") == "general"
    assert policy.contact_kind("ada@acme.io") == "person"


def test_opt_out_and_bounce_detection():
    assert policy.is_opt_out("Please unsubscribe me, thanks")
    assert policy.is_opt_out("No thanks.")
    assert not policy.is_opt_out("Sure, happy to chat Thursday")
    assert policy.is_bounce("Mail Delivery Subsystem <mailer-daemon@x.com>", "hi")
    assert policy.is_bounce("a@b.com", "Undeliverable: your note")


def test_footer_is_honest_and_regional():
    us = policy.footer("us", "Ada", "1 Main St, Austin", "https://acme.io/team")
    assert "1 Main St" in us and "acme.io" in us and "no thanks" in us
    assert "legitimate interest" not in us
    assert "legitimate interest" in policy.footer("eu", "Ada", "x", "https://acme.io")


# ------------------------------------------------------------------------------ directory


async def test_directory_page_becomes_startups():
    reply = {
        "startups": [
            {
                "name": "Acme",
                "website": "acme.io",
                "one_liner": "Payments",
                "country": "United States",
                "batch": "W26",
                "sector": "fintech",
            },
            {
                "name": "Acme again",
                "website": "https://www.acme.io/x",
                "one_liner": "",
                "country": "",
                "batch": "",
                "sector": "",
            },
            {
                "name": "Self",
                "website": "https://dir.test/co/self",
                "one_liner": "",
                "country": "",
                "batch": "",
                "sector": "",
            },
            {
                "name": "NoSite",
                "website": "",
                "one_liner": "",
                "country": "",
                "batch": "",
                "sector": "",
            },
        ]
    }
    got = await directory.extract(
        FakeLlmProvider(json_reply=json.dumps(reply)), "page", "https://dir.test/companies"
    )
    assert [f.name for f in got] == ["Acme"]
    assert got[0].website == "https://acme.io"


async def test_directory_survives_garbage():
    assert (
        await directory.extract(FakeLlmProvider(json_reply="not json"), "p", "https://d.test") == []
    )


# ------------------------------------------------------------------------------ research


class Pages:
    """A fetcher that serves canned pages and never touches the network."""

    def __init__(self, pages):
        self.pages = pages

    async def fetch(self, url):
        hit = self.pages.get(url)
        if hit is None:
            return FetchResult(url, "blocked", "not found")
        text, emails = hit
        return FetchResult(url, "ok", text=text, final_url=url, emails=tuple(emails))


async def add_startup(db, name="Acme", domain="acme.io", region="us", **kw):
    s = Startup(
        name=name, domain=domain, website=f"https://{domain}", directory="YC",
        directory_url="https://dir.test", one_liner=kw.pop("one_liner", "Payments for marketplaces"),
        region=region, status=kw.pop("status", "new"), created_at=NOW, **kw,
    )  # fmt: skip
    db.add(s)
    await db.commit()
    return s


async def test_research_keeps_only_published_on_domain_contacts(maker):
    async with maker() as db:
        s = await add_startup(db)
        pages = Pages(
            {
                "https://acme.io": (
                    "Acme builds payments for marketplaces. " * 5,
                    ["hello@acme.io"],
                ),
                "https://acme.io/team": (
                    "Grace Hopper, CTO, grace@acme.io. We are hiring a Senior Product Manager." * 2,
                    ["grace@acme.io", "x@gmail.com", "privacy@acme.io", "ceo@elsewhere.com"],
                ),
            }
        )
        llm = FakeLlmProvider(
            json_reply=json.dumps(
                {
                    "summary": "Acme builds payments.",
                    "hiring": True,
                    "roles": ["Senior Product Manager"],
                    "people": [
                        {"name": "Grace Hopper", "title": "CTO", "email": "grace@acme.io"},
                        {"name": "Made Up", "title": "CEO", "email": "hello@acme.io"},
                    ],
                }
            )
        )
        out = await research.research(db, pages, llm, s, NOW)
        assert out["contacts"] == 2
        rows = (await db.execute(select(StartupContact))).scalars().all()
        by = {r.email: r for r in rows}
        assert set(by) == {"hello@acme.io", "grace@acme.io"}
        assert by["grace@acme.io"].name == "Grace Hopper" and by["grace@acme.io"].kind == "person"
        assert by["hello@acme.io"].name is None  # the model's invented name is not on the page
        assert by["grace@acme.io"].source_url == "https://acme.io/team"
        assert s.status == "researched" and s.research["hiring"] is True


async def test_unreadable_site_is_marked_dead(maker):
    async with maker() as db:
        s = await add_startup(db)
        out = await research.research(db, Pages({}), FakeLlmProvider(), s, NOW)
        assert out["contacts"] == 0 and s.status == "dead"


# ------------------------------------------------------------------------------ fit + draft


async def test_fit_explains_itself(maker):
    async with maker() as db:
        s = await add_startup(
            db,
            status="researched",
            research={
                "summary": "Payments platform",
                "hiring": True,
                "roles": ["Senior Product Manager"],
            },
        )
        pts, why = fit.score(["Senior Product Manager"], FACTS, s)
        assert pts >= 60 and any("opening" in w for w in why) and any("Payments" in w for w in why)
        none, _ = fit.score(
            ["Welder"],
            {"skills": [], "history": []},
            await add_startup(db, "B", "b.io", one_liner="Dog toys"),
        )
        assert none < fit.MIN_FIT


def test_draft_must_stay_grounded():
    allowed = json.dumps(FACTS)
    assert draft.grounded("I grew revenue 30% at Northwind.", allowed)
    assert not draft.grounded("I grew revenue 300% at Northwind.", allowed)
    assert not draft.grounded("word " * 200, allowed)


# ------------------------------------------------------------------------------ the whole run


async def setup(ada, maker, mailbox, *, roles=("Senior Product Manager",), **over):
    await ada.put("/api/autoapply/facts", json={"data": FACTS, "verified": True})
    await ada.post("/api/autoapply/mailbox/connect")
    body = {
        "enabled": True, "regions": ["us", "eu"], "roles": list(roles), "pitch": "I turn messy payments into clear roadmaps.",
        "daily_cap": 8, "auto_send": False, "sender_name": "Ada Okoye", "postal_address": "12 Marina, Lagos",
    }  # fmt: skip
    body.update(over)
    r = await ada.put("/api/hunt/settings", json=body)
    assert r.status_code == 200, r.text
    async with maker() as db:
        uid = (
            await db.execute(select(User.id).where(User.email == "ada@example.com"))
        ).scalar_one()
    return uid


async def seed(maker, n=1, **kw):
    async with maker() as db:
        out = []
        for i in range(n):
            s = await add_startup(
                db, f"Acme{i}", f"acme{i}.io", status="researched",
                research={"summary": "Payments platform", "hiring": True, "roles": ["Senior Product Manager"]},
                **kw,
            )  # fmt: skip
            db.add(
                StartupContact(
                    startup_id=s.id,
                    email=f"jobs@acme{i}.io",
                    kind="role",
                    source_url=f"https://acme{i}.io/careers",
                    found_at=NOW,
                )
            )
            out.append(s.id)
        await db.commit()
        return out


@pytest.fixture(autouse=True)
def hunt_on(settings):
    settings.startup_outreach_enabled = True


@pytest.fixture
def write_llm():
    return FakeLlmProvider(
        json_reply=json.dumps(
            {
                "subject": "Senior PM, payments",
                "body": "Hi, I led the payments roadmap at Northwind and grew revenue 30%. Open to a chat?",
            }
        )
    )


async def test_notes_wait_for_approval_then_send_once(
    ada, maker, mailbox, settings, write_llm, clock
):
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 2)
    async with maker() as db:
        assert await engine.plan(db, uid, NOW, write_llm) == 2
    listed = (await ada.get("/api/hunt/targets")).json()
    assert {t["status"] for t in listed} == {"drafted"}
    assert "reply with 'no thanks'" in listed[0]["body"] and "12 Marina" in listed[0]["body"]
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None  # nothing approved
    assert (await ada.post(f"/api/hunt/targets/{listed[0]['id']}/approve")).status_code == 200
    assert (await ada.post(f"/api/hunt/targets/{listed[1]['id']}/approve")).status_code == 200
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "sent"
    assert mailbox.sent[0]["from"] == "ada@example.com" and mailbox.sent[0]["to"].startswith(
        "jobs@"
    )
    assert (
        await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(seconds=30)) is None
    )
    assert (
        await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(minutes=3)) == "sent"
    )
    assert len(mailbox.sent) == 2 and len({m["to"] for m in mailbox.sent}) == 2


async def test_no_double_planning_and_region_filter(ada, maker, mailbox, write_llm):
    uid = await setup(ada, maker, mailbox, regions=["uk"])
    await seed(maker, 1)  # a US startup
    async with maker() as db:
        assert await engine.plan(db, uid, NOW, write_llm) == 0
    await ada.put(
        "/api/hunt/settings",
        json={
            "enabled": True,
            "regions": ["us"],
            "roles": ["Senior Product Manager"],
            "sender_name": "Ada",
            "postal_address": "x",
        },
    )
    async with maker() as db:
        assert await engine.plan(db, uid, NOW, write_llm) == 1
        assert await engine.plan(db, uid, NOW, write_llm) == 0


async def test_cannot_turn_on_until_ready(ada):
    r = await ada.put(
        "/api/hunt/settings", json={"enabled": True, "regions": ["us"], "roles": ["PM"]}
    )
    assert r.status_code == 409 and "postal address" in r.json()["error"]["message"].lower()
    r = await ada.put(
        "/api/hunt/settings", json={"enabled": False, "regions": ["mars"], "roles": []}
    )
    assert r.status_code == 422


async def test_rules_block_sending(ada, maker, mailbox, settings, write_llm):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    sat = datetime(2026, 11, 7, 9, 0, tzinfo=UTC)
    night = datetime(2026, 11, 2, 23, 0, tzinfo=UTC)
    assert await engine.send_next(maker, uid, mailbox, settings, sat) is None  # weekend
    assert await engine.send_next(maker, uid, mailbox, settings, night) is None  # outside hours
    async with maker() as db:
        await switches.set_switch(db, "channel:hunt", on=True, reason="test", by=None)
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None  # kill switch
    async with maker() as db:
        await switches.set_switch(db, "channel:hunt", on=False, reason="test", by=None)
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "sent"
    assert len(mailbox.sent) == 1


async def test_real_mailbox_stays_off_until_dispatch_is_on(
    ada, maker, mailbox, settings, write_llm
):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    mailbox.real = True
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None  # dispatch off
    settings.startup_outreach_dispatch = True
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None  # not allowlisted
    settings.autoapply_allowed_recipients = "jobs@acme0.io"
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "sent"


async def test_daily_cap(ada, maker, mailbox, settings, write_llm):
    uid = await setup(ada, maker, mailbox, auto_send=True, daily_cap=2)
    await seed(maker, 4)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    sent = [
        await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(minutes=3 * i))
        for i in range(4)
    ]
    assert sent == ["sent", "sent", None, None]


async def test_suppressed_address_is_never_written(ada, maker, mailbox, settings, write_llm):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
        await engine.suppress(db, user_id=None, email="jobs@acme0.io", reason="bounce", now=NOW)
        await db.commit()
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None
    async with maker() as db:
        t = (await db.execute(select(HuntTarget))).scalar_one()
        assert t.status == "skipped" and mailbox.sent == []


async def test_reply_optout_and_bounce_are_respected(ada, maker, mailbox, settings, write_llm):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 3)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    for i in range(3):
        assert (
            await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(minutes=3 * i))
            == "sent"
        )
    async with maker() as db:
        rows = {r.id: r for r in (await db.execute(select(HuntTarget))).scalars().all()}
        contacts = {
            c.id: c.email for c in (await db.execute(select(StartupContact))).scalars().all()
        }
        by = {contacts[t.contact_id]: t for t in rows.values()}
        inbound = [
            InboundMessage(
                "m1",
                "t",
                "<1>",
                "Jo <jobs@acme0.io>",
                "Re: PM",
                "Yes, let's talk Thursday",
                NOW,
                by["jobs@acme0.io"].message_id,
            ),
            InboundMessage(
                "m2",
                "t",
                "<2>",
                "jobs@acme1.io",
                "Re: PM",
                "No thanks, please don't contact us again",
                NOW,
                None,
            ),
            InboundMessage(
                "m3",
                "t",
                "<3>",
                "Mail Delivery <mailer-daemon@gmail.com>",
                "Undeliverable: PM",
                "jobs@acme2.io could not be delivered",
                NOW,
                None,
            ),
        ]
        got = [await engine.on_inbound(db, uid, m, NOW) for m in inbound]
        await db.commit()
        assert got == ["replied", "declined", "bounced"]
        assert by["jobs@acme0.io"].status == "replied"
        assert by["jobs@acme1.io"].status == "declined"
        assert by["jobs@acme2.io"].status == "failed"
        assert await engine.suppressed(db, uid, "x@acme1.io") == "declined"  # the whole domain
        assert await engine.suppressed(db, uid, "jobs@acme2.io") == "bounce"
        other = (
            await db.execute(select(Suppression).where(Suppression.reason == "bounce"))
        ).scalar_one()
        assert other.user_id is None  # a dead address is dead for everyone


async def test_one_followup_after_five_quiet_days(ada, maker, mailbox, settings, write_llm):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    await engine.send_next(maker, uid, mailbox, settings, NOW)
    async with maker() as db:
        assert await engine.plan_followups(db, uid, NOW + timedelta(days=4)) == 0
        assert await engine.plan_followups(db, uid, NOW + timedelta(days=5)) == 1
        assert await engine.plan_followups(db, uid, NOW + timedelta(days=7)) == 0  # never a second
    later = NOW + timedelta(days=7)  # a Monday
    assert await engine.send_next(maker, uid, mailbox, settings, later) == "sent"
    assert mailbox.sent[1]["subject"].startswith("Re: ")


async def test_unknown_send_is_settled_not_repeated(ada, maker, mailbox, settings, write_llm):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    mailbox.mode = "timeout_after"  # accepted, but we never heard back
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "ambiguous"
    mailbox.mode = "ok"
    assert await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(minutes=3)) is None
    assert await engine.reconcile(maker, mailbox, settings, NOW + timedelta(minutes=30)) == 1
    async with maker() as db:
        t = (await db.execute(select(HuntTarget))).scalar_one()
        assert t.status in ("sent", "approved")
    assert len(mailbox.sent) == 1  # never sent twice


async def test_people_only_see_their_own_notes(ada, maker, mailbox, write_llm, new_client, sign_in):
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    tid = (await ada.get("/api/hunt/targets")).json()[0]["id"]
    async with new_client() as other:
        await sign_in(other, "mallory@example.com")
        assert (await other.get("/api/hunt/targets")).json() == []
        assert (await other.post(f"/api/hunt/targets/{tid}/approve")).status_code == 404


async def test_flag_off_means_404(ada, settings):
    settings.startup_outreach_enabled = False
    assert (await ada.get("/api/hunt/settings")).status_code == 404
