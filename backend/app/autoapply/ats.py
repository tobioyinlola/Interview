"""Applicant-tracking systems the browser engine knows, in one place.

Companies using the same ATS share one adapter: what differs per system is small and lives here
(where its pages are hosted, what marks them, which button submits or moves on, what confirmation
looks like, whether applying needs an account). Everything else (reading the form, classifying its
fields, answering them, uploading documents, checking the result) is the same engine for all.

`support` says how far each one has been checked, and nothing is enabled by default that has not
been seen working:

* ``live``     the application page was read on the real site (nothing was submitted), and the
               behaviour is tested on a copy of its structure;
* ``fixture``  tested only on a copy of its structure built from public page markup;
* ``untested`` detection only, from what is publicly known. It is off unless an operator turns it
               on (AUTOAPPLY_ATS_ENABLED) and a person watches the first applications.

A system that needs an account (Workday) is detected so the job can go to the candidate with the
CV ready; it is never worked round."""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

LIVE, FIXTURE, UNTESTED = "live", "fixture", "untested"


@dataclass(frozen=True)
class Ats:
    key: str
    label: str
    hosts: tuple[str, ...] = ()  # the host, or any subdomain of it
    path: str = ""  # a regex the path must match, when hosts alone are too wide (BambooHR)
    markers: tuple[str, ...] = ()  # strings in the page that identify it on a custom domain
    submit: str = ""  # extra selectors for the final button, tried before the generic ones
    next: str = ""  # selectors for "next step" in a form drawn over several screens
    success_url: str = ""  # regexes (case-insensitive) that show the employer took it
    success_text: str = ""
    needs_account: bool = False
    captcha_likely: bool = False
    multi_step: bool = False
    support: str = UNTESTED
    default_on: bool = False

    def matches_url(self, url: str) -> bool:
        parts = urlsplit(url or "")
        host = (parts.hostname or "").lower()
        if not any(host == h or host.endswith("." + h) for h in self.hosts):
            return False
        return not self.path or re.search(self.path, parts.path or "", re.I) is not None


# What a confirmation looks like on any employer's site, before a system's own words are added.
SUCCESS_URL = re.compile(r"/(confirmation|thank|submitted|success|applied)", re.I)
SUCCESS_TEXT = re.compile(
    r"thank you for (applying|your application|your interest|submitting)"
    r"|application (has been )?(submitted|received|sent|complete)"
    r"|we(?:'ve| have) received your application"
    r"|successfully submitted",
    re.I,
)


def confirmation(system: "Ats", url: str, text: str, before_url: str = "") -> str | None:
    """The proof the employer took an application: its own words on the page, or a new address that
    says so. None when there is none (pressing the button is never proof)."""
    m = SUCCESS_TEXT.search(text) or (
        re.search(system.success_text, text, re.I) if system.success_text else None
    )
    if m:
        return m.group(0)[:200]
    moved = url != before_url
    if moved and (
        SUCCESS_URL.search(url) or (system.success_url and re.search(system.success_url, url, re.I))
    ):
        return url[:200]
    return None


GENERIC = Ats(
    key="generic",
    label="Company career form",
    submit="",
    next="",
    support=UNTESTED,
)

