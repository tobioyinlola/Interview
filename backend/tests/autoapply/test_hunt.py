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
from app.models import HuntTarget, SearchProfile, Startup, StartupContact, Suppression, User
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
        text, emails, *links = hit
        return FetchResult(
            url, "ok", text=text, final_url=url, emails=tuple(emails), links=tuple(*links)
        )


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


# ------------------------------------------------------------------------------ careers + sync


LinkedPages = Pages


async def test_careers_page_is_found_through_a_job_board_link(maker):
    async with maker() as db:
        s = await add_startup(db)
        pages = LinkedPages(
            {
                "https://acme.io": (
                    "Acme builds payments for marketplaces. " * 5,
                    [],
                    [
                        ("We're hiring", "https://jobs.ashbyhq.com/acme"),
                        ("Blog", "https://acme.io/blog"),
                    ],
                ),
                "https://jobs.ashbyhq.com/acme": (
                    "Open roles at Acme. Senior Product Manager. Backend Engineer. " * 3,
                    [],
                    [
                        ("Senior Product Manager", "https://jobs.ashbyhq.com/acme/pm-1"),
                        ("Backend Engineer", "https://elsewhere.example/x"),
                    ],
                ),
            }
        )
        llm = FakeLlmProvider(
            json_reply=json.dumps(
                {
                    "summary": "Acme builds payments.",
                    "hiring": True,
                    "roles": ["Senior Product Manager", "Backend Engineer"],
                    "people": [],
                }
            )
        )
        await research.research(db, pages, llm, s, NOW)
        r = s.research
        assert r["careers_url"] == "https://jobs.ashbyhq.com/acme"
        urls = {o["title"]: o["url"] for o in r["openings"]}
        assert urls["Senior Product Manager"] == "https://jobs.ashbyhq.com/acme/pm-1"
        # a link to an unrelated site is never offered as the opening: fall back to the careers page
        assert urls["Backend Engineer"] == "https://jobs.ashbyhq.com/acme"
        assert [o["title"] for o in fit.openings_for(["Senior Product Manager"], s)] == [
            "Senior Product Manager"
        ]


async def test_notes_carry_the_matching_opening_and_stay_short(
    ada, maker, mailbox, settings, write_llm
):
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 1)
    async with maker() as db:
        s = (await db.execute(select(Startup))).scalar_one()
        s.research = {
            **s.research,
            "careers_url": "https://acme0.io/careers",
            "openings": [{"title": "Senior Product Manager", "url": "https://acme0.io/careers/pm"}],
        }
        await db.commit()
    bad = FakeLlmProvider(
        json_reply="nope"
    )  # the model fails: the plain template still mentions it
    async with maker() as db:
        await engine.plan(db, uid, NOW, bad)
    t = (await ada.get("/api/hunt/targets")).json()[0]
    assert t["openings"] == [
        {"title": "Senior Product Manager", "url": "https://acme0.io/careers/pm"}
    ]
    assert t["careers_url"] == "https://acme0.io/careers"
    assert "Senior Product Manager opening" in t["body"]
    assert len(t["body"].split("--")[0].split()) < 100


async def test_one_pause_covers_both(ada, maker, mailbox, settings, write_llm):
    from tests.autoapply.conftest import PROFILE

    uid = await setup(ada, maker, mailbox, auto_send=True)
    await ada.put("/api/autoapply/profile", json=PROFILE)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
        prof = (
            await db.execute(select(SearchProfile).where(SearchProfile.user_id == uid))
        ).scalar_one()
        prof.paused = True
        await db.commit()
    assert (await ada.get("/api/hunt/settings")).json()["paused"] is True
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None
    async with maker() as db:
        prof = (
            await db.execute(select(SearchProfile).where(SearchProfile.user_id == uid))
        ).scalar_one()
        prof.paused = False
        await db.commit()
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "sent"


async def test_settings_start_from_the_auto_apply_search(ada):
    from tests.autoapply.conftest import PROFILE

    await ada.put("/api/autoapply/profile", json=PROFILE)
    await ada.put("/api/autoapply/facts", json={"data": FACTS, "verified": True})
    s = (await ada.get("/api/hunt/settings")).json()
    assert s["roles"] == ["Senior Product Manager"] and s["sender_name"] == "Ada Okoye"
    assert s["prefilled"] is True and s["enabled"] is False


