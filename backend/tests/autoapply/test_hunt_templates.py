"""The candidate's own startup emails: templates with their details filled in, a company name that
is always the startup being written to, when the first note goes, and the follow-up delay."""

import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.adapters.fakes import FakeLlmProvider
from app.hunt import engine, template
from app.models import HuntSettings, HuntTarget, Startup, StartupContact
from tests.autoapply.test_hunt import NOW, seed, setup, write_llm  # noqa: F401

FIRST = {
    "first_subject": "Product Manager interested in {{Company}}",
    "first_body": (
        "Hi {{First name}},\n\nI've been following {{Company}}. {{company_hook}}\n\n"
        "I'm {{sender_name}}. My portfolio is here: {{portfolio link}}, and my CV is attached.\n\n"
        "Best regards,\n{{sender_name}}"
    ),
    "follow_subject": "Re: Product Manager interested in {{Company}}",
    "follow_body": "Hi {{First name}},\n\nFollowing up. Portfolio: {{portfolio_link}}\n\n{{sender_name}}",
}
HOOK = json.dumps({"text": "Marketplace payments is close to my own work."})


@pytest.fixture(autouse=True)
def _on(settings):
    settings.startup_outreach_enabled = True


def body(**over):
    return {
        **FIRST,
        "use_template": True,
        "variables": {"Portfolio link": "https://justus.example/work"},
        "follow_up_days": 6,
        **over,
    }


# ------------------------------------------------------------------------------ the renderer


def test_variable_names_are_forgiving_and_notes_after_a_colon_are_ignored():
    assert template.key("Portfolio link") == "portfolio_link"
    assert template.key("First name") == "first_name"
    assert template.key("company name") == "company"
    assert template.key("specific thing: a launch or funding round") == "company_hook"
    assert template.used("{{Company}} {{ company }} {{First name}}") == ["company", "first_name"]


def test_a_value_is_never_read_again_as_template_text():
    out, missing = template.render("Hi {{first_name}} at {{company}}", {
        "first_name": "{{company}}", "company": "Acme"})  # fmt: skip
    assert out == "Hi {{company}} at Acme" and missing == []  # one pass only


def test_public_text_is_made_harmless():
    assert template.clean_public("Acme {{x}}\nhttps://evil <b>", 50) == "Acme x https://evil b"
    got = template.clean_variables({"Portfolio link": "https://a.example\n{{x}}", "company": "x"})
    assert got == {"portfolio_link": "https://a.example x"}  # built-ins cannot be overridden


def test_a_missing_variable_is_left_visible_and_named():
    out, missing = template.render("See {{portfolio_link}} and {{phone}}", {"phone": "1"})
    assert out == "See {{portfolio_link}} and 1" and missing == ["portfolio_link"]


# ------------------------------------------------------------------------------ the editor API


async def test_save_read_and_preview_the_templates(ada, maker, mailbox):
    await setup(ada, maker, mailbox)
    await seed(maker, 1)
    saved = (await ada.put("/api/hunt/template", json=body())).json()
    assert saved["use_template"] and saved["follow_up_days"] == 6
    assert saved["variables"] == {"portfolio_link": "https://justus.example/work"}
    assert saved["unknown"] == []  # every variable has a value or is built in
    assert "company" in saved["builtin"] and saved["starter"]["first_body"]
    r = await ada.post("/api/hunt/template/preview", json={"which": "first"})
    p = r.json()
    assert p["subject"] == f"Product Manager interested in {p['company']}"
    assert "https://justus.example/work" in p["body"] and "Hi Sam," in p["body"]
    assert "{{" not in p["body"] and p["missing"] == []
    # an unsaved edit can be previewed, with a detail that has no value yet
    q = (
        await ada.post(
            "/api/hunt/template/preview",
            json={"which": "first", "subject": "Hello {{company}}", "body": "Call me on {{phone}}"},
        )
    ).json()
    assert q["missing"] == ["phone"] and "{{phone}}" in q["body"]


async def test_cannot_turn_templates_on_without_a_first_email(ada, maker, mailbox):
    await setup(ada, maker, mailbox)
    r = await ada.put("/api/hunt/template", json={"use_template": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_first_email"
    bad = await ada.put("/api/hunt/template", json=body(window_start=17, window_end=9))
    assert bad.status_code == 422


async def test_only_invited_people_can_use_it(ada, new_client, sign_in):
    async with new_client() as eve:
        await sign_in(eve, "eve@example.com")
        assert (await eve.get("/api/hunt/template")).status_code == 403


# ---------------------------------------------------------------------- what is actually sent


async def test_the_first_email_is_the_template_for_the_startup_it_goes_to(
    ada, maker, mailbox, settings
):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    await ada.put("/api/hunt/template", json=body())
    async with maker() as db:
        await engine.plan(db, uid, NOW, FakeLlmProvider(json_reply=HOOK))
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) == "sent"
    m = mailbox.sent[0]
    assert m["subject"] == "Product Manager interested in Acme0"  # the startup, not the candidate
    assert "Hi there," in m["body"]  # a jobs@ address has no first name
    assert "I've been following Acme0. Marketplace payments is close to my own work." in m["body"]
    assert "https://justus.example/work" in m["body"] and "{{" not in m["body"]
    assert "no thanks" not in m["body"] and "12 Marina" not in m["body"]  # exactly what you wrote
    assert m["body"].rstrip().endswith("Best regards,\nAda Okoye")
    assert m["attachments"]  # the CV goes with it


async def test_a_note_with_a_detail_still_to_fill_in_is_held_never_sent(
    ada, maker, mailbox, settings
):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    await ada.put("/api/hunt/template", json=body(variables={}))  # no portfolio link yet
    async with maker() as db:
        await engine.plan(db, uid, NOW, FakeLlmProvider(json_reply=HOOK))
        t = (await db.execute(select(HuntTarget))).scalar_one()
    assert t.status == "drafted" and "portfolio_link" in (t.reason or "")  # even on auto-send
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None
    approve = await ada.post(f"/api/hunt/targets/{t.id}/approve")
    assert approve.status_code == 409 and approve.json()["error"]["code"] == "unfilled"
    async with maker() as db:  # even if one were approved by other means, it is not sent
        row = await db.get(HuntTarget, t.id)
        assert row is not None
        row.status = "approved"
        await db.commit()
    assert await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(minutes=5)) is None
    assert mailbox.sent == []


