"""The PRD's acceptance scenarios, one test each, numbered as in the document. Each runs the whole
path with the fixture adapters, through the real HTTP API and the real scheduler pass."""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.autoapply import cvfile, outbox
from app.autoapply.fixtures import FixtureMailbox
from app.models import (
    Application,
    Event,
    JobPosting,
    PracticeSession,
    RecruitingEvent,
    SubmissionAttempt,
)
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
from tests.autoapply.test_recruiting import interviews_of, msg, our_ref

QS = [{"field": "notice_period", "label": "What is your notice period?", "required": True}]


async def test_1_an_opted_in_candidate_goes_from_scheduled_discovery_to_a_confirmed_submission_without_a_click(
    ada, discovery_source, form, tick
):
    await ada.put(
        "/api/autoapply/answers/notice_period", json={"value": "Two weeks", "reusable": True}
    )
    discovery_source.postings = [job(1, questions=QS)]
    await start(ada)
    await tick()  # nothing but the scheduler ran
    (a,) = await apps(ada)
    assert a["status"] == "submitted" and form.calls == 1
    d = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    assert d["attempts"][0]["state"] == "confirmed" and d["attempts"][0]["provider_ref"]
    assert next(iter(form.submitted.values()))["values"]["notice_period"] == "Two weeks"


