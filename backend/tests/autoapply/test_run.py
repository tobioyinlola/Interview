"""The application run: its trail of events, the controls that act on it, who carries each
application out (this server or the candidate's desktop) and the rule that it is never both."""

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.autoapply import outbox, runlog
from app.autoapply.adapters import AdapterError
from app.models import RunState, SubmissionAttempt
from tests.autoapply.conftest import apps, job, run, start, user_id

DESK = "desk-0001-aaaa"
OTHER = "desk-0002-bbbb"
API = "/api/autoapply"


@pytest.fixture
def live_forms(settings):
    """The desktop really submits, so the operator's switch for real forms has to be on."""
    settings.environment, settings.autoapply_form_dispatch = "production", True


async def view(ada) -> dict:
    r = await ada.get(f"{API}/run")
    assert r.status_code == 200, r.text
    return r.json()


async def kinds(ada) -> list[str]:
    return [e["kind"] for e in (await view(ada))["events"]]


async def register(ada, executor_id=DESK):
    r = await ada.post(
        f"{API}/desktop/register",
        json={"executor_id": executor_id, "name": "Ada's PC", "platform": "windows"},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def claim(ada, executor_id=DESK):
    r = await ada.post(f"{API}/desktop/claim", json={"executor_id": executor_id})
    assert r.status_code == 200, r.text
    return r.json()["job"]


async def set_settings(ada, **body):
    r = await ada.put(f"{API}/run/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- the trail and the picture


async def test_a_run_leaves_an_ordered_trail_and_a_live_picture(ada, discovery_source, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await tick()
    v = await view(ada)
    got = [e["kind"] for e in v["events"]]
    assert got[0] == "application_started" and got[-1] == "submission_verified"
    assert {"form_discovered", "field_completed", "document_uploaded", "answer_resolved"} <= set(
        got
    )
    assert v["state"] == "running" and v["counters"]["verified"] == 1
    assert v["current"]["stage"] == "Done" and v["current"]["company"] == "Acme"
    assert v["current"]["cv_version"].startswith("v") and v["current"]["executor"] == "cloud"
    ids = [e["id"] for e in v["events"]]
    assert ids == sorted(ids) and v["last_seq"] == ids[-1]


async def test_events_hold_the_facts_not_what_was_typed(ada, discovery_source, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await tick()
    text = str((await view(ada))["events"])
    assert "ada@example.com" not in text and "+234 801" not in text


async def test_the_receipt_keeps_the_evidence_the_cv_version_and_the_executor(
    ada, discovery_source, tick, maker
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await tick()
    async with maker() as db:
        a = (await db.execute(select(SubmissionAttempt))).scalar_one()
    assert a.executor == "cloud" and a.duration_ms is not None and a.duration_ms >= 0
    assert a.receipt["cv_version"].startswith("v") and a.receipt["executor"] == "cloud"
    assert a.receipt["verified_at"]


async def test_events_can_be_followed_after_a_number_and_a_wait_returns_when_one_arrives(
    ada, discovery_source, tick
):
    discovery_source.postings = [job(1)]
    await start(ada)
    first = (await view(ada))["last_seq"]
    waiter = asyncio.create_task(ada.get(f"{API}/run/events?after={first}&wait=5"))
    await asyncio.sleep(0.3)
    await tick()
    r = await waiter
    body = r.json()
    assert body["events"] and body["events"][0]["id"] > first and body["last_seq"] >= first
    empty = await ada.get(f"{API}/run/events?after={body['last_seq'] + 10_000}")
    assert empty.json()["events"] == []


# -------------------------------------------------------------------------------- controls


async def test_stop_really_stops_work_and_start_carries_on(ada, discovery_source, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    assert (await ada.post(f"{API}/run/stop")).json()["state"] == "stopped"
    await run(ada)
    await tick()
    assert await apps(ada, "submitted") == []  # nothing was sent while stopped
    assert (await ada.post(f"{API}/run/start")).json()["state"] == "running"
    await tick()
    assert len(await apps(ada, "submitted")) == 1
    assert "run_stopped" in await kinds(ada) and "run_started" in await kinds(ada)


async def test_pause_and_resume_act_on_the_campaign(ada, discovery_source, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    assert (await ada.post(f"{API}/run/pause")).json()["state"] == "paused"
    await run(ada)
    await tick()
    assert await apps(ada, "submitted") == []
    assert (await ada.post(f"{API}/run/resume")).json()["state"] == "running"
    await tick()
    assert len(await apps(ada, "submitted")) == 1


async def test_controls_need_a_running_search_and_skip_needs_something_running(ada):
    assert (await ada.post(f"{API}/run/start")).status_code == 409
    assert (await view(ada))["state"] == "idle"


async def test_skip_ends_the_one_running_before_the_button_and_nothing_is_sent(
    ada, discovery_source, form, maker, tick
):
    """The candidate presses skip while the form is being filled in."""
    discovery_source.postings = [job(1), job(2)]
    await start(ada)
    uid = await user_id(maker)

    real_submit = form.submit

    async def submit_with_a_skip_in_the_middle(url, **kw):
        await kw["progress"]("form_discovered", fields=3, steps=1)
        async with maker() as db:  # the candidate presses skip now
            state = await runlog.state_for(db, uid)
            state.command = "skip"
            await db.commit()
        await kw["progress"]("field_completed", field="x", label="x", field_kind="text")
        return await real_submit(url, **kw)  # never reached for the skipped one

    form.submit = submit_with_a_skip_in_the_middle
    await run(ada)
    await tick()
    skipped = await apps(ada, "skipped")
    assert len(skipped) == 1 and skipped[0]["skip_reason"] == "You skipped this role."
    assert len(form.submitted) == 0 or all("jobs" not in str(v) for v in [])  # none went for it
    assert "application_skipped" in await kinds(ada)
    async with maker() as db:
        state = await runlog.state_for(db, uid)
    assert state.command is None  # the command was used up with the attempt


async def test_stop_while_running_puts_the_application_back_in_the_queue(
    ada, discovery_source, form, maker, tick
):
    discovery_source.postings = [job(1)]
    await start(ada)
    uid = await user_id(maker)

    async def submit_then_stop(url, **kw):
        await kw["progress"]("form_discovered", fields=3, steps=1)
        assert (await ada.post(f"{API}/run/stop")).status_code == 200
        await kw["progress"]("field_completed", field="x", label="x", field_kind="text")
        raise AssertionError("not reached")

    form.submit = submit_then_stop
    await run(ada)
    await tick()
    assert len(await apps(ada, "queued")) == 1 and await apps(ada, "submitted") == []
    assert (await view(ada))["state"] == "stopped"
    del uid


async def test_a_question_found_while_filling_in_goes_to_the_candidate_not_to_failed(
    ada, discovery_source, form, tick
):
    discovery_source.postings = [job(1)]
    await start(ada)

    async def asks(url, **kw):
        raise AdapterError(
            "needs_input",
            "asks",
            need=[{"kind": "answer", "field": "visa", "question": "Do you need a visa?"}],
        )

    form.submit = asks
    await run(ada)
    await tick()
    (a,) = await apps(ada, "needs_input")
    assert a["needs_input"][0]["field"] == "visa"
    assert "review_required" in await kinds(ada)
    assert await apps(ada, "failed") == []


async def test_fixtures_touch_nobody_so_they_are_not_slowed(ada, discovery_source, tick):
    discovery_source.postings = [job(1), job(2), job(3)]
    await start(ada)
    await tick()
    assert len(await apps(ada, "submitted")) == 3  # the same minute


async def test_speed_spaces_real_browser_applications_by_the_time_chosen(
    ada, discovery_source, form, outbox_adapters, maker, clock, settings
):
    discovery_source.postings = [job(1), job(2), job(3)]
    await start(ada)
    await run(ada)
    uid = await user_id(maker)
    form.real = True
    settings.environment, settings.autoapply_form_dispatch = "production", True
    await set_settings(ada, speed="slow")  # three minutes between applications
    first = await outbox.claim_next(maker, uid, outbox_adapters, clock.now)
    assert first is not None
    at = clock.now
    assert await outbox.claim_next(maker, uid, outbox_adapters, at) is None
    assert await outbox.claim_next(maker, uid, outbox_adapters, at + timedelta(seconds=170)) is None
    assert await outbox.claim_next(maker, uid, outbox_adapters, at + timedelta(seconds=181))
    await set_settings(ada, speed="fast")  # thirty seconds
    assert await outbox.claim_next(maker, uid, outbox_adapters, at + timedelta(seconds=200)) is None
    assert await outbox.claim_next(maker, uid, outbox_adapters, at + timedelta(seconds=215))


async def test_settings_are_validated_and_recorded(ada):
    v = await set_settings(ada, speed="fast", execution_mode="cloud")
    assert v["speed"] == "fast" and v["execution_mode"] == "cloud"
    assert (await ada.put(f"{API}/run/settings", json={"speed": "warp"})).status_code == 422
    assert "run_settings" in await kinds(ada)


# ---------------------------------------------------------------------- who carries it out


async def test_an_open_desktop_takes_the_browser_forms_and_the_server_leaves_them(
    ada, discovery_source, tick, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    await tick()  # the server's pass: the desktop is ready, so the form is not its to send
    assert await apps(ada, "submitted") == [] and len(await apps(ada, "queued")) == 1
    v = await view(ada)
    assert v["forms_run_on"] == "desktop" and v["desktop_open"] and v["executors"][0]["online"]


async def test_one_application_goes_to_one_executor(ada, discovery_source, maker, tick, live_forms):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await register(ada, OTHER)
    await run(ada)
    first, second = await asyncio.gather(claim(ada), claim(ada, OTHER))
    assert (first is None) != (second is None)  # exactly one desktop got it
    assert await claim(ada) is None and await claim(ada, OTHER) is None
    await tick()
    assert await apps(ada, "submitted") == []  # and the server did not take it either
    async with maker() as db:
        rows = (await db.execute(select(SubmissionAttempt))).scalars().all()
    assert len(rows) == 1 and rows[0].executor == "desktop"


async def test_two_server_workers_cannot_take_the_same_application(
    ada, discovery_source, outbox_adapters, maker, clock
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await run(ada)
    uid = await user_id(maker)
    got = await asyncio.gather(
        *[outbox.claim_next(maker, uid, outbox_adapters, clock.now) for _ in range(4)]
    )
    assert len([g for g in got if g is not None]) == 1


async def test_the_candidate_can_keep_browser_forms_on_the_server(
    ada, discovery_source, tick, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await set_settings(ada, execution_mode="cloud")
    await run(ada)
    assert await claim(ada) is None  # the desktop is told there is nothing for it
    await tick()
    assert len(await apps(ada, "submitted")) == 1


async def test_or_on_the_desktop_only_even_when_it_is_closed(ada, discovery_source, tick):
    discovery_source.postings = [job(1)]
    await start(ada)
    await set_settings(ada, execution_mode="desktop")
    await run(ada)
    await tick()
    assert await apps(ada, "submitted") == []  # waits for the desktop, as asked


async def test_a_desktop_that_goes_quiet_loses_the_application_and_cannot_send_it_later(
    ada, discovery_source, tick, clock, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    job_ = await claim(ada)
    assert job_ is not None
    clock.now += timedelta(minutes=45)  # the desktop never reported again
    await set_settings(ada, execution_mode="cloud")
    await tick()  # reconciliation gives the claim back, then the server sends it
    assert len(await apps(ada, "submitted")) == 1
    late = await ada.post(
        f"{API}/desktop/attempts/{job_['attempt_id']}/dispatch", json={"executor_id": DESK}
    )
    assert late.status_code == 409  # the desktop is told it is no longer its to do


# ------------------------------------------------------------------------- the desktop flow

PROOF = "Thank you for applying"


def result(job_, **kw):
    return {
        "executor_id": DESK,
        "status": "confirmed",
        "provider": "generic",
        "evidence": PROOF,
        "url": "https://x.example/thanks",
        "steps": 1,
        "documents": [job_["documents"]["resume"] | {"bytes": 1000}],
        **kw,
    }


async def test_the_desktop_gets_everything_it_needs_and_nothing_it_should_not_decide(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    assert j["company"] == "Acme" and j["title"] == "Senior Product Manager" and j["url"]
    assert j["values"]["email"] == "ada@example.com" and j["key"]
    assert j["documents"]["resume"]["b64"] and len(j["documents"]["resume"]["sha256"]) == 64
    assert j["cv_version"].startswith("v") and j["lease_seconds"] > 0


async def test_a_desktop_application_is_checked_again_by_the_server_then_confirmed(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    aid = j["attempt_id"]
    ev = await ada.post(
        f"{API}/desktop/attempts/{aid}/events",
        json={
            "executor_id": DESK,
            "events": [
                {"kind": "form_discovered", "data": {"fields": 4, "provider": "generic"}},
                {"kind": "field_completed", "data": {"field": "email", "label": "Email"}},
                {"kind": "launch_missiles", "data": {}},  # not a kind a desktop may report
            ],
        },
    )
    assert ev.status_code == 200 and ev.json()["command"] is None
    assert "launch_missiles" not in await kinds(ada)
    ok = await ada.post(f"{API}/desktop/attempts/{aid}/dispatch", json={"executor_id": DESK})
    assert ok.json() == {"ok": True}
    done = await ada.post(f"{API}/desktop/attempts/{aid}/result", json=result(j))
    assert done.json() == {"state": "confirmed"}
    (a,) = await apps(ada, "submitted")
    assert a["status"] == "submitted"
    v = await view(ada)
    assert v["counters"]["verified"] == 1
    assert [e["executor"] for e in v["events"] if e["kind"] == "submission_verified"] == ["desktop"]


async def test_a_success_without_the_employers_own_words_is_not_a_success(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    aid = j["attempt_id"]
    await ada.post(f"{API}/desktop/attempts/{aid}/dispatch", json={"executor_id": DESK})
    done = await ada.post(
        f"{API}/desktop/attempts/{aid}/result",
        json=result(j, evidence="the button was clicked", url="https://x.example/apply"),
    )
    assert done.json() == {"state": "ambiguous"}
    assert await apps(ada, "submitted") == []
    assert len(await apps(ada, "confirmation_pending")) == 1  # settled by looking, never resent


async def test_a_success_cannot_be_reported_for_an_attempt_that_was_never_dispatched(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    done = await ada.post(f"{API}/desktop/attempts/{j['attempt_id']}/result", json=result(j))
    assert done.json() == {"state": "ambiguous"}  # it skipped the server's last checks


async def test_the_last_checks_stop_a_desktop_when_the_candidate_has_paused(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    await ada.post(f"{API}/run/pause")  # pressed on another device while the form was filling
    no = await ada.post(
        f"{API}/desktop/attempts/{j['attempt_id']}/dispatch", json={"executor_id": DESK}
    )
    assert no.json()["ok"] is False
    assert len(await apps(ada, "queued")) == 1  # nothing was sent; it waits


async def test_skip_pressed_elsewhere_reaches_the_desktop_at_its_next_report(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    assert (await ada.post(f"{API}/run/skip")).status_code == 200
    ev = await ada.post(
        f"{API}/desktop/attempts/{j['attempt_id']}/events",
        json={"executor_id": DESK, "events": []},
    )
    assert ev.json()["command"] == "skip"
    done = await ada.post(
        f"{API}/desktop/attempts/{j['attempt_id']}/result",
        json={"executor_id": DESK, "status": "interrupted", "command": "skip"},
    )
    assert done.json() == {"state": "cancelled"}
    assert len(await apps(ada, "skipped")) == 1


async def test_a_question_the_desktop_found_goes_to_the_candidate(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    need = [{"kind": "answer", "field": "visa", "question": "Do you need a visa?"}]
    done = await ada.post(
        f"{API}/desktop/attempts/{j['attempt_id']}/result",
        json={"executor_id": DESK, "status": "needs_input", "need": need},
    )
    assert done.json() == {"state": "cancelled"}
    (a,) = await apps(ada, "needs_input")
    assert a["needs_input"][0]["question"] == "Do you need a visa?"


async def test_a_captcha_or_sign_in_hands_the_job_to_the_candidate(
    ada, discovery_source, live_forms
):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    await ada.post(
        f"{API}/desktop/attempts/{j['attempt_id']}/result",
        json={"executor_id": DESK, "status": "handed_over", "message": "A human check"},
    )
    assert len(await apps(ada, "apply_yourself")) == 1


async def test_another_computer_or_person_cannot_act_on_an_attempt(
    ada, discovery_source, new_client, sign_in, settings
):
    async with new_client() as eve:  # signs in before the server goes "live" (secure cookies)
        await sign_in(eve, "eve@example.com")
        settings.environment, settings.autoapply_form_dispatch = "production", True
        await _foreign(ada, eve, discovery_source)


async def _foreign(ada, eve, discovery_source):
    discovery_source.postings = [job(1)]
    await start(ada)
    await register(ada)
    await run(ada)
    j = await claim(ada)
    wrong = await ada.post(
        f"{API}/desktop/attempts/{j['attempt_id']}/dispatch", json={"executor_id": OTHER}
    )
    assert wrong.status_code == 409
    r = await eve.post(
        f"{API}/desktop/attempts/{j['attempt_id']}/result",
        json={"executor_id": DESK, "status": "failed"},
    )
    assert r.status_code == 409
    assert (await eve.get(f"{API}/run")).json()["events"] == []  # nor see its trail
    assert len(await apps(ada, "queued")) == 0 and len(await apps(ada, "sending")) == 1


async def test_a_run_only_ever_shows_its_own_owner(ada, new_client, sign_in):
    async with new_client() as eve:
        await sign_in(eve, "eve@example.com")
        v = (await eve.get(f"{API}/run")).json()
        assert v["state"] == "idle" and v["events"] == [] and v["counters"]["verified"] == 0


async def test_run_state_rows_are_one_per_person(ada, maker):
    await view(ada)
    await view(ada)
    async with maker() as db:
        assert len((await db.execute(select(RunState))).scalars().all()) == 1