async def test_auto_apply_overview_shows_startup_counts(ada, maker, mailbox, write_llm):
    from tests.autoapply.conftest import start

    await start(ada)
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 2)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    d = (await ada.get("/api/autoapply/dashboard")).json()
    assert d["startups"]["waiting"] == 2 and d["startups"]["sent"] == 0


async def test_every_note_goes_with_the_cv_attached_and_reads_like_a_proper_email(
    ada, maker, mailbox, settings, clock
):
    """A fixed template (no model): greeting, who I am, why them, the ask, CV line, sign-off."""
    uid = await setup(ada, maker, mailbox)
    await ada.put("/api/notes", json={"role": "PM", "content": "Ada Okoye\nSenior PM at Northwind"})
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, FakeLlmProvider(json_reply="not json"))
    [t] = (await ada.get("/api/hunt/targets")).json()
    body = t["body"]
    assert body.startswith(("Hello,", "Hi "))
    assert "I'm Ada Okoye" in body and "Acme0" in body
    assert "short call" in body
    assert body.index("My CV is attached.") < body.index("Thank you,\nAda Okoye")
    assert (await ada.post(f"/api/hunt/targets/{t['id']}/approve")).status_code == 200
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "sent"
    [att] = mailbox.sent[0]["attachments"]
    assert att.filename == "Ada Okoye - CV.pdf" and att.content.startswith(b"%PDF")


def test_the_cv_file_name_is_clean():
    assert engine.cv_filename("Ada Okoye") == "Ada Okoye - CV.pdf"
    assert engine.cv_filename("Ada/../Okoye<>") == "Ada..Okoye - CV.pdf"
    assert engine.cv_filename("") == "CV.pdf"


async def test_the_overview_lists_sent_pitches_with_who_they_went_to(
    ada, maker, mailbox, settings, write_llm
):
    from tests.autoapply.conftest import start

    await start(ada)
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
    assert (await ada.get("/api/autoapply/dashboard")).json()["startup_recent"] == []  # not sent
    listed = (await ada.get("/api/hunt/targets")).json()
    assert (await ada.post(f"/api/hunt/targets/{listed[0]['id']}/approve")).status_code == 200
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "sent"
    d = (await ada.get("/api/autoapply/dashboard")).json()
    assert d["startups"]["sent"] == 1
    [one] = d["startup_recent"]
    assert one["status"] == "sent" and one["company"] and one["subject"]
    assert one["sent_at"]


# ------------------------------------------------------------------------------ directories


class OnePage:
    """A fetcher that returns one directory page, whatever the address."""

    def __init__(self, text="Directory of startups listed here. " * 5):
        self.text, self.fetched = text, []

    async def fetch(self, url):
        self.fetched.append(url)
        return FetchResult(url, "ok", text=self.text, final_url=url)


def listing(*rows):
    return FakeLlmProvider(
        json_reply=json.dumps(
            {
                "startups": [
                    {
                        "name": n,
                        "website": w,
                        "one_liner": "x",
                        "country": c,
                        "batch": "",
                        "sector": "",
                    }
                    for n, w, c in rows
                ]
            }
        )
    )


async def test_there_are_at_least_ten_default_directories_and_they_are_added_once(maker):
    from app.models import Directory

    assert len(directory.DEFAULTS) >= 10
    async with maker() as db:
        assert await directory.ensure_defaults(db, NOW) == len(directory.DEFAULTS)
        assert await directory.ensure_defaults(db, NOW) == 0  # never twice
        d = (await db.execute(select(Directory).where(Directory.name == "Seedcamp"))).scalar_one()
        d.enabled = False  # an operator's choice survives
        await db.commit()
        await directory.ensure_defaults(db, NOW)
        await db.refresh(d)
        assert d.enabled is False and d.builtin is True


async def test_a_regional_hint_fills_in_a_missing_country_but_a_global_one_does_not(maker):
    async with maker() as db:
        found = [
            directory.Found("Acme", "https://acme.io"),
            directory.Found("Beta", "https://beta.io", country="Germany"),
        ]
        await directory.save(db, "Seedcamp", "https://x", found, NOW, hint="uk")
        await directory.save(
            db, "Antler", "https://y", [directory.Found("Gamma", "https://gamma.io")], NOW
        )
        regions = {s.name: s.region for s in (await db.execute(select(Startup))).scalars().all()}
    assert regions == {"Acme": "uk", "Beta": "eu", "Gamma": "other"}  # never guessed into a region


