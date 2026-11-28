"""The systems the browser engine knows: how each is detected, and the engine against copies of
their page structure served from this machine. Nothing here touches a real employer.

What is claimed, and no more: Greenhouse (read on the live site, tested on its structure), Ashby and
Lever (tested on a copy of their public markup), the rest detection only (see ats.py)."""

import asyncio
import socket
import threading
import time

import pytest

pytest.importorskip("playwright")

import uvicorn  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import HTMLResponse, RedirectResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402

from app.autoapply import ats  # noqa: E402
from app.autoapply.adapters import AdapterError  # noqa: E402
from app.autoapply.browserform import BrowserForm  # noqa: E402

RECEIVED: list[dict] = []

# ------------------------------------------------------------------- detection (no browser)


@pytest.mark.parametrize(
    "url,key",
    [
        ("https://boards.greenhouse.io/acme/jobs/1", "greenhouse"),
        ("https://job-boards.greenhouse.io/acme/jobs/1", "greenhouse"),
        ("https://jobs.ashbyhq.com/acme/uuid/application", "ashby"),
        ("https://jobs.lever.co/acme/uuid/apply", "lever"),
        ("https://jobs.smartrecruiters.com/Acme/123-role", "smartrecruiters"),
        ("https://apply.workable.com/acme/j/ABC123/apply/", "workable"),
        ("https://acme.recruitee.com/o/role", "recruitee"),
        ("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x", "workday"),
        ("https://acme.bamboohr.com/careers/12", "bamboohr"),
        ("https://careers.example.com/apply", "generic"),
        ("https://greenhouse.io.evil.example/x", "generic"),  # a look-alike host is not Greenhouse
        ("https://evil.example/jobs.lever.co", "generic"),
        ("", "generic"),
    ],
)
def test_each_system_is_detected_from_its_address(url, key):
    assert ats.detect(url).key == key


def test_a_company_domain_is_recognised_only_by_two_markers():
    two = "<form class='lever-application-form'><button class='postings-btn'>"
    one = "<div class='lever-application-form'>"
    assert ats.detect("https://careers.acme.com/apply", two).key == "lever"
    assert ats.detect("https://careers.acme.com/apply", one).key == "generic"


def test_what_is_on_by_default_is_what_has_been_seen_working():
    on = ats.enabled("")
    assert on == {"greenhouse", "ashby", "lever"}
    assert ats.enabled("greenhouse") == {"greenhouse"}
    assert "workday" not in ats.enabled("all")  # needs an account: never filled in
    assert {"smartrecruiters", "workable", "recruitee", "bamboohr"} <= ats.enabled("all")
    table = {r["key"]: r for r in ats.status_table()}
    assert table["greenhouse"]["support"] == ats.LIVE
    assert table["lever"]["support"] == ats.FIXTURE and table["workday"]["needs_account"]
    assert all(r["support"] == ats.UNTESTED for k, r in table.items() if k not in on)


def test_support_follows_the_enabled_list_not_the_host_alone():
    only_greenhouse = BrowserForm(enabled_ats={"greenhouse"})
    assert only_greenhouse.supports("https://boards.greenhouse.io/a/jobs/1")
    assert not only_greenhouse.supports("https://jobs.lever.co/a/1")
    everything = BrowserForm(enabled_ats=ats.enabled("all"))
    assert everything.supports("https://apply.workable.com/acme/j/1/")
    assert not everything.supports("https://acme.wd5.myworkdayjobs.com/x")  # needs an account


# ------------------------------------------------------------------- the pages

LEVER = """<!doctype html><html><head><title>Acme - Role</title></head><body>
<div class="postings-page"><form id="lever-application-form" method="post" action="/lever/submit"
 enctype="multipart/form-data">
 <label for="name">Full name<span>✱</span></label><input id="name" name="name" required>
 <label for="email">Email<span>✱</span></label><input id="email" name="email" type="email" required>
 <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
 <label for="org">Current company</label><input id="org" name="org">
 <label for="resume">Resume/CV<span>✱</span></label><input id="resume" name="resume" type="file" required>
 <label for="urls[LinkedIn]">LinkedIn URL</label><input id="urls[LinkedIn]" name="urls[LinkedIn]">
 <button id="btn-submit" class="postings-btn" type="submit">Submit application</button>
</form></div></body></html>"""

