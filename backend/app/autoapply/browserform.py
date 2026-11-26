"""Fill in and submit an employer's own application form in a real browser.

Only forms on a short list of approved applicant-tracking sites are ever opened (`hosts`); any other
address is not "supported", so the application goes by email or waits for the candidate. The form is
read as it is right now, every answer comes from the candidate's confirmed facts or from something
they typed for this application, and a question nobody has answered is handed back to them: nothing
is guessed. A page that asks for a CAPTCHA, a sign-in or a payment is handed back too; none of that
is worked around.

The outcome is judged from the page after the button is pressed. If the page shows the employer's
thank-you, it is a success. If it shows the form's own errors, nothing was sent. If it shows
neither,
the result is unknown: the application is marked "ambiguous" and the candidate is asked what
happened, so it can never be sent twice by mistake.

Needs the optional `browser` extra (Playwright) and a Chromium. Checked against the live Greenhouse
and Lever application pages by reading them only; no real application was submitted while
building it."""

import asyncio
import contextlib
import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.autoapply import cvfile
from app.autoapply.adapters import AdapterError, FormField, FormReceipt, FormSchema
from app.services.url_guard import UrlRejected, validate_public_url, validate_url_syntax

# The sites whose forms are filled in. Greenhouse's own job boards were read in a real browser.
# Ashby's (jobs.ashbyhq.com) are built from its public page structure and tested on a copy of it,
# not yet seen in a real browser; both need a first supervised submission before anyone relies on
# them. Others are added in AUTOAPPLY_FORM_HOSTS only after they have been checked the same way.
# AUTOAPPLY_FORM_HOSTS="*" lets the app try ANY public https application link (see ANY_SITE below).
DEFAULT_HOSTS = ("boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.ashbyhq.com")

# The setting that means "any public site". The form is still read first and filled only as far as
# the app can honestly answer it; a human check (CAPTCHA), a sign-in wall, an unknown required
# question or no form at all hands the job back to the person. Nothing here works round a site's
# own checks.
ANY_SITE = "*"

LOAD_MS = 45_000
SUBMIT_MS = 40_000
MAX_OPTIONS = 80
# What a script-drawn dropdown's choices look like: standard roles, or react-select's own classes.
OPTIONS = "[role=option], [class*=select__option], [id*='-option-']"

SUCCESS_URL = re.compile(r"/(confirmation|thank|submitted|success|applied)", re.I)
SUCCESS_TEXT = re.compile(
    r"thank you for (applying|your application|your interest|submitting)"
    r"|application (has been )?(submitted|received|sent|complete)"
    r"|we(?:'ve| have) received your application"
    r"|successfully submitted",
    re.I,
)
CLOSED_TEXT = re.compile(
    r"no longer (accepting|available|open)|position (has been |is )?(filled|closed)"
    r"|job (is |has been )?(closed|removed)|this (job|position|role) (is|has been) (closed|filled)"
    r"|page (you are looking for )?(was )?not found|404",
    re.I,
)
BLOCK_TITLE = re.compile(r"just a moment|access denied|attention required|are you a robot", re.I)
LOGIN_TEXT = re.compile(r"\b(sign in|log in|create an account) to (apply|continue)\b", re.I)
SPAM_TEXT = re.compile(
    r"flagged|possible spam|suspicious|unusual activity|automated (request|submission)"
    r"|are you a (human|robot)",
    re.I,
)
ERROR_TEXT = re.compile(
    r"(is|are) required|required field|please (enter|select|choose|fill|provide)|invalid", re.I
)

