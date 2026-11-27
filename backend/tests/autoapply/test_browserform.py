"""The browser form filler, against a small employer site served from this machine. The pages follow
the shape of real applicant-tracking forms (checked against live Greenhouse and Lever pages by
reading them only): text and tel fields, a CV file, a dropdown, a script-drawn combobox, a radio
group, a consent box, a hidden trap field, a CAPTCHA page and a closed job."""

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

from app.autoapply import browserform  # noqa: E402
from app.autoapply.adapters import AdapterError  # noqa: E402
from app.autoapply.browserform import BrowserForm  # noqa: E402

RECEIVED: list[dict] = []

# A copy of the shape of an Ashby application page (public class names and field paths, drawn by
# script with no <form> tag): entries with a title, ids equal to the field path, Yes/No as a row of
# buttons, a hidden file input behind an "Upload File" button, and a submit button of its own.
ASHBY = """<!doctype html><html><head><title>Apply</title></head><body>
<div class="ashby-application-form-container">
 <div class="ashby-application-form-field-entry">
  <label class="ashby-application-form-question-title" for="_systemfield_name">Legal Name</label>
  <input id="_systemfield_name" name="_systemfield_name" type="text" required></div>
 <div class="ashby-application-form-field-entry">
  <label class="ashby-application-form-question-title" for="_systemfield_email">Email</label>
  <input id="_systemfield_email" name="_systemfield_email" type="email" required></div>
 <div class="ashby-application-form-field-entry">
  <label class="ashby-application-form-question-title" for="4b71">Phone</label>
  <input id="4b71" type="tel" required></div>
 <div class="ashby-application-form-field-entry">
  <label class="ashby-application-form-question-title" for="_systemfield_resume">Resume*</label>
  <button type="button">Upload File</button>
  <input id="_systemfield_resume" type="file" style="display:none"></div>
 <div class="ashby-application-form-field-entry">
  <label class="ashby-application-form-question-title" for="dc91">LinkedIn Profile</label>
  <input id="dc91" type="text"></div>
 <div class="ashby-application-form-field-entry" id="yesno">
  <label class="ashby-application-form-question-title">Do you have 5 years of experience?*</label>
  <div><button type="button" onclick="pick(this)">Yes</button><button type="button" onclick="pick(this)">No</button></div></div>
 <div class="ashby-application-form-field-entry">
  <label class="ashby-application-form-question-title" for="long1">Tell us about a hard problem you solved*</label>
  <textarea id="long1" required></textarea></div>
 <button type="submit" class="ashby-application-form-submit-button" onclick="send()">Submit Application</button>
</div>
<script>
 let answer = "";
 function pick(b) { answer = b.textContent; b.dataset.on = "1"; }
 async function send() {
   const f = new FormData();
   f.append("name", document.getElementById("_systemfield_name").value);
   f.append("email", document.getElementById("_systemfield_email").value);
   f.append("phone", document.getElementById("4b71").value);
   f.append("linkedin", document.getElementById("dc91").value);
   f.append("long1", document.getElementById("long1").value);
   f.append("yesno", answer);
   const file = document.getElementById("_systemfield_resume").files[0];
   if (file) f.append("resume", file);
   await fetch("/ashby/apply", {method: "POST", body: f});
   document.body.innerHTML = "<p>Your application was successfully submitted.</p>";
 }
</script></body></html>"""

