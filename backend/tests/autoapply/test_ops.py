"""Operating Auto-Apply: kill switches, the back-office page, metrics and production safety."""

import json
from datetime import timedelta

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app import metrics
from app.autoapply import discovery, outbox, switches
from app.hardening import _autoapply_problems
from app.models import Event
from tests.autoapply.conftest import apps, connect_mailbox, email_job, job, run, start, user_id


async def flip(client, name, on=True, reason="test"):
    return await client.put(
        f"/api/admin/autoapply/switches/{name}", json={"on": on, "reason": reason}
    )


@pytest.fixture
async def boss(new_client, staff_sign_in, settings):
    settings.admin_emails = "boss@example.com"
    async with new_client() as c:
        await staff_sign_in(c, "boss@example.com")
        yield c


# ------------------------------------------------------------------------------ switches


async def test_the_global_switch_stops_every_new_send_but_not_discovery(
    ada, boss, discovery_source, form, mailbox, tick, maker
):
    discovery_source.postings = [job(1), email_job(2)]
    await start(ada)
    await connect_mailbox(ada)
    assert (await flip(boss, "global")).status_code == 200
    await tick()
    assert form.calls == 0 and mailbox.sent == []
    assert len(await apps(ada, "queued")) == 2  # found and prepared, waiting
    await flip(boss, "global", on=False)
    await tick()
    assert form.calls == 1 and len(mailbox.sent) == 1


async def test_a_channel_switch_stops_only_that_channel(
    ada, boss, discovery_source, form, mailbox, tick
):
    discovery_source.postings = [job(1), email_job(2)]
    await start(ada)
    await connect_mailbox(ada)
    await flip(boss, "channel:email")
    await tick()
    assert form.calls == 1 and mailbox.sent == []


async def test_a_provider_switch_stops_whatever_uses_that_provider(
    ada, boss, discovery_source, form, mailbox, tick
):
    discovery_source.postings = [job(1), email_job(2)]
    await start(ada)
    await connect_mailbox(ada)
    await flip(boss, "provider:fixture")  # both fixture adapters are named "fixture"
    await tick()
    assert form.calls == 0 and mailbox.sent == []


async def test_a_switch_flipped_after_the_claim_still_stops_the_send(
    ada, boss, discovery_source, form, maker, outbox_adapters, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)
    uid = await user_id(maker)
    claim = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    await flip(boss, "global")
    assert await outbox.execute(maker, claim, outbox_adapters, clock.now) == "cancelled"
    assert form.calls == 0 and (await apps(ada))[0]["status"] == "queued"