# Names forms use for what the facts hold: (name we answer under, what the form's label looks like)
CANON = (
    ("first_name", r"first.?name|given.?name"),
    ("last_name", r"last.?name|family.?name|surname"),
    ("email", r"e-?mail"),
    ("phone", r"phone|mobile|telephone"),
    ("linkedin", r"linked.?in"),
    ("github", r"github"),
    ("website", r"website|portfolio|personal (site|url)"),
    ("current_company", r"current (company|employer)|^org$|^employer"),
    ("country", r"^country"),
    ("location", r"location|^city\b|where are you (based|located)|^address"),
    ("name", r"^(legal |full |your )?name$"),
)
# Ashby's own names for its built-in questions
SYSTEM_FIELDS = {
    "_systemfield_name": "name",
    "_systemfield_email": "email",
    "_systemfield_location": "location",
}

STATE = (
    "() => ({ url: location.href, text: (document.body.innerText || '').slice(0, 3000), "
    "bad: document.querySelectorAll('[aria-invalid=true]').length })"
)
# Reads every control of the application form. The form is the one with a file input (the CV), or
# the whole page for forms drawn without a <form> tag.
# Reads every control of the application form (the one with a file input, else the whole page).
SCAN = (Path(__file__).with_name("scan_form.js")).read_text()


@dataclass
class Control:
    name: (
        str  # what we answer it under: a canonical name (email, first_name...) or the page's own id
    )
    label: str
    kind: str  # text | choice | file | declaration | captcha
    required: bool
    selector: str
    ctl: str  # text | select | combo | group | single | file
    options: list[str] = field(default_factory=list)
    multi: bool = False
    one: str = ""


def canonical(label: str, key: str) -> str:
    """The name the facts use for this question, when it plainly is one of the usual ones."""
    low, k = label.lower().strip(), key.lower()
    if k in SYSTEM_FIELDS:
        return SYSTEM_FIELDS[k]
    if len(low) <= 40:
        for name, pattern in CANON:
            if re.search(pattern, low):
                return name
    for name, pattern in CANON[:7]:  # first/last name, email, phone, linkedin, github, website
        if re.fullmatch(pattern, k) or k == name:
            return name
    return key


def controls_from(raw: dict[str, Any]) -> list[Control]:
    """The scan turned into controls: kind, canonical name, options."""
    out: list[Control] = []
    for c in raw["controls"]:
        label, ctl = c["label"], c["ctl"]
        options = [o for o in c["options"] if o][:MAX_OPTIONS] if len(c["options"]) <= 400 else []
        if ctl == "file":
            name = (
                "cover_letter"
                if re.search(r"cover", f"{label} {c['key']}", re.I)
                else "resume"
                if re.search(r"resume|cv|curriculum", f"{label} {c['key']}", re.I)
                else c["key"]
            )
            out.append(Control(name, label or name, "file", c["required"], c["selector"], ctl))
        elif ctl == "single":
            out.append(
                Control(
                    c["key"], c["one"] or label, "declaration", c["required"], c["selector"], ctl
                )
            )
        elif ctl == "buttons":
            slug = "q_" + re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:50]
            out.append(
                Control(slug, label or slug, "choice", c["required"], c["selector"], ctl, options)
            )
        elif ctl in ("group", "select", "combo"):
            name = canonical(label, c["key"]) if ctl != "group" else c["key"]
            out.append(
                Control(
                    name,
                    label or c["key"],
                    "choice",
                    c["required"],
                    c["selector"],
                    ctl,
                    options,
                    c["multi"],
                )
            )
        else:
            out.append(
                Control(
                    canonical(label, c["key"]),
                    label or c["key"],
                    "text",
                    c["required"],
                    c["selector"],
                    ctl,
                )
            )
    return out


def schema_from(controls: list[Control], captcha: bool) -> FormSchema:
    fields = [FormField(c.name, c.label, c.required, c.kind, c.options) for c in controls]
    if captcha:
        fields.append(FormField("captcha", "Prove you are human", True, "captcha"))
    digest = hashlib.sha256(
        json.dumps([(f.name, f.kind, f.required, f.options) for f in fields]).encode()
    ).hexdigest()[:16]
    return FormSchema(fields, digest)


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def pick(options: list[str], wanted: str) -> int | None:
    """The option that is the answer: the same words, else one containing them (or the reverse)."""
    w = norm(wanted)
    if not w:
        return None
    for i, o in enumerate(options):
        if norm(o) == w:
            return i
    for i, o in enumerate(options):
        n = norm(o)
        if n and (w in n or n in w) and min(len(n), len(w)) >= 2:
            return i
    return None