FORM = """<!doctype html><html><head><title>Apply</title></head><body>
<h1>Product Manager</h1>
<form id="f" method="post" action="{action}" enctype="multipart/form-data">
 <label for="first_name">First Name*</label><input id="first_name" name="first_name" aria-required="true">
 <label for="last_name">Last Name*</label><input id="last_name" name="last_name" aria-required="true">
 <label for="email">Email*</label><input id="email" name="email" type="email" required>
 <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
 <label for="country">Country*</label>
 <input id="country" role="combobox" aria-autocomplete="list" aria-required="true" autocomplete="off">
 <input type="hidden" id="country_val" name="country">
 <ul id="opts" role="listbox" hidden></ul>
 <label for="resume">Resume/CV*</label><input id="resume" name="resume" type="file">
 <label for="cover_letter">Cover letter</label><input id="cover_letter" name="cover_letter" type="file">
 <label for="question_1">Why do you want to work here?*</label><textarea id="question_1" name="question_1" aria-required="true"></textarea>
 <label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin">
 <label for="auth">Are you legally authorized to work in the US?*</label>
 <select id="auth" name="auth" required><option value="">Select...</option><option>Yes</option><option>No</option></select>
 <fieldset><legend>Veteran status</legend>
  <label><input type="radio" name="veteran" value="y">I am a veteran</label>
  <label><input type="radio" name="veteran" value="n">I am not a veteran</label>
  <label><input type="radio" name="veteran" value="d">Prefer not to say</label></fieldset>
 <label><input type="checkbox" id="consent" name="consent" required>I agree to the privacy policy*</label>
 <input name="trap" style="display:none" tabindex="-1">
 {extra}
 <button type="submit">Submit application</button>
</form>
<script>
 const COUNTRIES = ["Nigeria", "United Kingdom", "United States"];
 const box = document.getElementById("country"), list = document.getElementById("opts");
 function show() {{
   const q = box.value.toLowerCase();
   list.innerHTML = "";
   COUNTRIES.filter(c => c.toLowerCase().includes(q)).forEach(c => {{
     const li = document.createElement("li"); li.setAttribute("role", "option"); li.textContent = c;
     li.onclick = () => {{ box.value = c; document.getElementById("country_val").value = c; list.hidden = true; }};
     list.appendChild(li);
   }});
   list.hidden = false;
 }}
 box.addEventListener("click", show); box.addEventListener("input", show);
</script></body></html>"""


async def apply(request: Request):
    form = await request.form()
    missing = [k for k in ("first_name", "email", "question_1", "country") if not form.get(k)]
    if missing:
        return HTMLResponse(
            FORM.format(action="/apply", extra="")
            + "<p role='alert'>Question 1 is required.</p>"
            + "<script>document.getElementById('question_1').setAttribute('aria-invalid','true')</script>"
        )
    resume = form.get("resume")
    RECEIVED.append(
        {
            **{k: v for k, v in form.items() if isinstance(v, str)},
            "resume_bytes": await resume.read() if resume is not None and resume.filename else b"",
            "resume_name": getattr(resume, "filename", ""),
        }
    )
    return RedirectResponse("/confirmation", status_code=303)


async def ashby_apply(request: Request):
    form = await request.form()
    resume = form.get("resume")
    RECEIVED.append(
        {
            **{k: v for k, v in form.items() if isinstance(v, str)},
            "resume_bytes": await resume.read() if resume is not None and resume.filename else b"",
        }
    )
    from starlette.responses import JSONResponse

    return JSONResponse({"ok": True})


ROUTES = [
    Route("/ashby/jobs/1", lambda r: HTMLResponse(ASHBY)),
    Route("/ashby/apply", ashby_apply, methods=["POST"]),
    Route("/jobs/1", lambda r: HTMLResponse(FORM.format(action="/apply", extra=""))),
    Route(
        "/jobs/captcha",
        lambda r: HTMLResponse(
            FORM.format(action="/apply", extra='<div class="g-recaptcha" data-sitekey="x"></div>')
        ),
    ),
    Route(
        "/jobs/closed",
        lambda r: HTMLResponse("<html><title>Job</title><body>This job is no longer open.</body>"),
    ),
    Route("/jobs/silent", lambda r: HTMLResponse(FORM.format(action="/silent", extra=""))),
    Route(
        "/silent",
        lambda r: HTMLResponse("<html><body><p>Working on it...</p></body></html>"),
        methods=["POST"],
    ),
    Route("/apply", apply, methods=["POST"]),
    Route(
        "/confirmation",
        lambda r: HTMLResponse("<html><body><h2>Thank you for applying!</h2></body></html>"),
    ),
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
    try:  # a machine without a browser skips these
        asyncio.run(_probe(f))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"no browser here: {type(exc).__name__}")
    return f


async def _probe(f: BrowserForm) -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        b = await f._open(pw)
        await b.close()


GOOD = {
    "first_name": "Ada",
    "last_name": "Okoye",
    "email": "ada@example.com",
    "phone": "+234 801 234 5678",
    "country": "Nigeria",
    "question_1": "I like payments.",
    "auth": "Yes",
    "linkedin": "https://linkedin.com/in/adaokoye",
    "consent": "yes",
    "veteran": "Prefer not to say",
}


def test_only_approved_sites_are_filled_in():
    f = BrowserForm()
    assert f.supports("https://job-boards.greenhouse.io/acme/jobs/123")
    assert f.supports("https://boards.greenhouse.io/acme/jobs/123")
    assert not f.supports("http://boards.greenhouse.io/acme/jobs/123")  # not over plain http
    assert not f.supports("https://evil.example/boards.greenhouse.io")
    assert not f.supports("https://greenhouse.io.evil.example/x")
    assert f.supports("https://jobs.lever.co/acme/1")  # Lever: tested on its markup, on by default
    assert not f.supports("https://jobs.smartrecruiters.com/acme/1")  # untested: off until enabled
    assert not f.supports("")
    assert f.real is True