async def test_directories_are_read_a_couple_at_a_time_and_then_weekly(maker):
    from app.models import Directory

    llm = listing(("Acme", "https://acme.io", "France"))
    pages = OnePage()
    async with maker() as db:
        assert await directory.refresh_due(db, pages, llm, NOW) == 2  # a couple per pass
        assert await directory.refresh_due(db, pages, llm, NOW) == 2
        ran = (
            (await db.execute(select(Directory).where(Directory.last_run_at.is_not(None))))
            .scalars()
            .all()
        )
        assert len(ran) == 4 and {d.last_found for d in ran} == {1}
        total = len(directory.DEFAULTS)
        for _ in range(total):
            await directory.refresh_due(db, pages, llm, NOW)
        assert await directory.refresh_due(db, pages, llm, NOW) == 0  # all read: nothing due
        assert (
            await directory.refresh_due(db, pages, llm, NOW + timedelta(days=8)) == 2
        )  # a week on
        assert (
            await db.execute(select(Startup).where(Startup.name == "Acme"))
        ).scalar_one().region == "eu"


def test_the_directory_lists_are_sound():
    names = [d[0] for d in directory.DEFAULTS] + [c[0] for c in directory.CANDIDATES]
    assert len(names) == len(set(names))  # no name twice, so nothing is added twice
    assert len(directory.DEFAULTS) >= 29  # the first eleven plus the ones that were checked
    for _name, url, hint in directory.DEFAULTS + directory.CANDIDATES:
        assert url.startswith("https://") and hint in ("", "us", "eu", "uk")


async def test_the_daily_scout_tries_a_couple_of_new_places_and_keeps_only_those_that_work(maker):
    from app.models import Directory

    good = listing(
        ("A1", "https://a1.io", "Germany"),
        ("A2", "https://a2.io", "France"),
        ("A3", "https://a3.io", "Spain"),
    )
    async with maker() as db:
        out = await directory.scout(db, OnePage(), good, NOW)
        assert [o["name"] for o in out] == [c[0] for c in directory.CANDIDATES[:2]]
        assert all(o["enabled"] and o["found"] == 3 for o in out)
        assert await directory.scout(db, OnePage(), good, NOW + timedelta(hours=3)) == []  # today
        thin = listing(("B1", "https://b1.io", "Germany"))
        out = await directory.scout(db, OnePage(), thin, NOW + timedelta(days=1))
        assert [o["name"] for o in out] == [c[0] for c in directory.CANDIDATES[2:4]]
        assert not any(o["enabled"] for o in out)  # one startup is not enough to switch it on
        off = (
            await db.execute(select(Directory).where(Directory.name == out[0]["name"]))
        ).scalar_one()
        assert off.enabled is False and off.builtin is False and "stays off" in off.last_problem
        again = await directory.scout(db, OnePage(), good, NOW + timedelta(days=2))
        assert [o["name"] for o in again] == [c[0] for c in directory.CANDIDATES[4:6]]  # no retries


async def test_an_unreadable_candidate_stays_off_with_the_reason(maker):
    from app.models import Directory
    from app.services.fetcher import FetchResult

    class Down:
        async def fetch(self, url):
            return FetchResult(url, "blocked", reason="The site asks robots not to read it.")

    async with maker() as db:
        [one, _two] = await directory.scout(db, Down(), listing(), NOW)
        assert not one["enabled"]
        d = (await db.execute(select(Directory).where(Directory.name == one["name"]))).scalar_one()
        assert d.enabled is False and "robots" in d.last_problem


def test_a_long_page_is_cut_into_pieces_at_spaces_and_only_so_many():
    text = "word " * 20_000  # 100,000 characters
    pieces = directory._chunks(text)
    assert 1 < len(pieces) <= directory.MAX_CHUNKS
    assert all(len(p) <= directory.CHUNK_CHARS for p in pieces)
    assert all(not p.startswith(" ") and "wor " not in p[-4:] for p in pieces)  # no cut words
    assert directory._chunks("short page") == ["short page"] and directory._chunks("  ") == []


