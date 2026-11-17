import re
from datetime import UTC, datetime

import pytest

from app.adapters.email import EmailMessage
from app.services import email_templates as t

BRAND = t.Brand(web_origin="https://app.example.com")
WITH_SUPPORT = t.Brand(web_origin="https://app.example.com", support_email="help@example.com")
LINK = "https://app.example.com/login/verify?token=Tok_en-123"
WHEN = datetime(2026, 11, 17, 9, 5, tzinfo=UTC)


def all_messages(brand: t.Brand = BRAND, name: str | None = "Jordan Reyes") -> list[EmailMessage]:
    return [
        t.signup_confirmation(brand, "a@b.com", name, LINK, 15),
        t.sign_in_link(brand, "a@b.com", name, LINK, 15),
        t.password_reset(brand, "a@b.com", name, LINK, 15),
        t.welcome(brand, "a@b.com", name),
        t.password_changed(brand, "a@b.com", name, WHEN),
        t.account_deleted(brand, "a@b.com", name),
    ]


KINDS = ["signup", "login", "reset", "welcome", "password_changed", "account_deleted"]


def test_there_is_one_message_per_core_action_with_the_right_kind() -> None:
    assert [m.kind for m in all_messages()] == KINDS


@pytest.mark.parametrize("m", all_messages(), ids=KINDS)
def test_every_message_is_a_complete_branded_html_email(m: EmailMessage) -> None:
    h = m.html
    assert h.startswith("<!doctype html>") and '<html lang="en">' in h
    assert "<title>" in h and 'name="viewport"' in h
    assert 'name="color-scheme"' in h and "prefers-color-scheme: dark" in h  # dark mode
    assert "#7B47F3" in h and "#1C1B2E" in h and "#F7F4FF" in h  # the brand palette
    assert "InterviewMeet" in h
    assert 'role="presentation"' in h  # layout tables are not read out as data
    assert 'alt=""' in h  # the logo is decorative
    assert "max-width:560px" in h
    assert "https://app.example.com/terms" in h and "https://app.example.com/privacy" in h
    assert t.PRACTICE_RULE in h
    assert len(h.encode()) < 40_000  # Gmail clips messages near 102 KB; stay far below


@pytest.mark.parametrize("m", all_messages(), ids=KINDS)
def test_every_message_has_a_hidden_preview_line(m: EmailMessage) -> None:
    pre = re.search(r'<div style="display:none[^>]*>(.*?)&#8199;', m.html, re.S)
    assert pre and len(pre.group(1)) > 10


@pytest.mark.parametrize("m", all_messages(), ids=KINDS)
def test_every_message_has_a_plain_text_version_that_says_the_same(m: EmailMessage) -> None:
    assert "<" not in m.text.replace("https://", "")  # no markup leaked into the text part
    assert t.PRACTICE_RULE in m.text and "Terms: https://app.example.com/terms" in m.text
    heading = re.search(r"<h1[^>]*>(.*?)</h1>", m.html, re.S)
    assert heading and m.text.startswith(heading.group(1).replace("&#x27;", "'").upper())
    for url in re.findall(r'href="(https://app\.example\.com/[^"]*)"', m.html):
        assert url in m.text or url.endswith(("/terms", "/privacy"))


@pytest.mark.parametrize("m", all_messages(), ids=KINDS)
def test_subjects_are_short_plain_and_on_brand(m: EmailMessage) -> None:
    assert 10 < len(m.subject) <= 70 and "\n" not in m.subject and "\r" not in m.subject
    assert "InterviewMeet" in m.subject or m.kind == "login"


def test_the_action_emails_carry_their_link_in_the_button_the_fallback_and_the_text() -> None:
    for m in all_messages()[:3]:
        assert m.link == LINK
        assert m.html.count(f'href="{LINK}"') == 2  # the button, and the paste-this-link fallback
        assert "Button not working?" in m.html and LINK in m.text


def test_the_other_emails_have_no_one_time_link_so_it_can_never_be_logged() -> None:
    assert [m.link for m in all_messages()[3:]] == [None, None, None]


