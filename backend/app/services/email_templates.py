"""The emails we send, with their copy. Every message has an HTML body and a plain-text body built
from the same blocks, so the two always say the same thing.

The HTML is built for real inboxes: table layout, inline styles, a 560px column, a button that also
works in Outlook, a hidden preview line, and dark-mode styles for clients that support them. Every
value that came from a person (a name, an address) is escaped. Links must be http(s)."""

import html
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.adapters.email import EmailMessage
from app.services.names import first_name

ACCENT, INK, MUTED, CANVAS, LINE = "#7B47F3", "#1C1B2E", "#5E5C75", "#F7F4FF", "#E6E1F5"
FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
PRACTICE_RULE = (
    "InterviewMeet is for practising interviews with a partner who knows the assistant is on."
)


@dataclass(frozen=True)
class Brand:
    """Where the web app lives, and who answers questions (optional)."""

    web_origin: str
    support_email: str = ""


# A body is a list of blocks: ("p", text) a paragraph, ("steps", [(title, text), ...]) a numbered
# list, ("button", label, url) the one call to action, ("note", text) small print.
Block = tuple[Any, ...]


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def _check_url(url: str) -> str:
    if not url.startswith(("https://", "http://")):
        raise ValueError("email links must be http(s)")
    return url


def _subject_word(first: str | None) -> str | None:
    """A first name made safe for a subject line: no control characters, no line breaks."""
    if not first:
        return None
    cleaned = "".join(ch for ch in first if ch.isprintable()).strip()
    return cleaned or None


def _greeting(name: str | None) -> str:
    first = first_name(name)
    return f"Hi {first}," if first else "Hi there,"


def _button_html(label: str, url: str) -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px">'
        f'<tr><td bgcolor="{ACCENT}" style="border-radius:12px">'
        f'<a href="{_e(_check_url(url))}" style="display:inline-block;padding:14px 28px;'
        f"font-family:{FONT};font-size:16px;font-weight:600;line-height:1.2;color:#FFFFFF;"
        f'text-decoration:none;border-radius:12px">{_e(label)}</a></td></tr></table>'
        f'<p class="m" style="margin:14px 0 0;font-size:13px;line-height:1.5;color:{MUTED}">'
        "Button not working? Paste this link into your browser:<br>"
        f'<a href="{_e(url)}" class="lk" style="color:{ACCENT};word-break:break-all">{_e(url)}</a></p>'
    )


def _render_html(
    brand: Brand, *, preheader: str, heading: str, blocks: list[Block], why: str
) -> str:
    body: list[str] = []
    for block in blocks:
        kind = block[0]
        if kind == "p":
            body.append(
                f'<p class="t" style="margin:0 0 16px;font-size:16px;line-height:1.6;color:{INK}">'
                f"{_e(block[1])}</p>"
            )
        elif kind == "steps":
            rows = "".join(
                "<tr>"
                f'<td valign="top" style="padding:0 14px 16px 0"><div style="width:28px;height:28px;'
                f"border-radius:14px;background:{CANVAS};color:{ACCENT};font-family:{FONT};"
                f'font-size:14px;font-weight:700;line-height:28px;text-align:center">{i}</div></td>'
                f'<td valign="top" style="padding:0 0 16px"><div class="t" style="font-size:16px;'
                f'font-weight:600;line-height:1.4;color:{INK}">{_e(title)}</div>'
                f'<div class="m" style="font-size:15px;line-height:1.55;color:{MUTED}">{_e(text)}</div></td>'
                "</tr>"
                for i, (title, text) in enumerate(block[1], start=1)
            )
            body.append(
                f'<table role="presentation" cellpadding="0" cellspacing="0" border="0">{rows}</table>'
            )
        elif kind == "button":
            body.append(_button_html(block[1], block[2]))
        elif kind == "note":
            body.append(
                f'<p class="m rule" style="margin:24px 0 0;padding-top:16px;border-top:1px solid {LINE};'
                f'font-size:14px;line-height:1.55;color:{MUTED}">{_e(block[1])}</p>'
            )
    support = (
        f'Questions? Write to <a href="mailto:{_e(brand.support_email)}" class="lk" style="color:{ACCENT}">'
        f"{_e(brand.support_email)}</a>."
        if brand.support_email
        else ""
    )
    origin = _e(brand.web_origin.rstrip("/"))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>{_e(heading)}</title>