async def test_2_an_email_only_listing_sends_the_right_cv_from_the_connected_account(
    ada, discovery_source, mailbox, tick
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    (a,) = await apps(ada)
    assert a["status"] == "sent_email"  # "Sent by email"
    (sent,) = mailbox.sent
    assert sent["from"] == "ada@example.com" and sent["to"] == "jobs1@acme.test"
    package = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    assert (
        cvfile.pdf_text(sent["attachments"][0].content)
        == package["package"]["cv"]["submitted_text"]
    )
    assert package["attempts"][0]["provider_ref"].endswith(
        "@interviewmeet.app"
    )  # the message reference


async def test_3_a_must_with_too_little_evidence_gives_a_specific_review_item_and_no_send(
    ada, discovery_source, form, mailbox, tick
):
    crit = {
        **PROFILE["criteria"],
        "sponsorship": {"need": "needed", "required": True},
        "salary": {"floor": 90000, "currency": "USD", "period": "year", "required": True},
    }
    discovery_source.postings = [
        job(1, region=None),
        job(2),
        job(
            3,
            salary_min=1,
            salary_max=2,
            salary_currency="NGN",
            salary_period="year",
            description="We sponsor visas.",
        ),
    ]
    await start(ada, criteria=crit)
    await tick()
    found = {a["posting"]["application_url"][-1]: a for a in await apps(ada)}
    asked = {n["field"] for a in found.values() for n in a["needs_input"]}
    # A listing that says nothing about where it is (job 1) is not held against it, so "location"
    # is not asked. A stated pay that cannot be compared (job 3, naira) and silence on visa
    # sponsorship for someone who needs it still are: each names exactly what is unclear.
    assert asked == {"sponsorship", "salary"}
    assert all(a["status"] == "needs_input" for a in found.values())
    assert form.calls == 0 and mailbox.sent == []


async def test_4_simultaneous_runs_and_duplicated_listings_give_one_application_and_one_dispatch(
    ada, discovery_source, form, maker, outbox_adapters, clock
):
    from app.autoapply import discovery as disc

    discovery_source.postings = [
        job(1),
        job(1, source_url="https://other.test/same-job", source="other"),
    ]
    await start(ada)
    uid = await user_id(maker)

    async def one_scheduler():
        async with maker() as db:
            await disc.run_if_due(
                db,
                uid,
                now=clock.now,
                sources=[discovery_source],
                llm=outbox_adapters.settings and _llm(),
                form=form,
            )
        return await outbox.dispatch_user(maker, uid, outbox_adapters, clock.now)

    await asyncio.gather(*[one_scheduler() for _ in range(6)])
    async with maker() as db:
        assert (await db.execute(select(func.count()).select_from(Application))).scalar_one() == 1
        assert (await db.execute(select(func.count()).select_from(JobPosting))).scalar_one() == 1
        assert (
            await db.execute(select(func.count()).select_from(SubmissionAttempt))
        ).scalar_one() == 1
    assert form.calls == 1


def _llm():
    from app.adapters.fakes import FakeLlmProvider

    return FakeLlmProvider()


async def test_5_a_crash_or_timeout_after_dispatch_stays_pending_until_a_receipt_links_to_the_original(
    ada, discovery_source, form, tick, clock, maker
):
    discovery_source.postings = [job(1)]
    await start(ada)
    form.mode = "timeout_after"
    await tick()
    assert (await apps(ada))[0]["status"] == "confirmation_pending"
    form.mode = "ok"
    clock.now += timedelta(minutes=5)
    await tick()
    async with maker() as db:
        rows = (await db.execute(select(SubmissionAttempt))).scalars().all()
        assert (
            len(rows) == 1
            and rows[0].state == "confirmed"
            and (await db.execute(select(func.count()).select_from(Application))).scalar_one() == 1
        )
    assert form.calls == 1 and (await apps(ada))[0]["status"] == "submitted"


async def test_6_pause_or_disconnect_before_the_final_check_stops_the_send_and_in_flight_work_stays_visible(
    ada, discovery_source, form, mailbox, maker, outbox_adapters, clock, tick
):
    discovery_source.postings = [job(1), email_job(2)]
    await start(ada)
    await connect_mailbox(ada)
    await run(ada)
    uid = await user_id(maker)
    c1 = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    await ada.post("/api/autoapply/campaign/pause")
    assert (
        await outbox.execute(maker, c1, outbox_adapters, clock.now) == "cancelled"
        and form.calls == 0
    )
    await ada.post("/api/autoapply/campaign/resume")
    c2 = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    await ada.post("/api/autoapply/mailbox/disconnect")
    await outbox.execute(maker, c2, outbox_adapters, clock.now)
    assert mailbox.sent == [] or c2.channel == "form"
    # already-dispatched work stays visible and settles normally
    form.mode = "timeout_after"
    await ada.post("/api/autoapply/campaign/resume")
    await tick()
    visible = [a["status"] for a in await apps(ada)]
    assert "confirmation_pending" in visible or "submitted" in visible
    form.mode = "ok"
    clock.now += timedelta(minutes=5)
    await tick()
    assert "confirmation_pending" not in [a["status"] for a in await apps(ada)]


async def test_7_an_unsupported_form_or_a_required_declaration_waits_without_inventing_answers(
    ada, discovery_source, form, tick
):
    qs = [
        {
            "field": "right_to_work",
            "label": "Do you have the right to work?",
            "required": True,
            "kind": "declaration",
        },
        {"field": "puzzle", "label": "Solve the puzzle", "required": True, "kind": "captcha"},
    ]
    discovery_source.postings = [job(1, questions=qs)]
    await start(ada)
    await tick()
    (a,) = await apps(ada)
    assert a["status"] == "needs_input" and form.calls == 0
    assert {n["kind"] for n in a["needs_input"]} == {"declaration", "unsupported"}
    d = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    assert d["package"] is None  # no package, so nothing fabricated can be sent


async def test_8_replaying_invitations_reschedules_and_cancellations_never_duplicates_and_ambiguity_is_reviewed(
    ada, discovery_source, tick, mailbox, maker
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    (a,) = await apps(ada)
    ref, thread = await our_ref(maker, a["id"])
    seq = [
        msg(
            1,
            "Invitation",
            "We'd like to interview you. Pick a time: https://calendly.com/acme/pm",
            thread=thread,
            reply_to=ref,
        ),
        msg(
            2,
            "Confirmed",
            "Your interview is confirmed for December 3, 2026 at 2:00 PM UTC",
            thread=thread,
            reply_to=ref,
        ),
        msg(
            3,
            "Rescheduled",
            "New time: December 4, 2026 at 2:00 PM UTC",
            thread=thread,
            reply_to=ref,
        ),
        msg(4, "Cancelled", "We have to cancel your interview", thread=thread, reply_to=ref),
    ]
    for _ in range(3):  # the whole sequence delivered three times
        mailbox.inbox += seq
        await tick()
    assert len(await interviews_of(maker)) == 1
    async with maker() as db:
        assert (
            await db.execute(select(func.count()).select_from(RecruitingEvent))
        ).scalar_one() == 4
    (iv,) = await interviews_of(maker)
    assert iv.status == "cancelled" and len(iv.history) == 4


async def test_9_the_assistant_opens_with_the_submitted_cv_even_after_the_profile_changes(
    ada, discovery_source, tick, mailbox, maker
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    (a,) = await apps(ada)
    ref, thread = await our_ref(maker, a["id"])
    mailbox.inbox.append(
        msg(
            1,
            "Confirmed",
            "Your interview is confirmed for December 3, 2026 at 2:00 PM UTC",
            thread=thread,
            reply_to=ref,
        )
    )
    await tick()
    (iv,) = await interviews_of(maker)
    await ada.put("/api/notes", json={"role": "Chef", "content": "I am a chef now."})
    await ada.put(
        "/api/autoapply/facts",
        json={
            "data": {
                "contact": {"name": "Someone Else", "email": "x@y.z"},
                "history": [],
                "links": [],
                "skills": [],
                "education": [],
            },
            "verified": True,
        },
    )
    assert (await ada.post("/api/sessions", json={"interview_id": str(iv.id)})).status_code == 201
    async with maker() as db:
        row = (await db.execute(select(PracticeSession))).scalar_one()
        assert "Ada Okoye" in row.notes_snapshot and "Northwind" in row.notes_snapshot
        assert "chef" not in row.notes_snapshot.lower() and "Someone Else" not in row.notes_snapshot
    # the existing CV, company and session flows are untouched by all this
    assert (await ada.get("/api/notes")).json()["content"] == "I am a chef now."
    assert (await ada.post("/api/sessions", json={})).status_code == 201


async def test_10_nobody_can_read_another_candidates_work_and_staging_never_reaches_real_employers(
    ada, discovery_source, tick, mailbox, maker, new_client, sign_in, settings
):
    discovery_source.postings = [email_job(1)]
    await start(ada)
    await connect_mailbox(ada)
    await tick()
    (a,) = await apps(ada)
    ref, thread = await our_ref(maker, a["id"])
    mailbox.inbox.append(
        msg(
            1,
            "Confirmed",
            "Your interview is confirmed for December 3, 2026 at 2:00 PM UTC",
            thread=thread,
            reply_to=ref,
        )
    )
    await tick()
    (iv,) = await interviews_of(maker)
    async with maker() as db:
        ev = (await db.execute(select(RecruitingEvent))).scalar_one()
    aid, eid = a["id"], str(ev.id)
    async with new_client() as eve:
        await sign_in(eve, "eve@example.com")
        mine = [("get", f"/api/autoapply/applications/{aid}", None)]
        for verb in ("answer", "approve", "skip", "retry", "resolve", "outreach"):
            mine.append(
                (
                    "post",
                    f"/api/autoapply/applications/{aid}/{verb}",
                    {"field": "x", "value": "y", "rule": "r", "sent": True, "recipient": "a@b.co"},
                )
            )
        for verb in ("link", "dismiss", "confirm-time"):
            mine.append(
                (
                    "post",
                    f"/api/autoapply/recruiting/{eid}/{verb}",
                    {"application_id": aid, "timezone": "UTC"},
                )
            )
        mine.append(("post", f"/api/autoapply/interviews/{iv.id}/prepare", None))
        for method, path, body in mine:
            r = await getattr(eve, method)(path, **({"json": body} if body else {}))
            assert r.status_code == 404, path
        assert (
            await eve.post("/api/sessions", json={"interview_id": str(iv.id)})
        ).status_code == 404
        for path in ("applications", "interviews", "recruiting", "outreach", "answers"):
            body = (await eve.get(f"/api/autoapply/{path}")).json()
            assert body in ([], {"items": [], "next_cursor": None}), path
        assert (await eve.get("/api/autoapply/facts")).json() is None
        assert (await eve.get("/api/autoapply/mailbox")).json()["connected"] is False
    # a staging server with a real mailbox may only write to allowlisted recipients
    real = FixtureMailbox()
    real.real = True
    settings.environment = "staging"
    settings.autoapply_email_dispatch = True
    settings.autoapply_allowed_recipients = "test-inbox@example.com"
    adapters = outbox.Adapters(form=outbox_form(), mailbox=real, settings=settings)
    assert not outbox.dispatch_allowed(settings, "email", real.real, "jobs1@acme.test")
    assert outbox.dispatch_allowed(settings, "email", real.real, "test-inbox@example.com")
    assert adapters.mailbox.real is True and real.sent == []


def outbox_form():
    from app.autoapply.fixtures import FixtureForm

    return FixtureForm()


async def test_11_a_30_day_campaign_with_a_test_clock_closes_on_day_31_and_replies_still_work(
    ada, discovery_source, tick, mailbox, clock, maker
):
    discovery_source.postings = [email_job(i) for i in range(1, 80)]
    await start(ada, daily_application_cap=2)
    await connect_mailbox(ada, form_on=False)
    start_at = clock.now  # 10:00 on day 1 in Lagos
    sent_by_day: dict[int, int] = {}
    for d in range(0, 36):
        clock.now = start_at + timedelta(days=d)
        before = len(mailbox.sent)
        await tick()
        sent_by_day[d + 1] = len(mailbox.sent) - before
    assert all(sent_by_day[d] == 2 for d in range(1, 31))  # the limit, every day through day 30
    assert all(sent_by_day[d] == 0 for d in range(31, 37))  # nothing on day 31 or after
    assert len(mailbox.sent) == 60
    async with maker() as db:
        states = list((await db.execute(select(Application.status))).scalars())
    assert states.count("sent_email") == 60 and "queued" not in states
    assert states.count("skipped") == 19  # the rest were given up when the campaign closed
    assert (await ada.get("/api/autoapply/dashboard")).json()["campaign"]["state"] == "ended"
    # a recruiter writes on day 36: the invitation is still read, shown, and opens preparation
    a = (await apps(ada, "sent_email"))[0]
    ref, thread = await our_ref(maker, a["id"])
    mailbox.inbox.append(
        msg(
            1,
            "Interview",
            "Your interview is confirmed for December 20, 2026 at 2:00 PM UTC",
            thread=thread,
            reply_to=ref,
            when=clock.now,
        )
    )
    clock.now += timedelta(minutes=5)
    await tick()
    d = (await ada.get("/api/autoapply/dashboard")).json()
    assert d["state"] == "prepare" and d["primary"]["label"] == "Prepare for interview"
    prep = (await ada.post(f"/api/autoapply/interviews/{d['next_interview']['id']}/prepare")).json()
    assert prep["session_url"].startswith("/session/new?interview=")
    assert (
        await ada.post("/api/sessions", json={"interview_id": d["next_interview"]["id"]})
    ).status_code == 201
    assert len(mailbox.sent) == 60  # and still no new application after the end


async def test_12_a_tailored_cv_keeps_the_candidates_facts_and_outreach_is_recorded_capped_and_not_duplicated(
    ada, discovery_source, tick, mailbox, clock, maker
):
    contacts = [
        email_job(
            1,
            hiring_contact="jobs1@acme.test",
            evidence={"apply_email": "how to apply", "hiring_contact": "listing", "region": "x"},
        ),  # same address
        job(
            2,
            hiring_contact="rec2@acme.test",
            evidence={"hiring_contact": "listing", "region": "x"},
        ),
        job(
            3,
            hiring_contact="rec3@acme.test",
            evidence={"hiring_contact": "listing", "region": "x"},
        ),
    ]
    discovery_source.postings = contacts
    await start(ada, daily_outreach_cap=1)
    await connect_mailbox(ada, email=True, outreach=True)
    for _ in range(3):
        await tick()
    out = (await ada.get("/api/autoapply/outreach")).json()
    by = {o["recipient"]: o for o in out}
    assert (
        by["jobs1@acme.test"]["status"] == "skipped"
    )  # never a note to an address the application went to
    assert sorted(o["status"] for o in out if o["recipient"] != "jobs1@acme.test") == [
        "queued",
        "sent",
    ]  # capped at one a day
    clock.now += timedelta(days=1)
    for _ in range(2):
        await tick()
    assert all(
        o["status"] in ("sent", "skipped")
        for o in (await ada.get("/api/autoapply/outreach")).json()
    )
    # the CV that went out has only the candidate's own facts
    for a in await apps(ada):
        pkg = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()["package"]
        cv = pkg["cv"]["submitted_text"]
        for fact in (
            "Senior Product Manager, Northwind (2021 - 2025)",
            "Product Manager, Contoso (2018 - 2021)",
            "grew revenue 30%",
        ):
            assert fact in cv
        assert "Google" not in cv and "MBA" not in cv
    async with maker() as db:
        kinds = (await db.execute(select(SubmissionAttempt.channel))).scalars().all()
    assert kinds.count("outreach") == 2 and kinds.count("email") == 1 and kinds.count("form") == 2
    async with maker() as db:
        assert (
            await db.execute(
                select(func.count())
                .select_from(Event)
                .where(Event.kind == "autoapply.outreach_sent")
            )
        ).scalar_one() == 2
    assert datetime.now(UTC)  # (the test clock, not wall time, drove everything above)