class BrowserForm:
    """The employer-form adapter that drives a real browser."""

    name = "browser"
    real = True

    def __init__(
        self,
        *,
        hosts: tuple[str, ...] = DEFAULT_HOSTS,
        executable_path: str | None = None,
        proxy: dict[str, str] | None = None,
        launcher: Callable[[], Any] | None = None,
        manager: Any = None,
    ) -> None:
        self.hosts = tuple(h.lower() for h in hosts)
        self.any_site = ANY_SITE in self.hosts
        self.executable_path = executable_path
        self.proxy = proxy
        self._launcher = launcher
        # the unified worker passes its BrowserManager: one Chromium reused, a fresh context each
        self.manager = manager
        self._busy = asyncio.Semaphore(1)  # one browser job at a time: it is heavy, and polite
        self.receipts: dict[str, FormReceipt] = {}

    # ------------------------------------------------------------------ what is allowed

    def _allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        if self.any_site:
            return self._public_syntax(url)
        return parts.scheme in ("https", "http") and (parts.hostname or "").lower() in self.hosts

    @staticmethod
    def _public_syntax(url: str) -> bool:
        """A public web address: no private or local network, no odd port, no login in the link."""
        try:
            validate_url_syntax(url)
        except UrlRejected:
            return False
        return True

    def supports(self, application_url: str) -> bool:
        parts = urlsplit(application_url or "")
        secure = parts.scheme == "https" or (parts.hostname or "") in ("127.0.0.1", "localhost")
        return bool(secure and self._allowed(application_url))

    async def _public(self, url: str) -> bool:
        """The same, and the name really points at a public address (checked on the network)."""
        try:
            await validate_public_url(url)
        except UrlRejected:
            return False
        return True

    # ------------------------------------------------------------------ the browser

    async def _open(self, pw: Any) -> Any:
        opts: dict[str, Any] = {"args": ["--no-sandbox"]}
        if self.executable_path:
            opts["executable_path"] = self.executable_path
        if self.proxy:
            opts["proxy"] = self.proxy
        return await pw.chromium.launch(**opts)

    async def _session(self, url: str) -> tuple[Any, Any, Callable[[], Awaitable[None]]]:
        """(page, scan, close) with the form on screen. Raises AdapterError, having closed it."""
        if not self.supports(url) or (self.any_site and not await self._public(url)):
            raise AdapterError("rejected", "That form is not one we are approved to fill in.")
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            raise AdapterError(
                "unavailable", "The browser for application forms is not installed.", transient=True
            ) from None
        if self.manager is not None:
            ctx = await self.manager.context(accept_downloads=False)

            async def close() -> None:
                await self.manager.done(ctx)

        else:
            pw = await async_playwright().start()
            try:
                browser = await self._open(pw)
                ctx = await browser.new_context(accept_downloads=False)
            except Exception as exc:  # noqa: BLE001
                await pw.stop()
                raise _read_error(exc) from None

            async def close() -> None:
                with contextlib.suppress(Exception):
                    await browser.close()
                await pw.stop()

        try:

            async def guard(route: Any) -> None:  # the page may not wander off to any other site
                req = route.request
                if req.is_navigation_request() and not (
                    await self._public(req.url) if self.any_site else self._allowed(req.url)
                ):
                    await route.abort()
                else:
                    await route.continue_()

            await ctx.route("**/*", guard)
            page = await ctx.new_page()
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=LOAD_MS)
            if resp is not None and resp.status >= 500:
                raise AdapterError(
                    "unavailable", "The employer's site had a problem.", transient=True
                )
            # a closed job has no form: said below, not "too slow"
            with contextlib.suppress(Exception):
                await page.wait_for_selector("input, select, textarea", timeout=15_000)
            await page.wait_for_timeout(1500)  # forms drawn by script finish filling in
            scan = await page.evaluate(SCAN)
        except AdapterError:
            await close()
            raise
        except Exception as exc:  # noqa: BLE001 - the browser's own errors, in one place
            await close()
            raise _read_error(exc) from None
        if BLOCK_TITLE.search(scan["title"] or ""):
            await close()
            raise AdapterError(
                "rejected", "The employer's site asked for a human check we cannot do."
            )
        if not scan["controls"]:
            await close()
            if CLOSED_TEXT.search(scan["text"]):
                raise AdapterError("rejected", "This job is no longer open.")
            raise AdapterError("rejected", "No application form was found on that page.")
        if LOGIN_TEXT.search(scan["text"]):
            await close()
            raise AdapterError("rejected", "The employer asks you to sign in to apply.")
        return page, scan, close

    # ------------------------------------------------------------------ read, submit, receipts

    async def read_form(self, application_url: str) -> FormSchema:
        async with self._busy:
            page, scan, close = await self._session(application_url)
            try:
                controls = controls_from(scan)
                for c in controls:  # a dropdown drawn by script shows its choices only when opened
                    if c.ctl == "combo" and not c.options:
                        c.options = await _open_choices(page, c)
                return schema_from(controls, bool(scan["captcha"]))
            finally:
                await close()

    async def submit(
        self,
        application_url: str,
        *,
        idempotency_key: str,
        values: dict[str, str],
        cv_text: str,
        cv_filename: str,
        cv_layout: dict[str, Any] | None = None,
    ) -> FormReceipt:
        if idempotency_key in self.receipts:
            return self.receipts[idempotency_key]  # the same intent again changes nothing
        async with self._busy:
            page, scan, close = await self._session(application_url)
            try:
                if scan["captcha"]:
                    raise AdapterError("rejected", "The form asks for a human check (CAPTCHA).")
                controls = controls_from(scan)
                cover = values.get("cover_letter", "")
                for c in controls:
                    await _fill(page, c, values, cv_text, cv_filename, cover, cv_layout)
                receipt = await self._press_and_wait(page, idempotency_key)
                self.receipts[idempotency_key] = receipt
                return receipt
            finally:
                await close()

    async def find_receipt(
        self, application_url: str, *, idempotency_key: str
    ) -> FormReceipt | None:
        """An employer's site cannot be asked "did you get this one?". Only what this process saw
        succeed is known; otherwise None, and the candidate is asked what happened."""
        return self.receipts.get(idempotency_key)

    async def _press_and_wait(self, page: Any, key: str) -> FormReceipt:
        button = page.locator(
            ".ashby-application-form-submit-button, button[type=submit], input[type=submit], "
            "button:has-text('Submit'), button:has-text('Apply')"
        ).last
        before = page.url
        try:
            await button.click(timeout=10_000)
        except Exception:  # noqa: BLE001 - the press itself did not happen: nothing was sent
            raise AdapterError(
                "rejected", "The form's submit button could not be pressed."
            ) from None
        # from here on the employer may have the application: an unclear end is "ambiguous"
        waited = 0
        while waited < SUBMIT_MS:
            await asyncio.sleep(0.5)
            waited += 500
            try:
                state = await page.evaluate(STATE)
            except Exception:  # noqa: BLE001, S112 - the page is navigating: look again
                continue
            if (state["url"] != before and SUCCESS_URL.search(state["url"])) or SUCCESS_TEXT.search(
                state["text"]
            ):
                m = SUCCESS_TEXT.search(state["text"])
                ref = hashlib.sha256(key.encode()).hexdigest()[:12]
                return FormReceipt(
                    reference=f"browser-{ref}",
                    evidence=(m.group(0) if m else state["url"])[:200],
                )
            if SPAM_TEXT.search(state["text"]):
                raise AdapterError(
                    "rejected", "The employer's site flagged the submission as automated."
                )
            if state["bad"] and waited >= 2000:
                raise AdapterError("rejected", "The form refused the application as filled in.")
        raise AdapterError("ambiguous", "The form did not show a confirmation in time.")