async def test_a_long_directory_page_is_read_in_pieces_and_what_each_piece_finds_is_kept():
    class PerPiece:
        """Each call gets the next piece and names a different company; one call fails."""

        def __init__(self):
            self.calls = 0

        async def generate_json(self, *, system, user, schema):
            from app.adapters.interfaces import ProviderError

            self.calls += 1
            if self.calls == 2:
                raise ProviderError("busy")
            return json.dumps(
                {
                    "startups": [
                        {
                            "name": f"Co{self.calls}",
                            "website": f"https://co{self.calls}.io",
                            "one_liner": "x",
                            "country": "France",
                            "batch": "",
                            "sector": "",
                        }
                    ]
                }
            )

    llm = PerPiece()
    found = await directory.extract(llm, "word " * 20_000, "https://dir.test/portfolio")
    assert llm.calls == directory.MAX_CHUNKS
    assert [f.name for f in found] == ["Co1", "Co3", "Co4"]  # the failed piece cost only itself


async def test_the_same_company_named_in_two_pieces_counts_once():
    rows = [(f"N{i}", f"https://n{i}.io", "France") for i in range(60)]
    found = await directory.extract(listing(*rows), "word " * 20_000, "https://dir.test/p")
    assert len(found) == 60 and len({f.website for f in found}) == 60


async def test_one_directory_gives_at_most_two_hundred_companies():
    class Many:
        calls = 0

        async def generate_json(self, *, system, user, schema):
            Many.calls += 1
            rows = [
                {
                    "name": f"P{Many.calls}N{i}",
                    "website": f"https://p{Many.calls}n{i}.io",
                    "one_liner": "",
                    "country": "",
                    "batch": "",
                    "sector": "",
                }
                for i in range(80)
            ]
            return json.dumps({"startups": rows})

    found = await directory.extract(Many(), "word " * 20_000, "https://dir.test/p")
    assert len(found) == directory.MAX_TOTAL


async def test_the_model_is_given_the_pages_outside_links_so_it_can_name_each_website():
    seen = {}

    class Spy:
        async def generate_json(self, *, system, user, schema):
            seen["user"], seen["system"] = user, system
            return json.dumps({"startups": []})

    links = (
        ("Visit site", "https://dronamics.com/about"),
        ("15Five", "https://www.15five.com/"),
        ("Visit site", "https://dronamics.com/other"),  # same site again: once
        ("LinkedIn", "https://www.linkedin.com/company/x"),  # never a company
        ("Our team", "https://dir.test/team"),  # the directory's own page
        ("Sub", "https://news.dir.test/x"),  # and its subdomain
    )
    await directory.extract(Spy(), "Dronamics 15Five " * 3, "https://www.dir.test/p", links)
    assert "LINKS ON THE PAGE:" in seen["user"]
    assert "Visit site -> https://dronamics.com" in seen["user"]
    assert "15Five -> https://15five.com" in seen["user"]
    assert seen["user"].count("dronamics.com") == 1
    assert "linkedin" not in seen["user"] and "dir.test" not in seen["user"].split("LINKS")[1]
    assert "links on the page" in seen["system"]
    out = await directory.extract(
        listing(("Dronamics", "https://dronamics.com", "Bulgaria")), "t " * 50, "https://dir.test/p"
    )
    assert out[0].website == "https://dronamics.com"


async def test_a_page_that_is_all_links_is_still_read(maker):
    """Initialized-style portfolio: almost no text, many links. It reaches the model."""
    from app.services.fetcher import FetchResult

    class LogosOnly:
        async def fetch(self, url):
            links = tuple((f"Co{i}", f"https://co{i}.io") for i in range(30))
            return FetchResult(url, "ok", text="Portfolio", final_url=url, links=links)

    async with maker() as db:
        out = await directory.ingest(
            db,
            LogosOnly(),
            listing(("Co1", "https://co1.io", "United States")),
            "Initialized Capital",
            "https://dir.test/p",
            NOW,
        )
    assert out["found"] == 1 and out["added"] == 1


