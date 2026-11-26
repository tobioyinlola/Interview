"""Phase 3: sending by form and by email, the daily limits, concurrent workers, unknown outcomes,
and everything that must stop work before it is dispatched."""

import asyncio
import io
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.autoapply import cvfile, outbox
from app.autoapply.adapters import AdapterError
from app.models import Application, MailboxConnection, SubmissionAttempt
from tests.autoapply.conftest import (
    PROFILE,
    apps,
    connect_mailbox,
    email_job,
    job,
    run,
    start,
    user_id,
)


async def states(c):
    return sorted(a["status"] for a in await apps(c))


async def attempts(maker, **where):
    async with maker() as db:
        q = select(SubmissionAttempt)
        for k, v in where.items():
            q = q.where(getattr(SubmissionAttempt, k) == v)
        return (await db.execute(q.order_by(SubmissionAttempt.claimed_at))).scalars().all()


# ------------------------------------------------------------------------------ by form


async def test_a_matching_role_goes_from_discovery_to_a_confirmed_submission_with_no_clicks(
    ada, discovery_source, form, tick, maker
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await tick()
    a = (await apps(ada))[0]
    assert a["status"] == "submitted" and a["channel"] == "form"
    assert form.calls == 1 and len(form.submitted) == 1
    sent = next(iter(form.submitted.values()))
    assert sent["url"].endswith("/acme/1") and "Northwind" in sent["cv"]
    assert sent["values"]["name"] == "Ada Okoye" and sent["values"]["email"] == "ada@example.com"
    d = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    assert (
        d["attempts"][0]["state"] == "confirmed" and d["attempts"][0]["provider_ref"] == "FX-0001"
    )
    assert [h["kind"] for h in d["history"]][-2:] == ["sending", "submitted"]


async def test_what_is_sent_is_exactly_the_frozen_package(ada, discovery_source, form, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)
    a = (await apps(ada))[0]
    frozen = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()["package"]
    await ada.put("/api/notes", json={"role": "PM", "content": "Edited after the fact."})
    await tick()
    sent = next(iter(form.submitted.values()))
    assert sent["cv"] == frozen["cv"]["submitted_text"]
    assert sent["values"]["cover_letter"] == frozen["cover_text"]


async def test_a_second_pass_does_not_send_again(ada, discovery_source, form, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await tick()
    await tick()
    await tick()
    assert form.calls == 1 and len(await apps(ada)) == 1


# --------------------------------------------------------------------------- by email


async def test_an_email_only_listing_is_sent_from_the_connected_account_with_the_right_cv(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    a = (await apps(ada))[0]
    assert a["status"] == "sent_email" and a["channel"] == "email"
    assert len(mailbox.sent) == 1
    m = mailbox.sent[0]
    assert m["from"] == "ada@example.com" and m["to"] == "jobs1@acme.test"
    assert m["subject"] == "PM application"  # the listing's own subject instruction
    pdf = m["attachments"][0]
    assert pdf.filename == "CV.pdf" and pdf.content.startswith(b"%PDF")
    package = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()["package"]
    assert "Senior Product Manager" in cvfile.pdf_text(pdf.content)
    assert cvfile.pdf_text(pdf.content).splitlines()[0] == "ADA OKOYE"  # the house layout
    assert package["cv"]["submitted_text"].splitlines()[0] == "Ada Okoye"
    d = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    att = d["attempts"][0]
    assert att["state"] == "confirmed" and att["provider_ref"].endswith("@interviewmeet.app")


async def test_the_cv_sent_and_downloaded_is_a_pdf_in_the_house_layout(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    a = (await apps(ada))[0]
    sent = mailbox.sent[0]["attachments"][0].content
    download = (await ada.get(f"/api/autoapply/applications/{a['id']}/cv.pdf")).content
    for pdf in (sent, download):
        words = cvfile.pdf_text(pdf)
        assert words.splitlines()[0] == "ADA OKOYE"  # the name in capitals, centred
        assert "PROFESSIONAL EXPERIENCE" in words and "CORE COMPETENCIES" in words
    got = await ada.get(f"/api/autoapply/applications/{a['id']}/cv.pdf")
    assert got.headers["content-type"] == "application/pdf"
    assert "attachment" in got.headers["content-disposition"]
    stranger = await ada.get(
        "/api/autoapply/applications/00000000-0000-0000-0000-000000000000/cv.pdf"
    )
    assert stranger.status_code == 404


async def test_email_is_only_used_when_the_listing_itself_designates_it(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [email_job(1, evidence={"region": "the location line"})]  # no proof
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    a = (await apps(ada))[0]
    assert a["status"] == "skipped" and mailbox.sent == []


async def test_the_default_subject_names_the_role_and_requisition(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [email_job(1, apply_instructions="Send your CV by email.")]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    assert mailbox.sent[0]["subject"] == "Application: Senior Product Manager (REQ-1)"


async def test_email_needs_a_connected_mailbox_and_waits_for_one(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    r = await ada.put("/api/autoapply/profile", json={"channels": {"form": True, "email": True}})
    assert r.status_code == 200
    await tick()
    # no mailbox: the listing needs email, which cannot work, so nothing is sent
    assert mailbox.sent == [] and (await apps(ada))[0]["status"] != "sent_email"


# --------------------------------------------------------------------------- daily limit


async def test_the_daily_limit_holds_and_the_next_day_continues(
    ada, discovery_source, form, tick, clock
):
    discovery_source.postings = [job(i) for i in range(1, 6)]
    await start(ada, daily_application_cap=2)
    await tick()
    assert form.calls == 2 and (await states(ada)).count("submitted") == 2
    await tick()
    assert form.calls == 2  # still the same day
    clock.now += timedelta(days=1)
    await tick()
    assert form.calls == 4
    clock.now += timedelta(days=1)
    await tick()
    assert form.calls == 5 and (await states(ada)).count("submitted") == 5


async def test_the_best_matches_go_first(ada, discovery_source, form, tick):
    prefs = {**PROFILE["criteria"], "industries": [{"value": "fintech", "required": False}]}
    discovery_source.postings = [job(1, industry="retail"), job(2, industry="fintech")]
    await start(ada, criteria=prefs, daily_application_cap=1)
    await tick()
    sent = next(iter(form.submitted.values()))
    assert sent["url"].endswith("/acme/2")


async def test_unknown_outcomes_keep_counting_against_the_limit(
    ada, discovery_source, form, tick, clock
):
    discovery_source.postings = [job(1), job(2)]
    await start(ada, daily_application_cap=1)
    form.mode = "timeout_before"
    await tick()
    form.mode = "ok"
    clock.now += timedelta(days=1)  # a new day, but the first outcome is still unknown
    await tick()
    assert form.calls == 1  # the unresolved attempt still uses the limit


# ------------------------------------------------------------------ concurrency and safety


async def test_simultaneous_workers_send_each_application_once_and_respect_the_limit(
    ada, discovery_source, form, maker, outbox_adapters, clock
):
    discovery_source.postings = [job(i) for i in range(1, 9)]
    await start(ada, daily_application_cap=4)
    await run(ada)
    uid = await user_id(maker)
    counts = await asyncio.gather(
        *[outbox.dispatch_user(maker, uid, outbox_adapters, clock.now) for _ in range(8)]
    )
    assert sum(counts) == 4 and form.calls == 4 and len(form.submitted) == 4
    rows = await attempts(maker)
    assert len(rows) == 4 and len({r.application_id for r in rows}) == 4
    assert len({r.idempotency_key for r in rows}) == 4


async def test_the_same_intent_cannot_be_dispatched_twice_even_by_the_adapter(form):
    first = await form.submit(
        "https://jobs.fixture.test/x", idempotency_key="k1", values={}, cv_text="c", cv_filename="f"
    )
    again = await form.submit(
        "https://jobs.fixture.test/x", idempotency_key="k1", values={}, cv_text="c", cv_filename="f"
    )
    assert first.reference == again.reference and len(form.submitted) == 1


async def test_a_pause_before_the_final_check_stops_the_send(
    ada, discovery_source, form, maker, outbox_adapters, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)
    uid = await user_id(maker)
    claim = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    assert claim is not None
    await ada.post("/api/autoapply/campaign/pause")  # after the claim, before the final check
    state = await outbox.execute(maker, claim, outbox_adapters, clock.now)
    assert state == "cancelled" and form.calls == 0
    assert (await apps(ada))[0]["status"] == "queued"
    rows = await attempts(maker)
    assert rows[0].state == "cancelled"
    await ada.post("/api/autoapply/campaign/resume")
    await outbox.dispatch_user(maker, uid, outbox_adapters, clock.now)
    assert form.calls == 1 and (await apps(ada))[0]["status"] == "submitted"


async def test_a_paused_search_sends_nothing(ada, discovery_source, form, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)
    await ada.post("/api/autoapply/campaign/pause")
    await tick()
    assert form.calls == 0 and (await apps(ada))[0]["status"] == "queued"


async def test_disconnecting_the_mailbox_before_the_final_check_stops_the_email(
    ada, discovery_source, mailbox, maker, outbox_adapters, clock, settings, form
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await run(ada)
    uid = await user_id(maker)
    claim = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    assert claim is not None and claim.channel == "email"
    await ada.post("/api/autoapply/mailbox/disconnect")
    assert await outbox.execute(maker, claim, outbox_adapters, clock.now) == "cancelled"
    assert mailbox.sent == []


async def test_changing_the_search_after_queueing_stops_a_send_that_has_not_started(
    ada, discovery_source, form, tick
):
    # the listing says it is for Nigeria, so a search for Kenya no longer fits it
    discovery_source.postings = [job(1, description="Lead payments product. Remote. Nigeria only.")]
    await start(ada)
    await run(ada)
    assert (await apps(ada))[0]["status"] == "queued"
    changed = {**PROFILE["criteria"], "locations": [{"value": "Kenya", "required": True}]}
    await ada.put("/api/autoapply/profile", json={"criteria": changed})
    await tick()
    assert form.calls == 0 and (await apps(ada))[0]["status"] == "skipped"


async def test_nothing_is_sent_outside_the_candidates_active_hours(
    ada, discovery_source, form, tick, clock
):
    # the candidate works 09:00-18:00 Lagos time; the clock says 02:00 there
    await ada.put(
        "/api/autoapply/profile", json={**PROFILE, "active_hours": {"start": 9, "end": 18}}
    )
    discovery_source.postings = [job(1)]
    await start(ada)
    clock.now = clock.now.replace(hour=1)
    await tick()
    assert form.calls == 0
    clock.now = clock.now.replace(hour=10)
    await tick()
    assert form.calls == 1


# -------------------------------------------------------------------- unknown outcomes


async def test_a_timeout_after_dispatch_is_unknown_and_never_sends_a_second_application(
    ada, discovery_source, form, tick, maker, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    form.mode = "timeout_after"  # the employer recorded it, but we never heard back
    await tick()
    a = (await apps(ada))[0]
    assert a["status"] == "confirmation_pending"
    form.mode = "ok"
    await tick()
    assert form.calls == 1 and (await apps(ada))[0]["status"] == "confirmation_pending"
    clock.now += timedelta(minutes=5)
    await tick()
    await tick()
    assert form.calls == 1  # no second submission
    # the receipt shows up on reconciliation and links to the original attempt
    assert (await apps(ada))[0]["status"] == "submitted"
    rows = await attempts(maker)
    assert len(rows) == 1 and rows[0].state == "confirmed" and rows[0].provider_ref == "FX-0001"


async def test_an_uncertain_form_submission_never_falls_through_to_email(
    ada, discovery_source, form, mailbox, tick
):
    both = job(
        1, apply_email="jobs1@acme.test", evidence={"apply_email": "how to apply", "region": "x"}
    )
    discovery_source.postings = [both]
    await start(ada)
    await connect_mailbox(ada)
    form.mode = "timeout_before"
    await tick()
    await tick()
    assert (await apps(ada))[0]["status"] == "confirmation_pending"
    assert mailbox.sent == [] and form.calls == 1


async def test_with_no_evidence_the_candidate_is_asked_and_can_allow_a_retry(
    ada, discovery_source, form, tick, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    form.mode = "timeout_before"  # the employer never saw it
    await tick()
    form.mode = "ok"
    clock.now += timedelta(hours=25)
    await tick()
    a = (await apps(ada))[0]
    assert a["needs_input"][0]["kind"] == "confirm" and form.calls == 1
    r = await ada.post(f"/api/autoapply/applications/{a['id']}/resolve", json={"sent": False})
    assert r.json()["status"] == "queued"
    await tick()
    assert form.calls == 2 and (await apps(ada))[0]["status"] == "submitted"


async def test_the_candidate_can_confirm_that_it_did_go_through(
    ada, discovery_source, form, tick, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    form.mode = "timeout_before"
    await tick()
    clock.now += timedelta(hours=25)
    await tick()
    a = (await apps(ada))[0]
    r = await ada.post(f"/api/autoapply/applications/{a['id']}/resolve", json={"sent": True})
    assert r.json()["status"] == "submitted"
    form.mode = "ok"
    await tick()
    assert form.calls == 1


async def test_an_email_whose_outcome_is_unknown_is_found_in_sent_mail_not_resent(
    ada, discovery_source, mailbox, tick, clock
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    mailbox.mode = "timeout_after"  # Gmail took it, then the connection dropped
    await tick()
    assert (await apps(ada))[0]["status"] == "confirmation_pending"
    mailbox.mode = "ok"
    clock.now += timedelta(minutes=5)
    await tick()
    assert (await apps(ada))[0]["status"] == "sent_email" and len(mailbox.sent) == 1


async def test_a_worker_that_died_before_sending_gives_the_work_back(
    ada, discovery_source, form, maker, outbox_adapters, tick, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)
    uid = await user_id(maker)
    claim = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    assert claim is not None  # ... and the worker disappears here
    assert (await apps(ada))[0]["status"] == "sending"
    clock.now += timedelta(minutes=30)
    await tick()
    assert form.calls == 1 and (await apps(ada))[0]["status"] == "submitted"


async def test_a_worker_that_died_after_marking_dispatch_leaves_an_unknown_outcome(
    ada, discovery_source, form, maker, outbox_adapters, tick, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)
    uid = await user_id(maker)
    claim = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    async with maker() as db:
        a = await db.get(SubmissionAttempt, claim.attempt_id)
        a.state, a.dispatched_at = "dispatched", clock.now  # marked, then the process died
        await db.commit()
    clock.now += timedelta(minutes=5)
    await tick()
    assert (await apps(ada))[0]["status"] == "confirmation_pending" and form.calls == 0
    clock.now += timedelta(hours=25)
    await tick()
    assert (await apps(ada))[0]["needs_input"][0]["kind"] == "confirm"  # asked, never resent


# ----------------------------------------------------------------------------- failures


async def test_a_busy_form_is_retried_later_with_a_growing_wait_then_given_up(
    ada, discovery_source, form, tick, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)

    async def busy(url):
        raise AdapterError("network", "The employer's site is unreachable.", transient=True)

    form.read_form = busy
    await tick()
    assert form.calls == 0 and (await apps(ada))[0]["status"] == "queued"
    await tick()  # too soon: it is waiting out its back-off
    assert len(await _all_attempts(ada)) == 1
    for _ in range(8):
        clock.now += timedelta(hours=2)
        await tick()
    assert (await apps(ada))[0]["status"] == "failed" and form.calls == 0


async def _all_attempts(c):
    a = (await apps(c))[0]
    return (await c.get(f"/api/autoapply/applications/{a['id']}")).json()["attempts"]


async def test_a_refused_application_fails_clearly_and_frees_its_place_in_the_limit(
    ada, discovery_source, form, tick
):
    discovery_source.postings = [job(1), job(2)]
    await start(ada, daily_application_cap=1)
    real_submit, seen = form.submit, []

    async def refuse_the_first(*a, **k):
        seen.append(1)
        if len(seen) == 1:
            raise AdapterError("rejected", "The form refused the application.")
        return await real_submit(*a, **k)

    form.submit = refuse_the_first
    await tick()
    assert sorted(await states(ada)) == ["failed", "submitted"]  # the failure did not use the day


async def test_a_form_that_now_asks_something_new_waits_for_the_candidate(
    ada, discovery_source, form, tick
):
    from app.autoapply.adapters import FormField, FormSchema

    discovery_source.postings = [job(1)]
    await start(ada)
    form.schemas["https://jobs.fixture.test/acme/1"] = FormSchema(
        [
            FormField("name", "Full name"),
            FormField("visa", "Do you need a visa?"),
            FormField("resume", "CV", kind="file"),
        ],
        "v2",
    )
    await tick()
    a = (await apps(ada))[0]
    assert a["status"] == "needs_input" and form.calls == 0
    assert (
        a["needs_input"][0]["field"] == "visa"
        and a["needs_input"][0]["question"] == "Do you need a visa?"
    )


async def test_a_captcha_goes_to_the_candidate_and_nothing_is_sent(
    ada, discovery_source, form, tick
):
    discovery_source.postings = [job(1)]
    await start(ada)
    form.mode = "captcha"
    await tick()
    a = (await apps(ada))[0]
    # nothing the person can answer in the app: it is handed to them, prepared, to submit themselves
    assert a["status"] == "apply_yourself" and a["channel"] == "manual"
    assert form.calls == 0


async def test_a_mailbox_that_needs_reconnecting_pauses_email_and_says_so(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    mailbox.mode = "reauth"
    await tick()
    assert (await apps(ada))[0]["status"] == "queued" and mailbox.sent == []
    box = (await ada.get("/api/autoapply/mailbox")).json()
    assert box["connected"] is False and box["status"] == "reauth_needed"
    mailbox.mode = "ok"
    await tick()
    assert mailbox.sent == []  # nothing goes out until the person reconnects
    await ada.post("/api/autoapply/mailbox/connect")
    await ada.put("/api/autoapply/profile", json={"channels": {"form": True, "email": True}})
    await tick()
    assert len(mailbox.sent) == 1


# -------------------------------------------------------------------- the campaign end


async def test_day_30_can_still_send_and_day_31_cannot(ada, discovery_source, form, tick, clock):
    discovery_source.postings = [job(1), job(2)]
    await start(ada, daily_application_cap=1)
    await run(ada)
    start_day = clock.now
    clock.now = start_day + timedelta(days=29, hours=13)  # 22:00 Lagos on day 30
    await tick()
    assert form.calls == 1
    clock.now = start_day + timedelta(days=29, hours=15)  # 00:00 on day 31: the campaign is over
    await tick()
    assert form.calls == 1
    states_now = await states(ada)
    assert states_now.count("skipped") == 1 and "queued" not in states_now
    skipped = (await apps(ada, "skipped"))[0]
    assert skipped["skip_reason"] == "The 30-day search ended before this went out."


# -------------------------------------------------------------------- real-world safety


def test_real_submissions_need_their_switch_and_production_or_an_allowed_recipient(settings):
    settings.autoapply_form_dispatch = False
    assert outbox.dispatch_allowed(settings, "form", real=True, recipient=None) is False
    settings.autoapply_form_dispatch = True
    settings.environment = "staging"
    assert outbox.dispatch_allowed(settings, "form", real=True, recipient=None) is False
    settings.environment = "production"
    assert outbox.dispatch_allowed(settings, "form", real=True, recipient=None) is True
    assert outbox.dispatch_allowed(settings, "form", real=False, recipient=None) is True  # fixture


def test_a_real_mailbox_in_staging_only_reaches_allowlisted_recipients(settings):
    settings.environment = "staging"
    settings.autoapply_email_dispatch = True
    settings.autoapply_allowed_recipients = "me@test.example"
    assert outbox.dispatch_allowed(settings, "email", True, "employer@acme.com") is False
    assert outbox.dispatch_allowed(settings, "email", True, "ME@test.example") is True
    settings.autoapply_email_dispatch = False
    assert outbox.dispatch_allowed(settings, "email", True, "me@test.example") is False


async def test_a_listing_that_expires_before_it_is_sent_becomes_expired(
    ada, discovery_source, form, tick, maker
):
    from datetime import UTC, datetime

    from app.models import JobPosting

    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)  # prepared and waiting to go out
    async with maker() as db:
        for p in (await db.execute(select(JobPosting))).scalars():
            p.expires_at = datetime(2020, 1, 1, tzinfo=UTC)  # the end date passes meanwhile
        await db.commit()
    discovery_source.postings = []  # the next search brings nothing new; the stored listing is what counts
    await tick()
    a = (await apps(ada))[0]
    assert a["status"] == "expired" and "expired" in a["skip_reason"]
    assert form.calls == 0  # nothing reached the employer


async def test_a_listing_cannot_change_who_an_email_goes_to(
    ada, discovery_source, mailbox, tick, maker
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await run(ada)
    async with maker() as db:
        app = (await db.execute(select(Application))).scalar_one()
        app.package = {
            **app.package,
            "destination": {**app.package["destination"], "to": "attacker@evil.test"},
        }
        await db.commit()
    await tick()
    assert mailbox.sent == []  # the package no longer matches the listing, so it is not sent


# ---------------------------------------------------------------------------- the mailbox


async def test_the_mailbox_token_is_stored_encrypted_and_deleted_on_disconnect(
    ada, mailbox, maker, settings
):
    await connect_mailbox(ada)
    async with maker() as db:
        conn = (await db.execute(select(MailboxConnection))).scalar_one()
        assert conn.token_encrypted and "fixture" not in conn.token_encrypted
        from app.autoapply import crypto

        assert crypto.decrypt(settings, conn.token_encrypted) == "fixture"
    box = (await ada.get("/api/autoapply/mailbox")).json()
    assert box["connected"] is True and box["address"] == "ada@example.com"
    off = (await ada.post("/api/autoapply/mailbox/disconnect")).json()
    assert off["connected"] is False and mailbox.revoked == 1
    async with maker() as db:
        conn = (await db.execute(select(MailboxConnection))).scalar_one()
        assert conn.token_encrypted is None and conn.status == "disconnected"
    prof = (await ada.get("/api/autoapply/profile")).json()
    assert prof["channels"] == {"form": True, "email": False, "outreach": False}  # form stays on


async def test_disconnecting_gives_up_email_only_work_but_keeps_form_work(
    ada, discovery_source, form, mailbox, tick
):
    discovery_source.postings = [email_job(1), job(2)]
    await start(ada)
    await connect_mailbox(ada)
    await run(ada)
    await ada.post("/api/autoapply/mailbox/disconnect")
    await tick()
    by = {a["posting"]["application_url"] is None: a["status"] for a in await apps(ada)}
    assert by[True] == "skipped" and by[False] == "submitted" and mailbox.sent == []


async def test_one_candidates_mailbox_is_invisible_to_another(ada, new_client, sign_in):
    await connect_mailbox(ada)
    async with new_client() as eve:
        await sign_in(eve, "eve@example.com")
        assert (await eve.get("/api/autoapply/mailbox")).json()["connected"] is False
        assert (await eve.get("/api/autoapply/outreach")).json() == []


# ---------------------------------------------------------------------------- outreach


CONTACT = dict(
    hiring_contact="recruiter@acme.test",
    evidence={"hiring_contact": "named on the listing", "region": "x"},
)


async def test_outreach_is_off_unless_the_candidate_opts_in(ada, discovery_source, mailbox, tick):
    discovery_source.postings = [job(1, **CONTACT)]
    await start(ada)
    await connect_mailbox(ada, email=False, outreach=False)
    await tick()
    assert mailbox.sent == [] and (await ada.get("/api/autoapply/outreach")).json() == []


async def test_a_note_to_the_listed_contact_goes_once_after_the_application(
    ada, discovery_source, mailbox, form, tick
):
    discovery_source.postings = [job(1, **CONTACT)]
    await start(ada)
    await connect_mailbox(ada, email=False, outreach=True)
    await tick()
    await tick()
    assert form.calls == 1 and len(mailbox.sent) == 1
    m = mailbox.sent[0]
    assert m["to"] == "recruiter@acme.test" and m["attachments"] == []
    assert "Senior Product Manager" in m["subject"] and "Ada Okoye" in m["body"]
    o = (await ada.get("/api/autoapply/outreach")).json()
    assert len(o) == 1 and o[0]["status"] == "sent" and o[0]["recipient_source"] == "listing"
    assert o[0]["body"] == m["body"]  # the message is visible in history exactly as sent
    a = (await apps(ada))[0]
    d = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    assert d["outreach"]["status"] == "sent"
    assert [t["channel"] for t in d["attempts"]] == ["form", "outreach"]
    assert d["status"] == "submitted"  # outreach never changes the application's status


async def test_outreach_has_its_own_daily_limit(ada, discovery_source, mailbox, tick, clock):
    discovery_source.postings = [
        job(
            i,
            hiring_contact=f"r{i}@acme.test",
            evidence={"hiring_contact": "listing", "region": "x"},
        )
        for i in range(1, 4)
    ]
    await start(ada, daily_outreach_cap=1)
    await connect_mailbox(ada, email=False, outreach=True)
    await tick()
    await tick()
    assert len(mailbox.sent) == 1  # applications are not limited by this; notes are
    clock.now += timedelta(days=1)
    await tick()
    await tick()
    assert len(mailbox.sent) == 2


async def test_no_note_goes_to_an_address_the_application_already_went_to(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [
        email_job(
            1,
            hiring_contact="jobs1@acme.test",
            evidence={"apply_email": "how to apply", "hiring_contact": "x", "region": "y"},
        )
    ]
    await start(ada)
    await connect_mailbox(ada, email=True, outreach=True)
    await tick()
    await tick()
    assert len(mailbox.sent) == 1 and mailbox.sent[0]["attachments"]  # only the application
    o = (await ada.get("/api/autoapply/outreach")).json()
    assert o[0]["status"] == "skipped" and "already goes to this address" in o[0]["reason"]


async def test_the_candidate_can_name_a_contact_but_only_one_note_per_role(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await connect_mailbox(ada, email=False, outreach=True)
    await tick()
    a = (await apps(ada))[0]
    r = await ada.post(
        f"/api/autoapply/applications/{a['id']}/outreach", json={"recipient": "Hana@Acme.test"}
    )
    assert r.status_code == 201 and r.json()["recipient"] == "hana@acme.test"
    assert r.json()["recipient_source"] == "candidate"
    again = await ada.post(
        f"/api/autoapply/applications/{a['id']}/outreach", json={"recipient": "other@acme.test"}
    )
    assert again.json()["recipient"] == "hana@acme.test"  # still the one note
    await tick()
    assert [m["to"] for m in mailbox.sent] == ["hana@acme.test"]
    bad = await ada.post(
        f"/api/autoapply/applications/{a['id']}/outreach", json={"recipient": "not an email"}
    )
    assert bad.json()["status"] in (
        "sent",
        "skipped",
    )  # an existing note is returned, not re-created


async def test_a_note_cannot_be_requested_with_outreach_off(ada, discovery_source, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await tick()
    a = (await apps(ada))[0]
    r = await ada.post(
        f"/api/autoapply/applications/{a['id']}/outreach", json={"recipient": "x@acme.test"}
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "outreach_off"


async def test_an_unknown_outreach_send_is_never_repeated(
    ada, discovery_source, mailbox, tick, clock
):
    discovery_source.postings = [job(1, **CONTACT)]
    await start(ada)
    await connect_mailbox(ada, email=False, outreach=True)
    mailbox.mode = "timeout_after"
    await tick()
    await tick()
    mailbox.mode = "ok"
    clock.now += timedelta(minutes=5)
    await tick()
    await tick()
    assert len(mailbox.sent) == 1
    assert (await ada.get("/api/autoapply/outreach")).json()[0]["status"] == "sent"  # found later


async def test_outreach_to_the_applications_own_contact_respects_the_end_of_the_campaign(
    ada, discovery_source, mailbox, tick, clock
):
    discovery_source.postings = [job(1, **CONTACT)]
    await start(ada)
    await connect_mailbox(ada, email=False, outreach=True)
    await run(ada)
    clock.now += timedelta(days=31)
    await tick()
    assert mailbox.sent == []


# ------------------------------------------------------------------------- small pieces


def test_the_cv_file_carries_its_text_and_runs_to_more_pages():
    from pypdf import PdfReader

    text = "Ada Okoye\nSenior (PM) at A\\B\n\nSUMMARY\n" + "A line of the summary.\n" * 200
    pdf = cvfile.render_pdf(text)
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
    got = cvfile.pdf_text(pdf).splitlines()
    assert got[0] == "ADA OKOYE" and "Senior (PM) at A\\B" in got[1]
    assert len(PdfReader(io.BytesIO(pdf)).pages) >= 3  # long text runs to more pages


def test_stored_secrets_need_the_right_key(settings):
    from pydantic import SecretStr

    from app.autoapply import crypto

    token = crypto.encrypt(settings, "refresh-token")
    assert "refresh-token" not in token and crypto.decrypt(settings, token) == "refresh-token"
    settings.cookie_secret = SecretStr("another-secret")
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt(settings, token)
    settings.environment = "production"
    with pytest.raises(crypto.CryptoError):
        crypto.encrypt(settings, "x")  # production refuses to guess a key


async def test_a_form_that_cannot_be_filled_is_handed_to_the_person_not_failed(
    ada, maker, form, mailbox, discovery_source, outbox_adapters, clock
):
    """No form on the page, a sign-in wall or a human check: nothing is sent and nothing failed. The
    prepared CV and note go to the person to submit on the employer's own site."""
    from app.autoapply import outbox
    from app.autoapply.adapters import AdapterError
    from tests.autoapply.conftest import apps, job, start

    discovery_source.postings = [job(1)]
    await start(ada)
    await ada.post("/api/autoapply/discovery/run")
    (a,) = await apps(ada)
    assert a["status"] == "queued" and a["channel"] == "form"

    async def no_form(url):
        raise AdapterError("rejected", "The form asks for a human check (CAPTCHA).")

    form.read_form = no_form  # type: ignore[method-assign]
    uid = await user_id(maker)
    claim = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    assert claim is not None
    assert await outbox.execute(maker, claim, outbox_adapters, clock.now) == "cancelled"
    (after,) = await apps(ada)
    assert after["status"] == "apply_yourself" and after["channel"] == "manual"
    detail = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    assert [t["state"] for t in detail["attempts"]] == ["cancelled"]
    assert detail["attempts"][0]["failure_message"].startswith("The form asks for a human check")
    handed = [h for h in detail["history"] if h["kind"] == "handed_over"]
    assert handed and "CAPTCHA" in handed[0]["detail"]["reason"]
    assert detail["package"]["cv"]["submitted_text"]  # already prepared: ready for the person