WORKABLE_STEP1 = """<!doctype html><html><head><title>Apply</title></head><body>
<form id="f" method="post" action="/workable/submit" enctype="multipart/form-data">
 <div id="s1">
  <label for="firstname">First name*</label><input id="firstname" name="firstname" required>
  <label for="lastname">Last name*</label><input id="lastname" name="lastname" required>
  <label for="email">Email*</label><input id="email" name="email" type="email" required>
  <label for="resume">Resume*</label><input id="resume" name="resume" type="file" required>
  <button type="button" id="next" onclick="go()">Next</button>
 </div>
 <div id="s2" style="display:none">
  <label for="phone">Phone*</label><input id="phone" name="phone" type="tel" required>
  <label for="start">Earliest start date*</label><input id="start" name="start" type="date" required>
  <label for="years">Years of experience*</label><input id="years" name="years" type="number" required>
  <button type="submit">Submit application</button>
 </div>
</form>
<script>
function go(){ document.getElementById('s1').style.display='none'; document.getElementById('s2').style.display='block'; }
</script></body></html>"""

# a form whose second screen asks something nobody has answered
LATE = WORKABLE_STEP1.replace(
    '<label for="years">Years of experience*</label><input id="years" name="years" type="number" required>',
    '<label for="visa">Do you need visa sponsorship?*</label>'
    '<select id="visa" name="visa" required><option value="">Select</option>'
    "<option>Yes</option><option>No</option></select>",
)

WORKDAY = """<!doctype html><html><head><title>Careers</title></head><body>
<p>myworkdayjobs.com careers site powered by workday</p>
<form><input id="email" name="email"><button type="button">Create Account / Sign In</button></form>
</body></html>"""

EMPTY_LEFT = """<!doctype html><html><body>
<form id="lever-application-form" method="post" action="/lever/submit">
 <label for="name">Full name</label><input id="name" name="name">
 <label for="x">Notes</label><input id="x" name="x" required>
 <button class="postings-btn" type="submit">Submit</button>
</form></body></html>"""


async def _store(request: Request, tag: str):
    form = await request.form()
    resume = form.get("resume")
    RECEIVED.append(
        {
            "tag": tag,
            **{k: v for k, v in form.items() if isinstance(v, str)},
            "resume_bytes": await resume.read() if resume is not None and resume.filename else b"",
        }
    )


async def lever_submit(request: Request):
    await _store(request, "lever")
    return RedirectResponse("/lever/thanks", status_code=303)


async def workable_submit(request: Request):
    await _store(request, "workable")
    return RedirectResponse("/workable/thanks", status_code=303)


ROUTES = [
    Route("/lever/acme/1/apply", lambda r: HTMLResponse(LEVER)),
    Route("/lever/submit", lever_submit, methods=["POST"]),
    Route(
        "/lever/thanks",
        lambda r: HTMLResponse("<html><body><h2>Application submitted!</h2></body></html>"),
    ),
    Route("/workable/step", lambda r: HTMLResponse(WORKABLE_STEP1)),
    Route("/workable/late", lambda r: HTMLResponse(LATE)),
    Route("/workable/submit", workable_submit, methods=["POST"]),
    Route(
        "/workable/thanks",
        lambda r: HTMLResponse("<html><body><h1>Thank you for applying</h1></body></html>"),
    ),
    Route("/workday/apply", lambda r: HTMLResponse(WORKDAY)),
    Route("/lever/empty", lambda r: HTMLResponse(EMPTY_LEFT)),
]


@pytest.fixture(scope="module")
def site():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(Starlette(routes=ROUTES), host="127.0.0.1", port=port, log_level="error")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def form(site):
    RECEIVED.clear()
    f = BrowserForm(hosts=("127.0.0.1",))
    try:
        asyncio.run(_probe(f))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"no browser here: {type(exc).__name__}")
    return f


async def _probe(f: BrowserForm) -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        b = await f._open(pw)
        await b.close()


def run(form, url, values, **kw):
    events: list[tuple[str, dict]] = []

    async def progress(kind, **data):
        events.append((kind, data))

    out = asyncio.run(
        form.submit(
            url,
            idempotency_key=kw.get("key", "k1"),
            values=values,
            cv_text="Ada Okoye\nSUMMARY\nA product person.",
            cv_filename="Ada Okoye - CV.pdf",
            progress=progress,
        )
    )
    return out, events


LEVER_VALUES = {
    "name": "Ada Okoye",
    "email": "ada@example.com",
    "phone": "+234 801 234 5678",
    "current_company": "Northwind",
    "linkedin": "https://linkedin.com/in/adaokoye",
}
STEP_VALUES = {
    "first_name": "Ada",
    "last_name": "Okoye",
    "email": "ada@example.com",
    "phone": "+234 801 234 5678",
    "notice_period": "01/02/2027",  # a start date, written the usual way; a date box wants yyyy-mm-dd
    "years_experience": "7 years",
    "requires_sponsorship": "No",
}