async def test_dead_built_in_directories_are_removed_and_wrong_addresses_are_fixed(maker):
    from app.models import Directory

    async with maker() as db:
        await directory.ensure_defaults(db, NOW)
        for name in directory.RETIRED:  # as an older install has them
            db.add(Directory(name=name, url="https://old.example/x", builtin=True, created_at=NOW))
        keep = Directory(
            name="Atomico2", url="https://old.example/y", builtin=True, last_found=5, created_at=NOW
        )
        db.add(keep)
        pn = (
            await db.execute(select(Directory).where(Directory.name == "Point Nine"))
        ).scalar_one()
        pn.url, pn.last_run_at, pn.last_problem = "https://www.pointnine.com/portfolio", NOW, "gone"
        await db.commit()
        await directory.ensure_defaults(db, NOW)
        names = set((await db.execute(select(Directory.name))).scalars().all())
        assert not names & set(directory.RETIRED)
        assert "Atomico2" in names  # not on the list: untouched
        await db.refresh(pn)
        assert pn.url == "https://www.pointnine.com/companies"
        assert pn.last_run_at is None and pn.last_problem is None  # read again

        db.add(
            Directory(
                name="Atomico", url="https://x.example", builtin=True, last_found=7, created_at=NOW
            )
        )
        await db.commit()
        await directory.ensure_defaults(db, NOW)
        assert "Atomico" in set(
            (await db.execute(select(Directory.name))).scalars().all()
        )  # had startups


async def test_a_directory_that_cannot_be_read_says_why(maker):
    from app.models import Directory

    class Down:
        async def fetch(self, url):
            return FetchResult(
                url, "blocked", "No readable text was found. The page may need JavaScript."
            )

    async with maker() as db:
        await directory.ensure_defaults(db, NOW)
        d = (await db.execute(select(Directory).limit(1))).scalar_one()
        await directory.refresh(db, Down(), FakeLlmProvider(), d, NOW)
        assert d.last_found == 0 and "JavaScript" in d.last_problem and d.last_run_at is not None


@pytest.fixture
async def boss(new_client, staff_sign_in, settings, app):
    from app.routers.hunt import get_fetcher

    settings.admin_emails = "boss@example.com"
    app.dependency_overrides[get_fetcher] = lambda: OnePage()
    async with new_client() as c:
        await staff_sign_in(c, "boss@example.com")
        yield c


async def test_the_back_office_sees_directories_and_counts(boss, maker):
    await seed(maker, 2)
    d = (await boss.get("/api/admin/startups/overview")).json()
    assert len(d["directories"]) >= 10 and d["startups"] == 2
    assert (
        d["by_status"] == {"researched": 2} and d["with_contacts"] == 2 and d["with_openings"] == 0
    )


async def test_the_back_office_adds_turns_off_reads_and_deletes_directories(boss, app, cv_llm):
    from app.routers.autoapply import get_llm

    app.dependency_overrides[get_llm] = lambda: listing(
        ("Acme", "https://acme.io", "United States")
    )
    r = await boss.post(
        "/api/admin/startups/directories",
        json={"name": "Local Hub", "url": "https://hub.example/portfolio", "region_hint": "us"},
    )
    assert r.status_code == 201
    did = r.json()["id"]
    assert (
        await boss.post(
            "/api/admin/startups/directories",
            json={"name": "Local Hub", "url": "https://x.example/a"},
        )
    ).status_code == 409
    assert (
        await boss.post("/api/admin/startups/directories", json={"name": "Bad", "url": "ftp://x"})
    ).status_code == 422
    assert (
        await boss.post(
            "/api/admin/startups/directories",
            json={"name": "B", "url": "https://x.example/a", "region_hint": "mars"},
        )
    ).status_code == 422
    read = (await boss.post(f"/api/admin/startups/directories/{did}/refresh")).json()
    assert read["last_found"] == 1 and read["last_added"] == 1 and read["last_run_at"]
    assert (
        await boss.put(f"/api/admin/startups/directories/{did}", json={"enabled": False})
    ).json()["enabled"] is False
    assert (await boss.delete(f"/api/admin/startups/directories/{did}")).status_code == 204
    builtin = next(
        x
        for x in (await boss.get("/api/admin/startups/overview")).json()["directories"]
        if x["builtin"]
    )
    assert (
        await boss.delete(f"/api/admin/startups/directories/{builtin['id']}")
    ).status_code == 409


async def test_pasted_companies_are_imported_with_a_region(boss, maker):
    r = await boss.post(
        "/api/admin/startups/import",
        json={
            "directory": "Pasted",
            "region_hint": "eu",
            "startups": [
                {"name": "Acme", "website": "acme.io"},
                {"name": "Acme", "website": "https://www.acme.io/about"},
                {"name": "Bad", "website": "bad"},
            ],
        },
    )
    assert r.json() == {"added": 1, "skipped": 2}
    async with maker() as db:
        assert (await db.execute(select(Startup.region))).scalar_one() == "eu"