<style>
@media (prefers-color-scheme: dark) {{
  .bg {{ background:#14131F !important }} .card {{ background:#1F1E2E !important }}
  .t {{ color:#F1EFFB !important }} .m {{ color:#B9B6D1 !important }}
  .rule {{ border-top-color:#34324A !important }} .lk {{ color:#B79CFF !important }} .fl {{ color:#B9B6D1 !important }}
}}
@media only screen and (max-width:600px) {{ .card {{ padding:24px 20px !important }} }}
</style></head>
<body class="bg" style="margin:0;padding:0;background:{CANVAS}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">{_e(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="{CANVAS}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 4px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px"><img src="{origin}/email-logo.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:10px"></td>
<td valign="middle" class="t" style="font-family:{FONT};font-size:20px;font-weight:700;color:{INK}">InterviewMeet</td>
</tr></table></td></tr>
<tr><td class="card" style="background:#FFFFFF;border-radius:16px;padding:36px 32px;font-family:{FONT}">
<h1 class="t" style="margin:0 0 18px;font-size:26px;line-height:1.25;font-weight:700;color:{INK}">{_e(heading)}</h1>
{"".join(body)}
</td></tr>
<tr><td class="m" style="padding:20px 8px 0;font-family:{FONT};font-size:12px;line-height:1.6;color:{MUTED};text-align:center">
{_e(why)}<br>{_e(PRACTICE_RULE)}<br>
<a href="{origin}/terms" class="fl" style="color:{MUTED}">Terms</a> &nbsp;·&nbsp; <a href="{origin}/privacy" class="fl" style="color:{MUTED}">Privacy</a>{("<br>" + support) if support else ""}
</td></tr>
</table></td></tr></table></body></html>"""


def _render_text(brand: Brand, *, heading: str, blocks: list[Block], why: str) -> str:
    out = [heading.upper(), ""]
    for block in blocks:
        kind = block[0]
        if kind == "p":
            out += [block[1], ""]
        elif kind == "steps":
            out += [f"{i}. {t}: {x}" for i, (t, x) in enumerate(block[1], start=1)] + [""]
        elif kind == "button":
            out += [f"{block[1]}:", _check_url(block[2]), ""]
        elif kind == "note":
            out += ["--", block[1], ""]
    origin = brand.web_origin.rstrip("/")
    out += ["--", why, PRACTICE_RULE, f"Terms: {origin}/terms   Privacy: {origin}/privacy"]
    if brand.support_email:
        out.append(f"Questions? Write to {brand.support_email}")
    return "\n".join(out) + "\n"


def _message(
    kind: str,
    brand: Brand,
    to: str,
    *,
    subject: str,
    preheader: str,
    heading: str,
    blocks: list[Block],
    why: str,
    link: str | None = None,
) -> EmailMessage:
    return EmailMessage(
        kind=kind,
        to=to,
        subject=subject,
        html=_render_html(brand, preheader=preheader, heading=heading, blocks=blocks, why=why),
        text=_render_text(brand, heading=heading, blocks=blocks, why=why),
        link=link,
        reply_to=brand.support_email or None,
    )


# ---------------------------------------------------------------------------------- the messages


def signup_confirmation(
    brand: Brand, to: str, name: str | None, link: str, ttl_minutes: int
) -> EmailMessage:
    first = first_name(name)
    return _message(
        "signup",
        brand,
        to,
        subject="Confirm your email for InterviewMeet",
        preheader="One click and your account is ready.",
        heading=f"Welcome, {first}. Confirm your email" if first else "Confirm your email",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "You're one click away from practising interviews with answers grounded in your "
                "own CV. Confirm your email address to create your account.",
            ),
            ("button", "Confirm email and sign in", link),
            (
                "note",
                f"This link works once and expires in {ttl_minutes} minutes. If you didn't sign up "
                "for InterviewMeet, ignore this email: no account will be created.",
            ),
        ],
        why="You got this email because someone used this address to sign up for InterviewMeet.",
        link=link,
    )


def sign_in_link(
    brand: Brand, to: str, name: str | None, link: str, ttl_minutes: int
) -> EmailMessage:
    return _message(
        "login",
        brand,
        to,
        subject="Your InterviewMeet sign-in link",
        preheader="Use this link to sign in. It works once.",
        heading="Sign in to InterviewMeet",
        blocks=[
            ("p", _greeting(name)),
            ("p", "Use the button below to sign in. There's no password to type."),
            ("button", "Sign in", link),
            (
                "note",
                f"This link works once and expires in {ttl_minutes} minutes. If you didn't ask for "
                "it, you can ignore this email: nobody can sign in to your account without it.",
            ),
        ],
        why="You got this email because someone asked for a sign-in link for this address.",
        link=link,
    )


def password_reset(
    brand: Brand, to: str, name: str | None, link: str, ttl_minutes: int
) -> EmailMessage:
    return _message(
        "reset",
        brand,
        to,
        subject="Reset your InterviewMeet password",
        preheader="Choose a new password for your account.",
        heading="Choose a new password",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "We got a request to reset the password for your InterviewMeet account. Use the "
                "button below to choose a new one. You'll be signed in, and signed out everywhere else.",
            ),
            ("button", "Choose a new password", link),
            (
                "note",
                f"This link works once and expires in {ttl_minutes} minutes. If you didn't ask for "
                "a reset, ignore this email: your password stays exactly as it is.",
            ),
        ],
        why="You got this email because someone asked to reset the password for this address.",
        link=link,
    )


def welcome(brand: Brand, to: str, name: str | None) -> EmailMessage:
    first = first_name(name)
    subject_first = _subject_word(first)
    return _message(
        "welcome",
        brand,
        to,
        subject=f"Welcome to InterviewMeet, {subject_first}"
        if subject_first
        else "Welcome to InterviewMeet",
        preheader="Three steps to your first practice call.",
        heading=f"You're in, {first}" if first else "You're in",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "Your account is ready. Here's the quickest way to your first practice call:",
            ),
            (
                "steps",
                [
                    (
                        "Upload your CV",
                        "Your own stories in an answer come only from it, so every point can be traced back.",
                    ),
                    (
                        "Add the company you're interviewing with",
                        "We build a brief where every fact cites its source.",
                    ),
                    (
                        "Practise on Google Meet with a friend",
                        "Share the Meet tab and get an outline for each question they ask.",
                    ),
                ],
            ),
            ("button", "Go to your dashboard", f"{brand.web_origin.rstrip('/')}/dashboard"),
            (
                "note",
                "Always tell your practice partner that the assistant is listening. You confirm "
                "that before every session.",
            ),
        ],
        why="You got this email because you created an InterviewMeet account.",
    )


def password_changed(brand: Brand, to: str, name: str | None, when: datetime) -> EmailMessage:
    stamp = when.strftime("%B %-d, %Y at %H:%M UTC")
    return _message(
        "password_changed",
        brand,
        to,
        subject="Your InterviewMeet password was changed",
        preheader="If this wasn't you, reset it right away.",
        heading="Your password was changed",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                f"The password for your InterviewMeet account was changed on {stamp}. We also "
                "signed you out of your other devices.",
            ),
            ("p", "If that was you, there's nothing more to do."),
            ("p", "If it wasn't you, reset your password now to lock the account down:"),
            ("button", "Reset my password", f"{brand.web_origin.rstrip('/')}/forgot-password"),
        ],
        why="You got this email because the password on your account changed.",
    )


def account_deleted(brand: Brand, to: str, name: str | None) -> EmailMessage:
    return _message(
        "account_deleted",
        brand,
        to,
        subject="Your InterviewMeet account has been deleted",
        preheader="Your CV, companies and sessions are gone.",
        heading="Your account has been deleted",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "As you asked, we've deleted your InterviewMeet account along with your CV text, "
                "companies and practice sessions. Backups age out within 30 days.",
            ),
            (
                "p",
                "We kept nothing except this message. You're welcome back any time: you can "
                "create a new account whenever you like.",
            ),
            ("button", "Create a new account", f"{brand.web_origin.rstrip('/')}/signup"),
            (
                "note",
                "If you didn't delete your account, write to us straight away"
                + (f" at {brand.support_email}." if brand.support_email else "."),
            ),
        ],
        why="You got this email because your InterviewMeet account was deleted.",
    )