def test_names_the_usual_questions_the_way_the_facts_do():
    c = browserform.canonical
    assert c("First Name", "first_name") == "first_name"
    assert c("Email", "x") == "email"
    assert c("Current location", "location-input") == "location"
    assert c("Country", "country") == "country"
    assert c("Full name", "name") == "name"
    assert c("LinkedIn URL", "urls[LinkedIn]") == "linkedin"
    assert c("Are you currently located in the US?", "question_9") == "question_9"
    assert c("Why do you want to work at Discord?", "question_1") == "question_1"


def test_picks_the_option_that_is_the_answer():
    assert browserform.pick(["Yes", "No"], "no") == 1
    assert browserform.pick(["United States", "Nigeria"], "Nigeria") == 1
    assert browserform.pick(["Prefer not to disclose", "Man"], "prefer not to") == 0
    assert browserform.pick(["Yes", "No"], "maybe") is None


def test_reads_the_form_as_it_is_right_now(form, site):
    schema = asyncio.run(form.read_form(f"{site}/jobs/1"))
    by = {f.name: f for f in schema.fields}
    assert {"first_name", "last_name", "email", "phone", "country", "resume", "question_1"} <= set(
        by
    )
    assert by["first_name"].required and by["last_name"].required and by["email"].required
    assert not by["phone"].required and not by["linkedin"].required
    assert by["resume"].kind == "file" and by["resume"].required
    assert by["cover_letter"].kind == "file" and not by["cover_letter"].required
    assert by["auth"].kind == "choice" and by["auth"].options == ["Yes", "No"]
    assert by["country"].kind == "choice" and by["country"].options == [
        "Nigeria", "United Kingdom", "United States"
    ]  # fmt: skip
    assert by["veteran"].kind == "choice" and len(by["veteran"].options) == 3
    assert by["consent"].kind == "declaration" and by["consent"].required
    assert "trap" not in by and not any(f.kind == "captcha" for f in schema.fields)
    assert schema.version == asyncio.run(form.read_form(f"{site}/jobs/1")).version  # steady


def test_fills_the_form_with_the_cv_and_submits_it_once(form, site):
    cv = "Ada Okoye\nSenior Product Manager at Northwind"
    receipt = asyncio.run(
        form.submit(
            f"{site}/jobs/1",
            idempotency_key="k1",
            values=GOOD,
            cv_text=cv,
            cv_filename="Ada Okoye - CV.pdf",
        )
    )
    assert receipt.reference.startswith("browser-") and "Thank you" in receipt.evidence
    [got] = RECEIVED
    assert got["first_name"] == "Ada" and got["last_name"] == "Okoye"
    assert got["email"] == "ada@example.com" and got["phone"] == "+234 801 234 5678"
    assert got["country"] == "Nigeria" and got["auth"] == "Yes" and got["consent"]
    assert got["veteran"] == "d" and got["linkedin"].endswith("adaokoye")
    assert got["trap"] == ""  # the hidden trap field is left alone
    assert got["resume_name"] == "Ada Okoye - CV.pdf" and got["resume_bytes"].startswith(b"%PDF")
    # the same intent again changes nothing: no second application
    again = asyncio.run(
        form.submit(
            f"{site}/jobs/1", idempotency_key="k1", values=GOOD, cv_text=cv, cv_filename="x.pdf"
        )
    )
    assert again.reference == receipt.reference and len(RECEIVED) == 1
    assert asyncio.run(form.find_receipt(f"{site}/jobs/1", idempotency_key="k1")) == receipt
    assert asyncio.run(form.find_receipt(f"{site}/jobs/1", idempotency_key="other")) is None


def test_a_form_that_refuses_the_answers_means_nothing_was_sent(form, site):
    values = {k: v for k, v in GOOD.items() if k != "question_1"}  # the required question
    with pytest.raises(AdapterError) as e:
        asyncio.run(
            form.submit(
                f"{site}/jobs/1",
                idempotency_key="k2",
                values=values,
                cv_text="cv",
                cv_filename="cv.pdf",
            )
        )
    # the unanswered question is found before anything is typed, and handed to the candidate
    assert e.value.code == "needs_input" and not RECEIVED
    assert [n["field"] for n in e.value.need] == ["question_1"]