async def _with_roles(maker):
    """Two startups with open roles (one with a page per role), one researched without, one waiting."""
    async with maker() as db:
        a = await add_startup(
            db, "Lumen", "lumen.io", "eu", status="researched", country="France",
            research={
                "summary": "Lumen makes payment links.",
                "hiring": True,
                "careers_url": "https://lumen.io/careers",
                "openings": [
                    {"title": "Senior Product Manager", "url": "https://lumen.io/careers/pm"},
                    {"title": "Data Engineer", "url": "https://lumen.io/careers"},
                ],
            },
        )  # fmt: skip
        db.add(
            StartupContact(
                startup_id=a.id, email="jobs@lumen.io", kind="role",
                source_url="https://lumen.io/contact", found_at=NOW,
            )
        )  # fmt: skip
        await db.commit()
        await add_startup(
            db, "Nova", "nova.io", "us", status="researched",
            research={"summary": "Nova builds routers.", "hiring": True, "careers_url": None,
                      "openings": [{"title": "Product Designer", "url": "https://nova.io/jobs/1"}]},
        )  # fmt: skip
        await add_startup(db, "Quiet", "quiet.io", "us", status="researched",
                          research={"summary": "Quiet.", "hiring": False, "openings": []})  # fmt: skip
        await add_startup(db, "Fresh", "fresh.io", "uk", status="new")


async def test_the_back_office_lists_the_startups_behind_each_total_with_their_details(boss, maker):
    await _with_roles(maker)
    allr = (await boss.get("/api/admin/startups/list")).json()
    assert allr["total"] == 4 and len(allr["items"]) == 4
    lumen = next(i for i in allr["items"] if i["name"] == "Lumen")
    assert lumen["website"] == "https://lumen.io" and lumen["directory"] == "YC"
    assert lumen["directory_url"] == "https://dir.test" and lumen["country"] == "France"
    assert lumen["summary"] == "Lumen makes payment links." and lumen["hiring"] is True
    assert lumen["careers_url"] == "https://lumen.io/careers"
    assert [o["title"] for o in lumen["openings"]] == ["Senior Product Manager", "Data Engineer"]
    assert lumen["openings"][0]["url"] == "https://lumen.io/careers/pm"
    assert lumen["contacts"][0]["email"] == "jobs@lumen.io"
    assert lumen["contacts"][0]["source_url"] == "https://lumen.io/contact"

    def names(**q):
        r = boss.get("/api/admin/startups/list", params=q)
        return r

    for q, want in (
        ({"filter": "researched"}, {"Lumen", "Nova", "Quiet"}),
        ({"filter": "new"}, {"Fresh"}),
        ({"filter": "contacts"}, {"Lumen"}),
        ({"filter": "openings"}, {"Lumen", "Nova"}),
        ({"region": "us"}, {"Nova", "Quiet"}),
        ({"q": "ROUTERS"}, {"Nova"}),
        ({"q": "lumen.io"}, {"Lumen"}),
        ({"directory": "YC", "filter": "openings"}, {"Lumen", "Nova"}),
        ({"directory": "nowhere"}, set()),
    ):
        got = (await names(**q)).json()
        assert {i["name"] for i in got["items"]} == want and got["total"] == len(want), q


async def test_the_startup_list_is_paged(boss, maker):
    await _with_roles(maker)
    first = (await boss.get("/api/admin/startups/list", params={"limit": 3})).json()
    rest = (await boss.get("/api/admin/startups/list", params={"limit": 3, "offset": 3})).json()
    assert first["total"] == rest["total"] == 4 and len(first["items"]) == 3
    assert len(rest["items"]) == 1
    assert not {i["id"] for i in first["items"]} & {i["id"] for i in rest["items"]}
    assert (await boss.get("/api/admin/startups/list", params={"limit": 500})).status_code == 422
    assert (await boss.get("/api/admin/startups/list", params={"filter": "x"})).status_code == 422