async def test_rolling_back_keeps_settling_what_is_already_in_flight(
    ada, boss, discovery_source, form, tick, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    form.mode = "timeout_after"
    await tick()
    assert (await apps(ada))[0]["status"] == "confirmation_pending"
    await flip(boss, "global")  # roll back
    form.mode = "ok"
    clock.now += timedelta(minutes=5)
    await tick()
    assert (await apps(ada))[0]["status"] == "submitted"  # still reconciled, never resent
    assert form.calls == 1


async def test_outreach_also_obeys_the_switches(ada, boss, discovery_source, mailbox, tick):
    discovery_source.postings = [
        job(1, hiring_contact="r@acme.test", evidence={"hiring_contact": "x", "region": "y"})
    ]
    await start(ada)
    await connect_mailbox(ada, email=False, outreach=True)
    await tick()
    await flip(boss, "channel:outreach")
    await tick()
    await tick()
    assert mailbox.sent == []


def test_switch_names_are_checked():
    assert (
        switches.valid("global")
        and switches.valid("channel:email")
        and switches.valid("provider:gmail")
    )
    assert (
        not switches.valid("channel:fax")
        and not switches.valid("provider:")
        and not switches.valid("anything")
    )
    assert switches.blocked({"global"}, "form", "fixture") == "sending is switched off"
    assert switches.blocked(set(), "form", "fixture") is None


# ------------------------------------------------------------------------- the back office


async def test_the_back_office_page_shows_how_it_is_going_and_what_is_stuck(
    ada, boss, discovery_source, form, mailbox, tick, clock
):
    discovery_source.postings = [job(1), job(2), email_job(3)]
    await start(ada)
    await connect_mailbox(ada)
    form.mode = "timeout_before"
    await tick()
    form.mode = "ok"
    d = (await boss.get("/api/admin/autoapply")).json()
    assert d["enabled"] is True and d["campaigns_active"] == 1 and d["campaigns_paused"] == 0
    assert d["attempts_unresolved"] >= 1 and d["unresolved"][0]["person"] == "ada@example.com"
    assert d["unresolved"][0]["company"] == "Acme" and d["unresolved"][0]["state"] == "ambiguous"
    assert d["mailboxes"] == {"connected": 1} and d["discovery_runs"] == {"done": 1}
    assert d["dispatch"] == {"form": False, "email": False, "outreach": False}
    assert d["applications_sent"] >= 1 and d["invitations_per_100"] is None  # too early to say
    await ada.post("/api/autoapply/campaign/pause")
    assert (await boss.get("/api/admin/autoapply")).json()["campaigns_paused"] == 1


async def test_the_page_never_shows_what_a_candidate_wrote(ada, boss, discovery_source, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await tick()
    text = (await boss.get("/api/admin/autoapply")).text
    assert "Northwind" not in text and "Led payments" not in text  # nothing from the CV


async def test_the_invitation_rate_is_measured_on_applications_a_month_old(
    ada, boss, discovery_source, tick, clock, maker, mailbox
):
    from tests.autoapply.test_recruiting import interviews_of, msg, our_ref

    discovery_source.postings = [email_job(1), email_job(2), email_job(3), email_job(4)]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    sent = await apps(ada, "sent_email")
    assert len(sent) == 4
    ref, thread = await our_ref(maker, sent[0]["id"])
    mailbox.inbox.append(
        msg(
            1,
            "Interview",
            "Your interview is confirmed for December 3, 2026 at 2:00 PM UTC",
            thread=thread,
            reply_to=ref,
            frm="rec@acme.test",
        )
    )
    await tick()
    assert len(await interviews_of(maker)) == 1
    assert (await boss.get("/api/admin/autoapply")).json()["invitations_per_100"] is None  # too new
    async with maker() as db:
        from sqlalchemy import update

        from app.models import SubmissionAttempt

        await db.execute(
            update(SubmissionAttempt).values(finished_at=clock.now - timedelta(days=45))
        )
        await db.commit()
    d = (await boss.get("/api/admin/autoapply")).json()
    assert d["cohort_size"] == 4 and d["invitations_per_100"] == 25.0


async def test_only_staff_can_use_the_page_or_the_switches(new_client, sign_in, ada):
    for method, path in (
        ("get", "/api/admin/autoapply"),
        ("put", "/api/admin/autoapply/switches/global"),
    ):
        r = await getattr(ada, method)(path, **({"json": {"on": True}} if method == "put" else {}))
        assert r.status_code == 401


async def test_flipping_a_switch_is_logged_with_who_and_why(ada, boss, maker):
    assert (await flip(boss, "channel:form", reason="employer form broke")).json()[
        "reason"
    ] == "employer form broke"
    async with maker() as db:
        ev = (await db.execute(select(Event).where(Event.kind == "admin.switch"))).scalar_one()
        assert (
            ev.data["name"] == "channel:form" and ev.data["on"] is True and ev.actor_id is not None
        )
    bad = await flip(boss, "channel:fax")
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "unknown_switch"


# ------------------------------------------------------------------------------- metrics


async def test_a_pass_publishes_health_and_counts_sends(ada, discovery_source, form, tick, clock):
    discovery_source.postings = [job(1)]
    await start(ada)
    before = metrics.autoapply_dispatch.labels("form", "confirmed")._value.get()
    form.mode = "timeout_before"
    await tick()
    assert metrics.autoapply_tick_timestamp._value.get() == clock.now.timestamp()
    assert metrics.autoapply_unresolved._value.get() == 1
    clock.now += timedelta(hours=3)
    await tick()
    assert metrics.autoapply_unresolved_age._value.get() >= 3 * 3600
    assert metrics.autoapply_mailbox_staleness._value.get() == 0  # no mailbox connected
    assert metrics.autoapply_dispatch.labels("form", "confirmed")._value.get() == before


async def test_a_repeat_sighting_counts_as_a_prevented_duplicate(
    ada, discovery_source, tick, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    before = metrics.autoapply_duplicates._value.get()
    await tick()
    clock.now += timedelta(days=1)
    await tick()
    assert metrics.autoapply_duplicates._value.get() == before + 1


# ------------------------------------------------------------------------ production safety


def problems(settings, **over):
    settings.autoapply_enabled = True
    for k, v in over.items():
        setattr(settings, k, v)
    return _autoapply_problems(settings)


def test_nothing_is_checked_while_the_feature_is_off(settings):
    settings.autoapply_enabled = False
    settings.autoapply_mailbox_provider = "gmail"
    assert _autoapply_problems(settings) == []


def test_gmail_needs_its_credentials_and_an_encryption_key_in_production(settings):
    p = problems(settings, autoapply_mailbox_provider="gmail", environment="production")
    assert any("GMAIL_CLIENT_ID" in m for m in p) and any("MAILBOX_ENCRYPTION_KEY" in m for m in p)
    ok = problems(
        settings,
        gmail_client_id="id",
        gmail_client_secret=SecretStr("s"),
        mailbox_encryption_key=SecretStr("k"),
        autoapply_discovery_sources="greenhouse",
    )
    assert ok == []


def test_real_sending_outside_production_needs_an_allowlist(settings):
    settings.environment = "staging"
    assert any(
        "AUTOAPPLY_ALLOWED_RECIPIENTS" in m
        for m in problems(settings, autoapply_email_dispatch=True)
    )
    assert (
        problems(settings, autoapply_email_dispatch=True, autoapply_allowed_recipients="me@x.test")
        == []
    )


def test_the_fixture_source_is_refused_in_production(settings):
    p = problems(
        settings, environment="production", autoapply_discovery_sources="fixture,greenhouse"
    )
    assert any("fixture" in m for m in p)


def test_an_unknown_mailbox_provider_is_refused(settings):
    assert any(
        "fixture or gmail" in m for m in problems(settings, autoapply_mailbox_provider="outlook")
    )


# ----------------------------------------------------------------------- fixture job file


def test_fixture_listings_can_come_from_a_file_but_never_in_production(settings, tmp_path):
    f = tmp_path / "jobs.json"
    f.write_text(
        json.dumps(
            [
                {
                    "source": "fixture",
                    "source_url": "https://x.test/1",
                    "company": "Acme",
                    "title": "PM",
                    "expires_at": "2026-12-01T00:00:00+00:00",
                }
            ]
        )
    )
    settings.autoapply_fixture_jobs_file = str(f)
    settings.autoapply_discovery_sources = "fixture"
    (src,) = discovery.build_sources(settings)
    assert src.postings[0].title == "PM" and src.postings[0].expires_at.year == 2026
    settings.environment = "production"
    (src,) = discovery.build_sources(settings)
    assert src.postings == []


def test_demo_mode_offers_built_in_sample_jobs_but_never_in_production(settings):
    settings.autoapply_discovery_sources = "fixture"
    assert discovery.build_sources(settings)[0].postings == []  # off unless asked for
    settings.autoapply_sample_jobs = True
    jobs = discovery.build_sources(settings)[0].postings
    assert len(jobs) >= 10 and all("(demo)" in j.company for j in jobs)
    assert len({j.source_url for j in jobs}) == len(jobs)
    settings.environment = "production"
    assert discovery.build_sources(settings)[0].postings == []
    assert any(
        "demo mode" in m
        for m in problems(settings, autoapply_sample_jobs=True, environment="production")
    )


async def test_the_dashboard_says_when_it_is_demo_mode(ada, settings):
    assert (await ada.get("/api/autoapply/dashboard")).json()["demo"] is False
    settings.autoapply_sample_jobs = True
    assert (await ada.get("/api/autoapply/dashboard")).json()["demo"] is True
    assert (await ada.get("/api/autoapply/status")).json()["demo"] is True


async def test_a_candidate_in_demo_mode_gets_matches_from_the_samples(ada, settings, tick, maker):
    settings.autoapply_sample_jobs = True
    settings.autoapply_discovery_sources = "fixture"
    from app.autoapply import discovery as disc
    from app.routers.autoapply import get_sources

    src = disc.build_sources(settings)
    ada_app = ada._transport.app  # type: ignore[attr-defined]
    ada_app.dependency_overrides[get_sources] = lambda: src
    from tests.autoapply.conftest import PROFILE

    await ada.put(
        "/api/autoapply/profile",
        json={
            **PROFILE,
            "criteria": {
                "roles": [{"value": "Product Manager", "required": True}],
                "locations": [{"value": "Nigeria", "required": True}],
                "arrangement": [{"value": "remote", "required": False}],
            },
        },
    )
    from tests.autoapply.conftest import FACTS

    await ada.put("/api/autoapply/facts", json={"data": FACTS, "verified": True})
    await ada.post(
        "/api/autoapply/campaign/enable", json={"policy_version": "2026-11", "accept": True}
    )
    run = (await ada.post("/api/autoapply/discovery/run")).json()
    assert run["found"] >= 10 and run["eligible"] >= 1 and run["skipped"] >= 3