def _read_error(exc: Exception) -> AdapterError:
    text = str(exc).lower()
    if "timeout" in text:
        return AdapterError("unavailable", "The form took too long to load.", transient=True)
    return AdapterError("unavailable", "The form could not be opened.", transient=True)


async def _open_choices(page: Any, c: Control) -> list[str]:
    """Open a script-drawn dropdown, read what it offers, close it. Long lists are not kept."""
    try:
        box = page.locator(c.selector).first
        await box.click(timeout=3000)
        await page.wait_for_timeout(300)
        texts = await page.locator(OPTIONS).all_inner_texts()
        await page.keyboard.press("Escape")
        texts = [t.strip() for t in texts if t.strip()]
        return texts[:MAX_OPTIONS] if len(texts) <= 400 else []
    except Exception:  # noqa: BLE001 - not every dropdown opens on a click
        return []


async def _fill(
    page: Any,
    c: Control,
    values: dict[str, str],
    cv_text: str,
    cv_filename: str,
    cover: str,
    cv_layout: dict[str, Any] | None = None,
) -> None:
    """Put the answer for one control on the form. A control with no answer is left alone."""
    if c.kind == "file":
        if c.name == "resume" or c.name == "cv":
            data, name = cvfile.render_pdf(cv_text, cv_layout), cv_filename
        elif c.name == "cover_letter" and cover:
            data, name = cvfile.render_pdf(cover), "Cover letter.pdf"
        else:
            return
        await page.locator(c.selector).first.set_input_files(
            {"name": name, "mimeType": "application/pdf", "buffer": data}
        )
        return
    value = values.get(c.name)
    if value is None or value == "":
        return
    where = page.locator(c.selector)
    try:
        if c.ctl == "text":
            await where.first.fill(value, timeout=8000)
        elif c.ctl == "select":
            i = pick(c.options, value)
            if i is None:
                raise AdapterError("rejected", f"'{c.label}' has no choice matching your answer.")
            await where.first.select_option(label=c.options[i], timeout=8000)
        elif c.ctl == "combo":
            await _choose_in_combo(page, where.first, c, value)
        elif c.ctl == "single":
            if norm(value) in ("yes", "true", "agree", "i agree", "accept", "i accept", "1"):
                await where.first.check(timeout=8000)
        elif c.ctl == "buttons":
            i = pick(c.options, value)
            if i is None:
                raise AdapterError("rejected", f"'{c.label}' has no choice matching your answer.")
            label = re.compile(rf"^\s*{re.escape(c.options[i])}\s*$")
            await where.filter(has_text=label).first.click(timeout=8000)
        elif c.ctl == "group":
            wanted = [v.strip() for v in value.split(";")] if c.multi else [value]
            for w in wanted:
                i = pick(c.options, w)
                if i is None:
                    raise AdapterError(
                        "rejected", f"'{c.label}' has no choice matching your answer."
                    )
                await where.nth(i).check(timeout=8000, force=True)
    except AdapterError:
        raise
    except Exception:  # noqa: BLE001 - the page did not take the answer: nothing was sent
        raise AdapterError("rejected", f"'{c.label}' could not be filled in.") from None


async def _choose_in_combo(page: Any, box: Any, c: Control, value: str) -> None:
    """A dropdown drawn by script: open it, type the answer, take the option that matches."""
    await box.click(timeout=5000)
    await box.fill("")
    await box.type(value[:60], delay=20)
    await page.wait_for_timeout(500)
    texts = [t.strip() for t in await page.locator(OPTIONS).all_inner_texts()]
    i = pick(texts, value)
    if i is None:
        await page.keyboard.press("Escape")
        raise AdapterError("rejected", f"'{c.label}' has no choice matching your answer.")
    await page.locator(OPTIONS).nth(i).click(timeout=5000)