async def test_the_back_office_lists_every_open_role_with_the_startup_and_where_to_apply(
    boss, maker
):
    await _with_roles(maker)
    d = (await boss.get("/api/admin/startups/roles")).json()
    assert d["total"] == 3 and d["startups"] == 2
    by_title = {i["title"]: i for i in d["items"]}
    pm = by_title["Senior Product Manager"]
    assert pm["startup"] == "Lumen" and pm["url"] == "https://lumen.io/careers/pm"
    assert pm["website"] == "https://lumen.io" and pm["careers_url"] == "https://lumen.io/careers"
    assert pm["region"] == "eu" and pm["country"] == "France" and pm["directory"] == "YC"
    assert by_title["Product Designer"]["url"] == "https://nova.io/jobs/1"
    one = (await boss.get("/api/admin/startups/roles", params={"q": "designer"})).json()
    assert [i["title"] for i in one["items"]] == ["Product Designer"] and one["total"] == 1
    assert (await boss.get("/api/admin/startups/roles", params={"q": "lumen"})).json()["total"] == 2
    us = (await boss.get("/api/admin/startups/roles", params={"region": "us"})).json()
    assert [i["startup"] for i in us["items"]] == ["Nova"]
    page = (await boss.get("/api/admin/startups/roles", params={"limit": 2, "offset": 2})).json()
    assert page["total"] == 3 and len(page["items"]) == 1


async def test_customers_cannot_see_the_startup_lists(ada):
    assert (await ada.get("/api/admin/startups/list")).status_code in (401, 403)
    assert (await ada.get("/api/admin/startups/roles")).status_code in (401, 403)


async def test_customers_cannot_use_the_back_office_tools(ada):
    assert (await ada.get("/api/admin/startups/overview")).status_code in (401, 403)
    assert (
        await ada.post(
            "/api/admin/startups/directories", json={"name": "x", "url": "https://x.example"}
        )
    ).status_code in (401, 403)


# ------------------------------------------------------------------------------ placing + seed


async def test_a_company_with_no_country_is_placed_from_its_own_site_or_left_alone(maker):
    llm = lambda country: FakeLlmProvider(  # noqa: E731
        json_reply=json.dumps(
            {"summary": "x", "hiring": False, "roles": [], "people": [], "country": country}
        )
    )
    page = "Acme builds payments. Our head office is in Berlin, Germany. " * 3
    pages = Pages({"https://acme.io": (page, ["hello@acme.io"])})
    async with maker() as db:
        s = await add_startup(db, region="other")
        out = await research.research(db, pages, llm("Germany"), s, NOW)
        assert s.region == "eu" and s.country == "Germany" and out["contacts"] == 1

        lied = await add_startup(db, "Beta", "beta.io", region="other")
        pages2 = Pages({"https://beta.io": (page, ["hello@beta.io"])})
        # the model says a country the page never mentions: not believed, company left unplaced
        await research.research(db, pages2, llm("United States"), lied, NOW)
        assert lied.region == "other"
        assert (
            await db.execute(select(StartupContact).where(StartupContact.startup_id == lied.id))
        ).first() is None

        unknown = await add_startup(db, "Gamma", "gamma.io", region="other")
        await research.research(
            db,
            Pages({"https://gamma.io": (page, ["hello@gamma.io"])}),
            llm("Nigeria"),
            unknown,
            NOW,
        )
        assert unknown.region == "other"  # not US, Europe or UK: never written to


async def test_unplaced_companies_are_researched_too_but_placed_ones_go_first(maker):
    from app.hunt import jobs

    async with maker() as db:
        await add_startup(db, "Other", "other.io", region="other")
        await add_startup(db, "Placed", "placed.io", region="us")
    seen = []

    class Spy(Pages):
        async def fetch(self, url):
            seen.append(url)
            return await super().fetch(url)

    n = await jobs.research_pending(maker, Spy({}), FakeLlmProvider(), NOW, limit=1)
    assert n == 1 and seen[0].startswith("https://placed.io")
    assert (
        await jobs.research_pending(maker, Spy({}), FakeLlmProvider(), NOW, limit=5) == 1
    )  # then the other one


async def test_the_starter_list_is_added_once_and_gets_its_regions_from_the_country(maker):
    from app.hunt import seed

    async with maker() as db:
        assert len(seed.SEED) >= 30
        first = await directory.ensure_seed(db, NOW)
        assert first == len(seed.SEED) and await directory.ensure_seed(db, NOW) == 0
        by = {s.name: s.region for s in (await db.execute(select(Startup))).scalars().all()}
    assert (
        by["Stripe"] == "us"
        and by["Monzo"] == "uk"
        and by["Mollie"] == "eu"
        and by["Klarna"] == "eu"
    )
    assert "other" not in by.values()