async def test_the_follow_up_comes_after_the_days_you_chose_and_is_your_template(
    ada, maker, mailbox, settings
):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    await ada.put("/api/hunt/template", json=body(follow_up_days=3))
    async with maker() as db:
        await engine.plan(db, uid, NOW, FakeLlmProvider(json_reply=HOOK))
    await engine.send_next(maker, uid, mailbox, settings, NOW)
    async with maker() as db:
        assert await engine.plan_followups(db, uid, NOW + timedelta(days=2)) == 0
        assert await engine.plan_followups(db, uid, NOW + timedelta(days=3)) == 1
    later = NOW + timedelta(days=3)  # a Thursday
    assert await engine.send_next(maker, uid, mailbox, settings, later) == "sent"
    m = mailbox.sent[1]
    assert m["subject"] == "Re: Product Manager interested in Acme0"
    assert "Following up. Portfolio: https://justus.example/work" in m["body"]


async def test_follow_ups_can_be_switched_off(ada, maker, mailbox, settings):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    await ada.put("/api/hunt/template", json=body(follow_up_enabled=False))
    async with maker() as db:
        await engine.plan(db, uid, NOW, FakeLlmProvider(json_reply=HOOK))
    await engine.send_next(maker, uid, mailbox, settings, NOW)
    async with maker() as db:
        assert await engine.plan_followups(db, uid, NOW + timedelta(days=30)) == 0


async def test_nothing_goes_before_the_start_time_or_outside_your_hours(
    ada, maker, mailbox, settings
):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    start = NOW + timedelta(days=1)  # Tuesday 09:00 UTC
    await ada.put("/api/hunt/template", json=body(send_not_before=start.isoformat()))
    async with maker() as db:
        await engine.plan(db, uid, NOW, FakeLlmProvider(json_reply=HOOK))
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None  # too early
    assert await engine.send_next(maker, uid, mailbox, settings, start + timedelta(minutes=1)) == (
        "sent"
    )


async def test_your_sending_hours_are_used(ada, maker, mailbox, settings):
    uid = await setup(ada, maker, mailbox, auto_send=True)
    await seed(maker, 1)
    # 09:00 UTC is before 14:00 wherever the test candidate is (UTC or Lagos)
    await ada.put("/api/hunt/template", json=body(window_start=14, window_end=16))
    async with maker() as db:
        await engine.plan(db, uid, NOW, FakeLlmProvider(json_reply=HOOK))
    assert await engine.send_next(maker, uid, mailbox, settings, NOW) is None
    assert await engine.send_next(maker, uid, mailbox, settings, NOW + timedelta(hours=5)) == "sent"


async def test_without_templates_the_written_note_is_unchanged(
    ada,
    maker,
    mailbox,
    settings,
    write_llm,  # noqa: F811
):
    uid = await setup(ada, maker, mailbox)
    await seed(maker, 1)
    async with maker() as db:
        await engine.plan(db, uid, NOW, write_llm)
        t = (await db.execute(select(HuntTarget))).scalar_one()
        st = (await db.execute(select(HuntSettings))).scalar_one()
    assert not st.use_template and "My CV is attached." in t.body and t.status == "drafted"


async def test_a_company_name_cannot_inject_template_text(ada, maker, mailbox):
    uid = await setup(ada, maker, mailbox)
    async with maker() as db:
        s = Startup(name="Evil {{portfolio_link}}\nBcc: x@y.z", domain="evil.io",
                    website="https://evil.io", directory="d", directory_url="u",
                    status="researched", region="us", research={"summary": "x"})  # fmt: skip
        db.add(s)
        await db.flush()
        c = StartupContact(startup_id=s.id, email="jobs@evil.io", kind="role",
                           source_url="https://evil.io", found_at=NOW)  # fmt: skip
        db.add(c)
        st = (await db.execute(select(HuntSettings))).scalar_one()
        st.template, st.use_template = dict(FIRST), True
        st.variables = {"portfolio_link": "https://justus.example"}
        subject, text, _ = template.compose(st, s, c, "first", "")
    assert "\n" not in subject and "Bcc:" in subject  # a harmless word, on one line
    assert "{{" not in subject.replace("{{company_hook}}", "")
    del uid