def test_a_lever_style_form_is_detected_filled_and_verified(form, site):
    receipt, events = run(form, f"{site}/lever/acme/1/apply", LEVER_VALUES)
    assert receipt.provider == "lever" and receipt.steps == 1
    assert "Application submitted" in receipt.evidence
    got = RECEIVED[0]
    assert got["name"] == "Ada Okoye" and got["email"] == "ada@example.com"
    assert got["org"] == "Northwind" and got["urls[LinkedIn]"].endswith("adaokoye")
    assert got["resume_bytes"].startswith(b"%PDF")


def test_the_receipt_names_the_document_that_was_uploaded(form, site):
    receipt, _ = run(form, f"{site}/lever/acme/1/apply", LEVER_VALUES)
    (doc,) = receipt.documents
    assert doc["name"] == "Ada Okoye - CV.pdf" and doc["bytes"] == len(RECEIVED[0]["resume_bytes"])
    import hashlib

    assert doc["sha256"] == hashlib.sha256(RECEIVED[0]["resume_bytes"]).hexdigest()


def test_progress_is_reported_in_order_without_the_answers_themselves(form, site):
    _, events = run(form, f"{site}/lever/acme/1/apply", LEVER_VALUES)
    kinds = [k for k, _ in events]
    assert kinds[0] == "form_discovered" and kinds[-2:] == ["validated", "submitting"]
    assert "field_completed" in kinds and "document_uploaded" in kinds
    assert events[0][1]["provider"] == "lever"
    assert "ada@example.com" not in str(events)  # what was typed never travels in an event


def test_a_two_screen_form_is_walked_through_and_typed_fields_are_formatted(form, site):
    receipt, events = run(form, f"{site}/workable/step", STEP_VALUES)
    assert receipt.steps == 2
    got = RECEIVED[0]
    assert got["start"] == "2027-02-01"  # the date box took yyyy-mm-dd
    assert got["years"] == "7"  # a number box took digits
    assert [k for k, _ in events].count("step_completed") == 1


def test_a_question_on_a_later_screen_is_handed_to_the_candidate_before_sending(form, site):
    values = {k: v for k, v in STEP_VALUES.items() if k != "requires_sponsorship"}
    with pytest.raises(AdapterError) as e:
        run(form, f"{site}/workable/late", values)
    assert e.value.code == "needs_input" and not RECEIVED
    assert e.value.need[0]["question"].startswith("Do you need visa sponsorship")
    assert e.value.need[0]["options"] == ["Yes", "No"]


def test_a_site_that_needs_an_account_is_never_filled_in(site):
    f = BrowserForm(hosts=("127.0.0.1",))
    with pytest.raises(AdapterError) as e:
        asyncio.run(f.read_form(f"{site}/workday/apply"))
    assert e.value.code == "rejected" and "sign in" in e.value.message.lower()


def test_a_required_box_nobody_answered_stops_before_anything_is_typed(form, site):
    with pytest.raises(AdapterError) as e:
        run(form, f"{site}/lever/empty", {"name": "Ada Okoye"})
    assert e.value.code == "needs_input" and [n["field"] for n in e.value.need] == ["x"]
    assert not RECEIVED


def test_stopping_between_screens_means_nothing_was_sent(form, site):
    async def stop_after_first_step(kind, **data):
        if kind == "step_completed":
            raise AdapterError("interrupted", "Stopped by you.")

    with pytest.raises(AdapterError) as e:
        asyncio.run(
            form.submit(
                f"{site}/workable/step",
                idempotency_key="stop",
                values=STEP_VALUES,
                cv_text="cv",
                cv_filename="cv.pdf",
                progress=stop_after_first_step,
            )
        )
    assert e.value.code == "interrupted" and not RECEIVED


def test_the_usual_ways_a_page_says_the_application_went_all_count_as_proof():
    g = ats.GENERIC
    for text in (
        "Application submitted",
        "Your application has been submitted!",
        "Your application was successfully submitted.",
        "Thanks for applying to Acme",
        "Thank you for applying",
        "You've applied",
        "We got your application",
        "Submitted application",
        "We have received your application",
    ):
        assert ats.confirmation(g, "https://x/apply", text, "https://x/apply"), text
    assert (
        ats.confirmation(g, "https://x/apply", "Please fill in every field", "https://x/apply")
        is None
    )


def test_words_that_were_on_the_page_before_the_button_are_not_proof():
    g = ats.GENERIC
    note = "Once your application is submitted you will hear from us"
    assert ats.confirmation(g, "https://x", note, "https://x", note) is None  # nothing new
    both = f"{note}. Your application was successfully submitted."
    assert ats.confirmation(g, "https://x", both, "https://x", note)  # something new appeared