def test_an_answer_with_no_matching_choice_is_not_guessed(form, site):
    values = {**GOOD, "auth": "Perhaps"}
    with pytest.raises(AdapterError) as e:
        asyncio.run(
            form.submit(
                f"{site}/jobs/1",
                idempotency_key="k3",
                values=values,
                cv_text="cv",
                cv_filename="cv.pdf",
            )
        )
    assert e.value.code == "rejected" and "Are you legally authorized" in e.value.message
    assert not RECEIVED


def test_a_captcha_is_handed_back_not_worked_around(form, site):
    schema = asyncio.run(form.read_form(f"{site}/jobs/captcha"))
    assert any(f.kind == "captcha" for f in schema.fields)
    with pytest.raises(AdapterError) as e:
        asyncio.run(
            form.submit(
                f"{site}/jobs/captcha",
                idempotency_key="k4",
                values=GOOD,
                cv_text="cv",
                cv_filename="cv.pdf",
            )
        )
    assert e.value.code == "rejected" and "CAPTCHA" in e.value.message and not RECEIVED


def test_a_closed_job_says_so(form, site):
    with pytest.raises(AdapterError) as e:
        asyncio.run(form.read_form(f"{site}/jobs/closed"))
    assert e.value.code == "rejected" and "no longer open" in e.value.message


def test_an_unclear_ending_is_unknown_so_the_candidate_is_asked(form, site, monkeypatch):
    monkeypatch.setattr(browserform, "SUBMIT_MS", 2000)
    with pytest.raises(AdapterError) as e:
        asyncio.run(
            form.submit(
                f"{site}/jobs/silent",
                idempotency_key="k5",
                values=GOOD,
                cv_text="cv",
                cv_filename="cv.pdf",
            )
        )
    assert e.value.code == "ambiguous"  # it may have gone through: never assume it did not


def test_a_form_we_are_not_approved_for_is_never_opened(form):
    with pytest.raises(AdapterError) as e:
        asyncio.run(form.read_form("https://jobs.example.com/apply/1"))
    assert e.value.code == "rejected"


ASHBY_VALUES = {
    "name": "Ada Okoye",
    "email": "ada@example.com",
    "phone": "+234 801 234 5678",
    "linkedin": "https://linkedin.com/in/adaokoye",
    "q_do_you_have_5_years_of_experience": "Yes",
    "long1": "I rebuilt a payments reconciliation job.",
}


def test_reads_an_ashby_shaped_page_without_a_form_tag(form, site):
    schema = asyncio.run(form.read_form(f"{site}/ashby/jobs/1"))
    by = {f.name: f for f in schema.fields}
    assert {"name", "email", "phone", "resume", "linkedin"} <= set(by)  # _systemfield_* are named
    assert by["name"].label == "Legal Name" and by["name"].required
    assert by["resume"].kind == "file" and by["linkedin"].required is False
    yes_no = by["q_do_you_have_5_years_of_experience"]
    assert yes_no.kind == "choice" and yes_no.options == ["Yes", "No"] and yes_no.required
    assert by["long1"].kind == "text" and by["long1"].required


def test_fills_an_ashby_shaped_page_including_yes_no_buttons(form, site):
    receipt = asyncio.run(
        form.submit(
            f"{site}/ashby/jobs/1",
            idempotency_key="a1",
            values=ASHBY_VALUES,
            cv_text="Ada Okoye\nSenior PM",
            cv_filename="Ada Okoye - CV.pdf",
        )
    )
    assert "successfully submitted" in receipt.evidence
    [got] = RECEIVED
    assert got["name"] == "Ada Okoye" and got["email"] == "ada@example.com"
    assert got["phone"].startswith("+234") and got["linkedin"].endswith("adaokoye")
    assert got["yesno"] == "Yes" and got["long1"].startswith("I rebuilt")
    assert got["resume_bytes"].startswith(b"%PDF")


def test_an_answer_that_is_not_one_of_the_buttons_is_not_guessed(form, site):
    values = {**ASHBY_VALUES, "q_do_you_have_5_years_of_experience": "Sometimes"}
    with pytest.raises(AdapterError) as e:
        asyncio.run(
            form.submit(
                f"{site}/ashby/jobs/1",
                idempotency_key="a2",
                values=values,
                cv_text="cv",
                cv_filename="c.pdf",
            )
        )
    assert e.value.code == "rejected" and not RECEIVED


def test_ashby_is_on_the_default_list_and_a_lookalike_is_not():
    f = BrowserForm()
    assert f.supports(
        "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application"
    )
    assert not f.supports("https://jobs.ashbyhq.com.evil.example/x")
    assert not f.supports("https://ashbyhq.com/x")