PROVIDERS: tuple[Ats, ...] = (
    Ats(
        key="greenhouse",
        label="Greenhouse",
        hosts=("boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"),
        markers=("greenhouse.io/embed", "gh_jid", 'id="application_form"'),
        submit="#submit_app, button[type=submit]",
        success_url=r"/confirmation|/thanks",
        success_text=r"thank you for applying|your application has been submitted",
        support=LIVE,
        default_on=True,
    ),
    Ats(
        key="ashby",
        label="Ashby",
        hosts=("jobs.ashbyhq.com",),
        markers=("ashby-application-form", "ashbyhq.com"),
        submit=".ashby-application-form-submit-button",
        success_text=r"application (was )?successfully submitted|thank you for applying",
        support=FIXTURE,
        default_on=True,
    ),
    Ats(
        key="lever",
        label="Lever",
        hosts=("jobs.lever.co", "jobs.eu.lever.co"),
        markers=("lever-application-form", "postings-btn", "lever.co"),
        submit="#btn-submit, button.postings-btn[type=submit], button[data-qa=btn-submit]",
        success_url=r"/thanks",
        success_text=r"application submitted|thanks for applying|we've received your application",
        captcha_likely=True,  # most Lever postings carry an hCaptcha: handed to the candidate
        support=FIXTURE,
        default_on=True,
    ),
    Ats(
        key="smartrecruiters",
        label="SmartRecruiters",
        hosts=("jobs.smartrecruiters.com", "careers.smartrecruiters.com"),
        markers=("smartrecruiters",),
        submit="button[type=submit]:has-text('Submit'), button:has-text('Submit application')",
        next="button:has-text('Next'), button:has-text('Continue')",
        success_text=r"thank you|application (has been )?(submitted|received)",
        multi_step=True,
        support=UNTESTED,
    ),
    Ats(
        key="workable",
        label="Workable",
        hosts=("apply.workable.com", "jobs.workable.com"),
        markers=("workable.com", 'data-ui="application-form"'),
        submit="button[data-ui=apply-button], button:has-text('Submit application')",
        next="button:has-text('Next'), button:has-text('Continue')",
        success_text=r"thank you for applying|application (was )?(submitted|received)",
        multi_step=True,
        support=UNTESTED,
    ),
    Ats(
        key="recruitee",
        label="Recruitee",
        hosts=("recruitee.com",),
        markers=("recruitee",),
        submit="button:has-text('Send application'), button[type=submit]",
        success_text=r"thank you for (applying|your application)|application (has been )?sent",
        support=UNTESTED,
    ),
    Ats(
        key="workday",
        label="Workday",
        hosts=("myworkdayjobs.com", "myworkdaysite.com"),
        markers=("data-automation-id", "workday", "myworkdayjobs"),
        submit="button[data-automation-id=bottom-navigation-next-button]",
        next="button[data-automation-id=bottom-navigation-next-button]",
        needs_account=True,  # applying asks for an account or sign-in: handed to the candidate
        multi_step=True,
        support=UNTESTED,
    ),
    Ats(
        key="bamboohr",
        label="BambooHR",
        hosts=("bamboohr.com",),
        path=r"/(careers|jobs)",
        markers=("bamboohr",),
        submit="button:has-text('Submit Application'), button[type=submit]",
        success_text=r"thank you|application (has been )?(submitted|received)",
        support=UNTESTED,
    ),
)

BY_KEY = {p.key: p for p in PROVIDERS} | {GENERIC.key: GENERIC}


def detect(url: str, page_html: str = "") -> Ats:
    """Which system this application page belongs to: by address first, then by what the page
    itself says (a company can host the form on its own domain). Never the generic one by mistake:
    a page matches a system only on a host, or on two of its markers."""
    for p in PROVIDERS:
        if p.matches_url(url):
            return p
    if page_html:
        low = page_html.lower()
        for p in PROVIDERS:
            if sum(1 for m in p.markers if m.lower() in low) >= 2:
                return p
    return GENERIC


def enabled(setting: str) -> set[str]:
    """The systems whose forms are filled in. An empty setting means the ones that have been
    seen working; 'all' means every one known (an operator's choice, with the risk that carries)."""
    names = {s.strip().lower() for s in (setting or "").split(",") if s.strip()}
    if "all" in names:
        return {p.key for p in PROVIDERS if not p.needs_account}
    return names or {p.key for p in PROVIDERS if p.default_on}


def status_table() -> list[dict[str, str | bool]]:
    """What is claimed for each system, for the documentation and the back office."""
    return [
        {
            "key": p.key,
            "label": p.label,
            "support": p.support,
            "default_on": p.default_on,
            "multi_step": p.multi_step,
            "needs_account": p.needs_account,
        }
        for p in PROVIDERS
    ]