def test_expiry_is_stated_and_the_ignore_advice_is_there() -> None:
    for m in all_messages()[:3]:
        assert "expires in 15 minutes" in m.text and "works once" in m.text
        assert "ignore this email" in m.text.lower()


def test_each_message_says_what_it_is_for() -> None:
    signup, login, reset, welcome, changed, deleted = all_messages()
    assert (
        "Confirm email and sign in" in signup.html and "no account will be created" in signup.text
    )
    assert ">Sign in<" in login.html and "no password to type" in login.text
    assert "Choose a new password" in reset.html and "signed out everywhere else" in reset.text
    assert "Upload your CV" in welcome.text and "Add the company" in welcome.text
    assert "Practise on Google Meet" in welcome.text and "/dashboard" in welcome.html
    assert "November 17, 2026 at 09:05 UTC" in changed.text and "/forgot-password" in changed.html
    assert "signed you out of your other devices" in changed.text
    assert "deleted" in deleted.text and "/signup" in deleted.html


def test_the_name_is_used_for_the_greeting_the_heading_and_the_subject() -> None:
    signup, login, _reset, welcome, *_ = all_messages()
    assert "Hi Jordan," in signup.text and "WELCOME, JORDAN. CONFIRM YOUR EMAIL" in signup.text
    assert "Welcome, Jordan. Confirm your email" in signup.html and "Hi Jordan," in login.html
    assert (
        welcome.subject == "Welcome to InterviewMeet, Jordan"
        and "YOU'RE IN, JORDAN" in welcome.text
    )


def test_without_a_name_the_emails_still_read_naturally() -> None:
    for m in all_messages(name=None):
        assert "Hi there," in m.text
        assert "None" not in m.text and "None" not in m.html and ", ," not in m.text
    assert all_messages(name=None)[3].subject == "Welcome to InterviewMeet"


def test_anything_a_person_typed_is_escaped_in_the_html() -> None:
    evil = '<script>alert(1)</script>"&'
    for m in all_messages(name=evil)[:4]:
        assert "<script>" not in m.html and "&lt;script&gt;" in m.html
    link = 'https://app.example.com/x?a="><img src=x onerror=alert(1)>'
    m = t.sign_in_link(BRAND, "a@b.com", "Jo", link, 15)
    assert "<img src=x" not in m.html and "&quot;&gt;&lt;img" in m.html


@pytest.mark.parametrize(
    "bad", ["javascript:alert(1)", "data:text/html,hi", "//evil.example.com", "ftp://x.test/a"]
)
def test_a_link_that_is_not_http_is_refused(bad: str) -> None:
    with pytest.raises(ValueError):
        t.sign_in_link(BRAND, "a@b.com", "Jo", bad, 15)


def test_line_breaks_in_a_name_cannot_reach_the_subject_line() -> None:
    m = t.welcome(BRAND, "a@b.com", "Jo\r\nBcc: x@evil.example Smith")
    assert "\n" not in m.subject and "\r" not in m.subject


def test_the_support_address_appears_and_becomes_the_reply_to_only_when_set() -> None:
    plain, helped = all_messages(BRAND), all_messages(WITH_SUPPORT)
    assert all(m.reply_to is None for m in plain)
    assert all(m.reply_to == "help@example.com" for m in helped)
    assert all("mailto:help@example.com" in m.html and "help@example.com" in m.text for m in helped)
    assert all("mailto:" not in m.html for m in plain)


def test_only_the_logo_is_loaded_from_outside_and_there_is_no_tracking() -> None:
    for m in all_messages():
        assert re.findall(r'<img src="([^"]+)"', m.html) == [
            "https://app.example.com/email-logo.png"
        ]
        assert "utm_" not in m.html and "pixel" not in m.html.lower()


def test_the_origin_with_a_trailing_slash_does_not_double_up() -> None:
    m = t.welcome(t.Brand(web_origin="https://app.example.com/"), "a@b.com", "Jo")
    assert "https://app.example.com//" not in m.html.replace("https://", "")
